"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { uuidParam } from "@/lib/http/validation";
import { createContact, archiveContact } from "@/lib/crm/contacts";
import { createCompany, archiveCompany } from "@/lib/crm/companies";
import { createContactCompanyRelationship } from "@/lib/crm/relationships";
import { DuplicateRelationshipError } from "@/lib/crm/errors";
import { createLead, qualifyLead, disqualifyLead, convertLead } from "@/lib/crm/leads";
import { createPipeline, setDefaultPipeline } from "@/lib/crm/pipelines";
import { createStage } from "@/lib/crm/stages";
import { createOpportunity, moveOpportunityStage, reopenOpportunity } from "@/lib/crm/opportunities";
import { createActivity } from "@/lib/crm/activities";
import { createNote, archiveNote } from "@/lib/crm/notes";
import { createFollowUp, completeFollowUp, cancelFollowUp } from "@/lib/crm/follow-ups";
import { createTag, assignTag } from "@/lib/crm/tags";
import { listSourcesForUser, seedBuiltInSources } from "@/lib/crm/sources";
import { createProjectLink } from "@/lib/crm/project-links";
import { grantCrmAgentPermission, revokeCrmAgentPermission } from "@/lib/crm/agent-permissions";
import {
  crmDisplayNameSchema,
  crmNameSchema,
  crmEmailSchema,
  crmPhoneSchema,
  crmKeySchema,
  crmLifecycleStageSchema,
  crmRelationshipTypeSchema,
  crmAmountSchema,
  crmCurrencySchema,
  crmActivityTypeSchema,
  crmBoundedTextSchema,
  crmPrioritySchema,
  crmTagEntityTypeSchema,
  crmProjectLinkEntityTypeSchema,
  crmAgentPermissionSchema,
} from "@/lib/crm/validation";
import { toActionResult } from "./errors";
import type { ActionResult } from "./types";

async function context(organizationSlug: string, path: string) {
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, path);
  const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
  return { db, user, organization };
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

const createContactSchema = z.object({
  firstName: z.string().trim().max(200).optional(),
  lastName: z.string().trim().max(200).optional(),
  displayName: crmDisplayNameSchema.optional(),
  primaryEmail: crmEmailSchema.optional().or(z.literal("")),
  primaryPhone: crmPhoneSchema.optional().or(z.literal("")),
  jobTitle: z.string().trim().max(200).optional(),
  lifecycleStage: crmLifecycleStageSchema.optional(),
});

export async function createContactAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/crm/contacts`);

  const parsed = createContactSchema.safeParse({
    firstName: formData.get("firstName") || undefined,
    lastName: formData.get("lastName") || undefined,
    displayName: formData.get("displayName") || undefined,
    primaryEmail: formData.get("primaryEmail") || undefined,
    primaryPhone: formData.get("primaryPhone") || undefined,
    jobTitle: formData.get("jobTitle") || undefined,
    lifecycleStage: formData.get("lifecycleStage") || undefined,
  });
  if (!parsed.success) return toActionResult(parsed.error);

  let result;
  try {
    result = await createContact(db, {
      organizationId: organization.id,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      displayName: parsed.data.displayName,
      primaryEmail: parsed.data.primaryEmail || undefined,
      primaryPhone: parsed.data.primaryPhone || undefined,
      jobTitle: parsed.data.jobTitle,
      lifecycleStage: parsed.data.lifecycleStage,
      actorUserId: user.userId,
    });
  } catch (err) {
    return toActionResult(err);
  }

  redirect(`/app/${organizationSlug}/crm/contacts/${result.contact.id}`);
}

const archiveContactSchema = z.object({ expectedRevision: z.coerce.number().int().min(1) });

export async function archiveContactAction(organizationSlug: string, contactId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/crm/contacts/${contactId}`);
  const parsed = archiveContactSchema.safeParse({ expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await archiveContact(db, { organizationId: organization.id, contactId, expectedRevision: parsed.data.expectedRevision, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/crm/contacts/${contactId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

const createCompanySchema = z.object({
  name: crmNameSchema,
  domain: z.string().trim().max(255).optional(),
  website: z.string().trim().max(500).optional(),
  industry: z.string().trim().max(200).optional(),
  lifecycleStage: crmLifecycleStageSchema.optional(),
});

export async function createCompanyAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/crm/companies`);

  const parsed = createCompanySchema.safeParse({
    name: formData.get("name"),
    domain: formData.get("domain") || undefined,
    website: formData.get("website") || undefined,
    industry: formData.get("industry") || undefined,
    lifecycleStage: formData.get("lifecycleStage") || undefined,
  });
  if (!parsed.success) return toActionResult(parsed.error);

  let result;
  try {
    result = await createCompany(db, { organizationId: organization.id, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  redirect(`/app/${organizationSlug}/crm/companies/${result.company.id}`);
}

const archiveCompanySchema = z.object({ expectedRevision: z.coerce.number().int().min(1) });

export async function archiveCompanyAction(organizationSlug: string, companyId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/crm/companies/${companyId}`);
  const parsed = archiveCompanySchema.safeParse({ expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await archiveCompany(db, { organizationId: organization.id, companyId, expectedRevision: parsed.data.expectedRevision, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/crm/companies/${companyId}`);
  return { ok: true };
}

const createRelationshipSchema = z.object({ contactId: uuidParam, companyId: uuidParam, relationshipType: crmRelationshipTypeSchema, isPrimary: z.coerce.boolean().optional() });

export async function createRelationshipAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/crm/contacts`);
  const parsed = createRelationshipSchema.safeParse({
    contactId: formData.get("contactId"),
    companyId: formData.get("companyId"),
    relationshipType: formData.get("relationshipType"),
    isPrimary: formData.get("isPrimary") === "on" || formData.get("isPrimary") === "true",
  });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await createContactCompanyRelationship(db, { organizationId: organization.id, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/crm/contacts/${parsed.data.contactId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

const createLeadSchema = z.object({
  contactId: uuidParam.optional().or(z.literal("")),
  companyId: uuidParam.optional().or(z.literal("")),
  estimatedValueAmount: z.coerce.number().optional(),
  estimatedValueCurrency: crmCurrencySchema.optional().or(z.literal("")),
  qualificationNotes: crmBoundedTextSchema.optional(),
});

export async function createLeadAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/crm/leads`);
  const parsed = createLeadSchema.safeParse({
    contactId: formData.get("contactId") || undefined,
    companyId: formData.get("companyId") || undefined,
    estimatedValueAmount: formData.get("estimatedValueAmount") || undefined,
    estimatedValueCurrency: formData.get("estimatedValueCurrency") || undefined,
    qualificationNotes: formData.get("qualificationNotes") || undefined,
  });
  if (!parsed.success) return toActionResult(parsed.error);

  let lead;
  try {
    lead = await createLead(db, {
      organizationId: organization.id,
      contactId: parsed.data.contactId || undefined,
      companyId: parsed.data.companyId || undefined,
      estimatedValueAmount: parsed.data.estimatedValueAmount,
      estimatedValueCurrency: parsed.data.estimatedValueCurrency || undefined,
      qualificationNotes: parsed.data.qualificationNotes,
      actorUserId: user.userId,
    });
  } catch (err) {
    return toActionResult(err);
  }

  redirect(`/app/${organizationSlug}/crm/leads/${lead.id}`);
}

const prospectImportItemSchema = z.object({
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

const prospectImportSchema = z.object({
  version: z.literal(1),
  prospects: z.array(prospectImportItemSchema).min(1).max(100),
}).strict();

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

/** Imports a reviewed LYNQ discovery export into CRM Core. Records remain `new`; this action never qualifies or contacts them. */
export async function importProspectsAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const path = `/app/${organizationSlug}/crm/leads/import`;
  const { db, user, organization } = await context(organizationSlug, path);
  const upload = formData.get("prospectsFile");
  if (!(upload instanceof File) || upload.size === 0) {
    return { ok: false, code: "invalid_request", message: "Choose a LYNQ prospect export JSON file." };
  }
  if (upload.size > 2_000_000) {
    return { ok: false, code: "invalid_request", message: "The import file must be 2 MB or smaller." };
  }

  let rawImport: unknown;
  try {
    rawImport = JSON.parse(await upload.text());
  } catch {
    return { ok: false, code: "invalid_request", message: "This is not a valid LYNQ prospect export JSON file." };
  }
  const validation = prospectImportSchema.safeParse(rawImport);
  if (!validation.success) return toActionResult(validation.error);
  const parsed = validation.data;

  try {
    await seedBuiltInSources(db, { organizationId: organization.id });
    const sources = await listSourcesForUser(db, { organizationId: organization.id, actorUserId: user.userId, activeOnly: true });
    const importSourceId = sources.find((source) => source.sourceKey === "IMPORT")?.id;

    for (let index = 0; index < parsed.prospects.length; index += 5) {
      await Promise.all(parsed.prospects.slice(index, index + 5).map(async (prospect) => {
        const key = prospectImportKey(prospect);
        const companyResult = await createCompany(db, {
          organizationId: organization.id,
          name: prospect.name,
          domain: domainFromWebsite(prospect.website || ""),
          website: prospect.website || undefined,
          industry: prospect.industry || undefined,
          phone: prospect.phone || undefined,
          address: prospect.address ? { formatted: prospect.address, city: prospect.city, countryCode: prospect.countryCode } : undefined,
          lifecycleStage: "lead",
          sourceId: importSourceId,
          idempotencyKey: `lynq-prospect-company:${key}`,
          actorUserId: user.userId,
        });

        let contactId: string | undefined;
        if (prospect.email || prospect.phone) {
          const contactResult = await createContact(db, {
            organizationId: organization.id,
            displayName: `${prospect.name} business contact`,
            primaryEmail: prospect.email || undefined,
            primaryPhone: prospect.phone || undefined,
            lifecycleStage: "lead",
            sourceId: importSourceId,
            idempotencyKey: `lynq-prospect-contact:${key}`,
            actorUserId: user.userId,
          });
          contactId = contactResult.contact.id;
          try {
            await createContactCompanyRelationship(db, {
              organizationId: organization.id,
              contactId,
              companyId: companyResult.company.id,
              relationshipType: "other",
              isPrimary: true,
              actorUserId: user.userId,
            });
          } catch (err) {
            if (!(err instanceof DuplicateRelationshipError)) throw err;
          }
        }

        const notes = [
          `LYNQ discovery — ${prospect.city || prospect.countryCode}`,
          prospect.rating ? `${prospect.rating}★ from ${prospect.reviews} reviews` : `${prospect.reviews} reviews`,
          `Website score ${prospect.websiteScore}/100`,
          `Opportunity score ${prospect.opportunityScore}/100`,
          ...prospect.qualificationReasons,
        ].join(" | ").slice(0, 5000);

        await createLead(db, {
          organizationId: organization.id,
          contactId,
          companyId: companyResult.company.id,
          sourceId: importSourceId,
          score: prospect.opportunityScore,
          qualificationNotes: notes,
          nextAction: "Review the business and approve the first outreach manually",
          idempotencyKey: `lynq-prospect-lead:${key}`,
          actorUserId: user.userId,
        });
      }));
    }
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/crm`);
  revalidatePath(`/app/${organizationSlug}/crm/companies`);
  revalidatePath(`/app/${organizationSlug}/crm/contacts`);
  revalidatePath(`/app/${organizationSlug}/crm/leads`);
  return { ok: true, message: `${parsed.prospects.length} prospects are now staged in LYNQ CRM as new leads. No outreach was sent.` };
}

const revisionSchema = z.object({ expectedRevision: z.coerce.number().int().min(1) });

export async function qualifyLeadAction(organizationSlug: string, leadId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/crm/leads/${leadId}`);
  const parsed = revisionSchema.safeParse({ expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await qualifyLead(db, { organizationId: organization.id, leadId, expectedRevision: parsed.data.expectedRevision, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/crm/leads/${leadId}`);
  return { ok: true };
}

export async function disqualifyLeadAction(organizationSlug: string, leadId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/crm/leads/${leadId}`);
  const parsed = revisionSchema.safeParse({ expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await disqualifyLead(db, { organizationId: organization.id, leadId, expectedRevision: parsed.data.expectedRevision, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/crm/leads/${leadId}`);
  return { ok: true };
}

const convertLeadSchema = z.object({ expectedRevision: z.coerce.number().int().min(1), pipelineId: uuidParam, stageId: uuidParam });

export async function convertLeadAction(organizationSlug: string, leadId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/crm/leads/${leadId}`);
  const parsed = convertLeadSchema.safeParse({ expectedRevision: formData.get("expectedRevision"), pipelineId: formData.get("pipelineId"), stageId: formData.get("stageId") });
  if (!parsed.success) return toActionResult(parsed.error);

  let result;
  try {
    result = await convertLead(db, { organizationId: organization.id, leadId, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  redirect(`/app/${organizationSlug}/crm/opportunities/${result.opportunity.id}`);
}

// ---------------------------------------------------------------------------
// Pipelines and stages
// ---------------------------------------------------------------------------

const createPipelineSchema = z.object({ name: crmNameSchema, pipelineKey: crmKeySchema, isDefault: z.coerce.boolean().optional() });

export async function createPipelineAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/crm/pipelines`);
  const parsed = createPipelineSchema.safeParse({
    name: formData.get("name"),
    pipelineKey: (formData.get("pipelineKey") as string)?.toUpperCase(),
    isDefault: formData.get("isDefault") === "on" || formData.get("isDefault") === "true",
  });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await createPipeline(db, { organizationId: organization.id, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/crm/pipelines`);
  return { ok: true };
}

export async function setDefaultPipelineAction(organizationSlug: string, pipelineId: string): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/crm/pipelines`);
  try {
    await setDefaultPipeline(db, { organizationId: organization.id, pipelineId, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/crm/pipelines`);
  return { ok: true };
}

const createStageSchema = z.object({
  pipelineId: uuidParam,
  name: crmNameSchema,
  stageKey: crmKeySchema,
  isClosed: z.coerce.boolean().optional(),
  isWon: z.coerce.boolean().optional(),
  isLost: z.coerce.boolean().optional(),
});

export async function createStageAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/crm/pipelines`);
  const parsed = createStageSchema.safeParse({
    pipelineId: formData.get("pipelineId"),
    name: formData.get("name"),
    stageKey: (formData.get("stageKey") as string)?.toUpperCase(),
    isClosed: formData.get("isClosed") === "on" || formData.get("isClosed") === "true",
    isWon: formData.get("isWon") === "on" || formData.get("isWon") === "true",
    isLost: formData.get("isLost") === "on" || formData.get("isLost") === "true",
  });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await createStage(db, { organizationId: organization.id, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/crm/pipelines`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------

const createOpportunitySchema = z.object({
  pipelineId: uuidParam,
  stageId: uuidParam,
  name: crmNameSchema,
  primaryContactId: uuidParam.optional().or(z.literal("")),
  companyId: uuidParam.optional().or(z.literal("")),
  amount: crmAmountSchema.optional(),
  currency: crmCurrencySchema.optional().or(z.literal("")),
});

export async function createOpportunityAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/crm/opportunities`);
  const parsed = createOpportunitySchema.safeParse({
    pipelineId: formData.get("pipelineId"),
    stageId: formData.get("stageId"),
    name: formData.get("name"),
    primaryContactId: formData.get("primaryContactId") || undefined,
    companyId: formData.get("companyId") || undefined,
    amount: formData.get("amount") || undefined,
    currency: formData.get("currency") || undefined,
  });
  if (!parsed.success) return toActionResult(parsed.error);

  let opportunity;
  try {
    opportunity = await createOpportunity(db, {
      organizationId: organization.id,
      pipelineId: parsed.data.pipelineId,
      stageId: parsed.data.stageId,
      name: parsed.data.name,
      primaryContactId: parsed.data.primaryContactId || undefined,
      companyId: parsed.data.companyId || undefined,
      amount: parsed.data.amount,
      currency: parsed.data.currency || undefined,
      actorUserId: user.userId,
    });
  } catch (err) {
    return toActionResult(err);
  }

  redirect(`/app/${organizationSlug}/crm/opportunities/${opportunity.id}`);
}

const moveOpportunitySchema = z.object({ expectedRevision: z.coerce.number().int().min(1), targetStageId: uuidParam, lostReason: crmBoundedTextSchema.optional() });

export async function moveOpportunityAction(organizationSlug: string, opportunityId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/crm/opportunities/${opportunityId}`);
  const parsed = moveOpportunitySchema.safeParse({ expectedRevision: formData.get("expectedRevision"), targetStageId: formData.get("targetStageId"), lostReason: formData.get("lostReason") || undefined });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await moveOpportunityStage(db, { organizationId: organization.id, opportunityId, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/crm/opportunities/${opportunityId}`);
  return { ok: true };
}

const reopenOpportunitySchema = z.object({ expectedRevision: z.coerce.number().int().min(1), targetStageId: uuidParam });

export async function reopenOpportunityAction(organizationSlug: string, opportunityId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/crm/opportunities/${opportunityId}`);
  const parsed = reopenOpportunitySchema.safeParse({ expectedRevision: formData.get("expectedRevision"), targetStageId: formData.get("targetStageId") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await reopenOpportunity(db, { organizationId: organization.id, opportunityId, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/crm/opportunities/${opportunityId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Activities, notes, follow-ups
// ---------------------------------------------------------------------------

const createActivitySchema = z.object({
  contactId: uuidParam.optional().or(z.literal("")),
  companyId: uuidParam.optional().or(z.literal("")),
  leadId: uuidParam.optional().or(z.literal("")),
  opportunityId: uuidParam.optional().or(z.literal("")),
  activityType: crmActivityTypeSchema,
  subject: z.string().trim().max(500).optional(),
  summary: crmBoundedTextSchema.optional(),
  redirectPath: z.string().trim().min(1),
});

export async function createActivityAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/crm`);
  const parsed = createActivitySchema.safeParse({
    contactId: formData.get("contactId") || undefined,
    companyId: formData.get("companyId") || undefined,
    leadId: formData.get("leadId") || undefined,
    opportunityId: formData.get("opportunityId") || undefined,
    activityType: formData.get("activityType"),
    subject: formData.get("subject") || undefined,
    summary: formData.get("summary") || undefined,
    redirectPath: formData.get("redirectPath"),
  });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await createActivity(db, {
      organizationId: organization.id,
      contactId: parsed.data.contactId || undefined,
      companyId: parsed.data.companyId || undefined,
      leadId: parsed.data.leadId || undefined,
      opportunityId: parsed.data.opportunityId || undefined,
      activityType: parsed.data.activityType,
      subject: parsed.data.subject,
      summary: parsed.data.summary,
      actorUserId: user.userId,
    });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(parsed.data.redirectPath);
  return { ok: true };
}

const createNoteSchema = z.object({
  contactId: uuidParam.optional().or(z.literal("")),
  companyId: uuidParam.optional().or(z.literal("")),
  leadId: uuidParam.optional().or(z.literal("")),
  opportunityId: uuidParam.optional().or(z.literal("")),
  content: crmBoundedTextSchema,
  redirectPath: z.string().trim().min(1),
});

export async function createNoteAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/crm`);
  const parsed = createNoteSchema.safeParse({
    contactId: formData.get("contactId") || undefined,
    companyId: formData.get("companyId") || undefined,
    leadId: formData.get("leadId") || undefined,
    opportunityId: formData.get("opportunityId") || undefined,
    content: formData.get("content"),
    redirectPath: formData.get("redirectPath"),
  });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await createNote(db, {
      organizationId: organization.id,
      contactId: parsed.data.contactId || undefined,
      companyId: parsed.data.companyId || undefined,
      leadId: parsed.data.leadId || undefined,
      opportunityId: parsed.data.opportunityId || undefined,
      content: parsed.data.content,
      actorUserId: user.userId,
    });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(parsed.data.redirectPath);
  return { ok: true };
}

const archiveNoteSchema = z.object({ expectedRevision: z.coerce.number().int().min(1), redirectPath: z.string().trim().min(1) });

export async function archiveNoteAction(organizationSlug: string, noteId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/crm`);
  const parsed = archiveNoteSchema.safeParse({ expectedRevision: formData.get("expectedRevision"), redirectPath: formData.get("redirectPath") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await archiveNote(db, { organizationId: organization.id, noteId, expectedRevision: parsed.data.expectedRevision, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(parsed.data.redirectPath);
  return { ok: true };
}

const createFollowUpSchema = z.object({
  contactId: uuidParam.optional().or(z.literal("")),
  companyId: uuidParam.optional().or(z.literal("")),
  leadId: uuidParam.optional().or(z.literal("")),
  opportunityId: uuidParam.optional().or(z.literal("")),
  assignedUserId: uuidParam,
  title: crmNameSchema,
  dueAt: z.coerce.date().optional(),
  priority: crmPrioritySchema.optional(),
  redirectPath: z.string().trim().min(1),
});

export async function createFollowUpAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/crm`);
  const parsed = createFollowUpSchema.safeParse({
    contactId: formData.get("contactId") || undefined,
    companyId: formData.get("companyId") || undefined,
    leadId: formData.get("leadId") || undefined,
    opportunityId: formData.get("opportunityId") || undefined,
    assignedUserId: formData.get("assignedUserId"),
    title: formData.get("title"),
    dueAt: formData.get("dueAt") || undefined,
    priority: formData.get("priority") || undefined,
    redirectPath: formData.get("redirectPath"),
  });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await createFollowUp(db, {
      organizationId: organization.id,
      contactId: parsed.data.contactId || undefined,
      companyId: parsed.data.companyId || undefined,
      leadId: parsed.data.leadId || undefined,
      opportunityId: parsed.data.opportunityId || undefined,
      assignedUserId: parsed.data.assignedUserId,
      title: parsed.data.title,
      dueAt: parsed.data.dueAt,
      priority: parsed.data.priority,
      actorUserId: user.userId,
    });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(parsed.data.redirectPath);
  return { ok: true };
}

const followUpTransitionSchema = z.object({ expectedRevision: z.coerce.number().int().min(1), redirectPath: z.string().trim().min(1) });

export async function completeFollowUpAction(organizationSlug: string, followUpId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/crm`);
  const parsed = followUpTransitionSchema.safeParse({ expectedRevision: formData.get("expectedRevision"), redirectPath: formData.get("redirectPath") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await completeFollowUp(db, { organizationId: organization.id, followUpId, expectedRevision: parsed.data.expectedRevision, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(parsed.data.redirectPath);
  return { ok: true };
}

export async function cancelFollowUpAction(organizationSlug: string, followUpId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/crm`);
  const parsed = followUpTransitionSchema.safeParse({ expectedRevision: formData.get("expectedRevision"), redirectPath: formData.get("redirectPath") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await cancelFollowUp(db, { organizationId: organization.id, followUpId, expectedRevision: parsed.data.expectedRevision, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(parsed.data.redirectPath);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Tags, project links, agent permissions, sources
// ---------------------------------------------------------------------------

const createTagSchema = z.object({ name: crmNameSchema, tagKey: crmKeySchema });

export async function createTagAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/crm/settings`);
  const parsed = createTagSchema.safeParse({ name: formData.get("name"), tagKey: (formData.get("tagKey") as string)?.toUpperCase() });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await createTag(db, { organizationId: organization.id, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/crm/settings`);
  return { ok: true };
}

const assignTagSchema = z.object({ tagId: uuidParam, entityType: crmTagEntityTypeSchema, entityId: uuidParam, redirectPath: z.string().trim().min(1) });

export async function assignTagAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/crm`);
  const parsed = assignTagSchema.safeParse({ tagId: formData.get("tagId"), entityType: formData.get("entityType"), entityId: formData.get("entityId"), redirectPath: formData.get("redirectPath") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await assignTag(db, { organizationId: organization.id, tagId: parsed.data.tagId, entityType: parsed.data.entityType, entityId: parsed.data.entityId, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(parsed.data.redirectPath);
  return { ok: true };
}

const createProjectLinkSchema = z.object({ projectId: uuidParam, crmEntityType: crmProjectLinkEntityTypeSchema, crmEntityId: uuidParam, redirectPath: z.string().trim().min(1) });

export async function createProjectLinkAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/crm`);
  const parsed = createProjectLinkSchema.safeParse({ projectId: formData.get("projectId"), crmEntityType: formData.get("crmEntityType"), crmEntityId: formData.get("crmEntityId"), redirectPath: formData.get("redirectPath") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await createProjectLink(db, { organizationId: organization.id, projectId: parsed.data.projectId, crmEntityType: parsed.data.crmEntityType, crmEntityId: parsed.data.crmEntityId, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(parsed.data.redirectPath);
  return { ok: true };
}

const grantAgentPermissionSchema = z.object({ agentId: uuidParam, permission: crmAgentPermissionSchema });

export async function grantAgentPermissionAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/crm/settings`);
  const parsed = grantAgentPermissionSchema.safeParse({ agentId: formData.get("agentId"), permission: formData.get("permission") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await grantCrmAgentPermission(db, { organizationId: organization.id, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/crm/settings`);
  return { ok: true };
}

export async function revokeAgentPermissionAction(organizationSlug: string, grantId: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/crm/settings`);
  const parsed = revisionSchema.safeParse({ expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);

  try {
    await revokeCrmAgentPermission(db, { organizationId: organization.id, grantId, expectedRevision: parsed.data.expectedRevision, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }

  revalidatePath(`/app/${organizationSlug}/crm/settings`);
  return { ok: true };
}

export async function seedSourcesAction(organizationSlug: string): Promise<ActionResult> {
  const { db, organization } = await context(organizationSlug, `/app/${organizationSlug}/crm/settings`);
  try {
    await seedBuiltInSources(db, { organizationId: organization.id });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/crm/settings`);
  return { ok: true };
}
