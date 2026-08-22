import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { crmCompanies } from "@/db/schema";
import { createContact } from "./contacts";
import { createCompany } from "./companies";
import { createContactCompanyRelationship } from "./relationships";
import { DuplicateRelationshipError } from "./errors";
import { createLead } from "./leads";
import { listSourcesForUser, seedBuiltInSources } from "./sources";
import { crmEmailSchema, crmNameSchema, crmPhoneSchema } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export const prospectImportItemSchema = z.object({
  placeId: z.string().trim().max(300).optional().default(""),
  name: crmNameSchema,
  phone: crmPhoneSchema.optional().or(z.literal("")),
  email: crmEmailSchema.optional().or(z.literal("")),
  website: z.string().trim().max(500).optional().or(z.literal("")),
  address: z.string().trim().max(1000).optional().default(""),
  industry: z.string().trim().max(200).optional().default(""),
  city: z.string().trim().max(300).optional().default(""),
  countryCode: z.enum(["CA", "JO"]),
  rating: z.number().min(0).max(5).nullable().optional(),
  reviews: z.number().int().min(0).max(10_000_000).optional().default(0),
  websiteScore: z.number().int().min(0).max(100),
  opportunityScore: z.number().int().min(0).max(100),
  qualificationReasons: z.array(z.string().trim().max(500)).max(10).optional().default([]),
  qualified: z.literal(true),
}).passthrough();

export const prospectImportSchema = z.object({
  version: z.literal(1),
  prospects: z.array(prospectImportItemSchema).min(1).max(100),
}).strict();

export type ProspectImport = z.infer<typeof prospectImportSchema>;

function prospectImportKey(prospect: z.infer<typeof prospectImportItemSchema>): string {
  const stableIdentity = prospect.placeId || `${prospect.countryCode}|${prospect.name}|${prospect.address}`;
  return createHash("sha256").update(stableIdentity).digest("hex").slice(0, 40);
}

function domainFromWebsite(website: string): string | undefined {
  if (!website) return undefined;
  try {
    return new URL(website).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

export async function importProspects(
  db: Db,
  input: {
    organizationId: string;
    actorUserId: string;
    prospectImport: ProspectImport;
    consentAttestation?: string;
  },
): Promise<{ staged: number }> {
  await seedBuiltInSources(db, { organizationId: input.organizationId });
  const sources = await listSourcesForUser(db, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    activeOnly: true,
  });
  const importSourceId = sources.find((source) => source.sourceKey === "IMPORT")?.id;

  for (let index = 0; index < input.prospectImport.prospects.length; index += 5) {
    await Promise.all(input.prospectImport.prospects.slice(index, index + 5).map(async (prospect) => {
      const key = prospectImportKey(prospect);
      const companyResult = await createCompany(db, {
        organizationId: input.organizationId,
        name: prospect.name,
        domain: domainFromWebsite(prospect.website || ""),
        website: prospect.website || undefined,
        industry: prospect.industry || undefined,
        phone: prospect.phone || undefined,
        address: prospect.address ? { formatted: prospect.address, city: prospect.city, countryCode: prospect.countryCode } : undefined,
        lifecycleStage: "lead",
        sourceId: importSourceId,
        idempotencyKey: `lynq-prospect-company:${key}`,
        actorUserId: input.actorUserId,
      });
      const companyAddress = companyResult.company.address ?? {};
      if (companyAddress.countryCode !== prospect.countryCode || companyAddress.photo !== prospect.photo) {
        await db
          .update(crmCompanies)
          .set({
            address: {
              ...companyAddress,
              formatted: prospect.address || companyAddress.formatted,
              city: prospect.city || companyAddress.city,
              countryCode: prospect.countryCode,
              photo: prospect.photo || companyAddress.photo,
              description: prospect.description || companyAddress.description,
              category: prospect.category || companyAddress.category,
              rating: prospect.rating ?? companyAddress.rating,
              reviews: prospect.reviews,
              hours: prospect.hours ?? companyAddress.hours,
            },
            updatedAt: new Date(),
          })
          .where(and(eq(crmCompanies.organizationId, input.organizationId), eq(crmCompanies.id, companyResult.company.id)));
      }

      let contactId: string | undefined;
      if (prospect.email || prospect.phone) {
        const contactResult = await createContact(db, {
          organizationId: input.organizationId,
          displayName: `${prospect.name} business contact`,
          primaryEmail: prospect.email || undefined,
          primaryPhone: prospect.phone || undefined,
          lifecycleStage: "lead",
          sourceId: importSourceId,
          idempotencyKey: `lynq-prospect-contact:${key}`,
          actorUserId: input.actorUserId,
        });
        contactId = contactResult.contact.id;
        try {
          await createContactCompanyRelationship(db, {
            organizationId: input.organizationId,
            contactId,
            companyId: companyResult.company.id,
            relationshipType: "other",
            isPrimary: true,
            actorUserId: input.actorUserId,
          });
        } catch (error) {
          if (!(error instanceof DuplicateRelationshipError)) throw error;
        }
      }

      const notes = [
        `LYNQ discovery — ${prospect.city || prospect.countryCode}`,
        prospect.rating ? `${prospect.rating}★ from ${prospect.reviews} reviews` : `${prospect.reviews} reviews`,
        `Website score ${prospect.websiteScore}/100`,
        `Opportunity score ${prospect.opportunityScore}/100`,
        ...prospect.qualificationReasons,
        input.consentAttestation ? `Consent attestation: ${input.consentAttestation}` : null,
      ].filter(Boolean).join(" | ").slice(0, 5000);

      await createLead(db, {
        organizationId: input.organizationId,
        contactId,
        companyId: companyResult.company.id,
        sourceId: importSourceId,
        score: prospect.opportunityScore,
        qualificationNotes: notes,
        nextAction: "Review consent evidence and approve the first outreach manually",
        idempotencyKey: `lynq-prospect-lead:${key}`,
        actorUserId: input.actorUserId,
      });
    }));
  }

  return { staged: input.prospectImport.prospects.length };
}
