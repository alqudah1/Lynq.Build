import "server-only";

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingBrandProfiles, marketingCreativeReferences } from "@/db/schema";
import { requireExecutionVisibility } from "@/lib/agent-runtime/authz";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { recordAuditEvent } from "@/lib/audit";
import { resolveMarketingAuthContext, requireMarketingManageContentAuthority, requireMarketingViewAuthority } from "./authz";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export const CREATIVE_REFERENCE_TYPES = ["short_video", "tutorial", "testimonial", "cinematic", "post", "carousel", "other"] as const;
export type CreativeReferenceType = (typeof CREATIVE_REFERENCE_TYPES)[number];

export interface CreativeReference {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  brandProfileId: string;
  title: string;
  referenceType: CreativeReferenceType;
  sourceUrl: string;
  transcript: string;
  creativeNotes: string;
  adaptationRules: string;
  createdByUserId: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toReference(row: typeof marketingCreativeReferences.$inferSelect): CreativeReference {
  return { ...row, referenceType: row.referenceType as CreativeReferenceType };
}

export async function listCreativeReferences(db: Db, input: { organizationId: string; workspaceId?: string | null; actorUserId: string }): Promise<CreativeReference[]> {
  const workspaceId = input.workspaceId ?? null;
  await requireExecutionVisibility(db, { organizationId: input.organizationId, workspaceId, actorUserId: input.actorUserId });
  const ctx = await resolveMarketingAuthContext(db, input);
  await requireMarketingViewAuthority(db, ctx, "marketing_creative_reference", "list");
  const rows = await db.select().from(marketingCreativeReferences).where(and(
    eq(marketingCreativeReferences.organizationId, input.organizationId),
    workspaceId ? eq(marketingCreativeReferences.workspaceId, workspaceId) : isNull(marketingCreativeReferences.workspaceId),
    isNull(marketingCreativeReferences.archivedAt),
  )).orderBy(desc(marketingCreativeReferences.updatedAt));
  return rows.map(toReference);
}

export async function createCreativeReference(db: Db, input: {
  organizationId: string;
  workspaceId?: string | null;
  brandProfileId: string;
  title: string;
  referenceType: CreativeReferenceType;
  sourceUrl: string;
  transcript?: string;
  creativeNotes: string;
  adaptationRules?: string;
  actorUserId: string;
}): Promise<CreativeReference> {
  const workspaceId = input.workspaceId ?? null;
  await requireExecutionVisibility(db, { organizationId: input.organizationId, workspaceId, actorUserId: input.actorUserId });
  const ctx = await resolveMarketingAuthContext(db, input);
  await requireMarketingManageContentAuthority(db, ctx, "marketing_creative_reference", "new");
  const [brand] = await db.select({ id: marketingBrandProfiles.id, workspaceId: marketingBrandProfiles.workspaceId }).from(marketingBrandProfiles).where(and(
    eq(marketingBrandProfiles.id, input.brandProfileId),
    eq(marketingBrandProfiles.organizationId, input.organizationId),
  ));
  if (!brand || brand.workspaceId !== workspaceId) throw new TenantResourceNotFoundError();
  const [row] = await db.insert(marketingCreativeReferences).values({
    organizationId: input.organizationId,
    workspaceId,
    brandProfileId: brand.id,
    title: input.title,
    referenceType: input.referenceType,
    sourceUrl: input.sourceUrl,
    transcript: input.transcript ?? "",
    creativeNotes: input.creativeNotes,
    adaptationRules: input.adaptationRules ?? "",
    createdByUserId: input.actorUserId,
  }).returning();
  await recordAuditEvent(db, {
    eventType: "marketing_creative_reference_created",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "marketing_creative_reference",
    targetId: row.id,
    metadata: { brandProfileId: brand.id, referenceType: input.referenceType, workspaceScoped: Boolean(workspaceId) },
  });
  return toReference(row);
}

/** Resolves a bounded reference set without ever leaking or accepting another tenant or brand's IDs. */
export async function resolveCreativeReferences(db: Db, input: {
  organizationId: string;
  workspaceId?: string | null;
  brandProfileId: string;
  referenceIds?: string[];
  actorUserId: string;
}): Promise<CreativeReference[]> {
  const ids = [...new Set(input.referenceIds ?? [])];
  if (ids.length === 0) return [];
  if (ids.length > 5) throw new Error("Choose no more than five creative references");
  const workspaceId = input.workspaceId ?? null;
  await requireExecutionVisibility(db, { organizationId: input.organizationId, workspaceId, actorUserId: input.actorUserId });
  const ctx = await resolveMarketingAuthContext(db, input);
  await requireMarketingViewAuthority(db, ctx, "marketing_creative_reference", "selection");
  const rows = await db.select().from(marketingCreativeReferences).where(and(
    eq(marketingCreativeReferences.organizationId, input.organizationId),
    eq(marketingCreativeReferences.brandProfileId, input.brandProfileId),
    workspaceId ? eq(marketingCreativeReferences.workspaceId, workspaceId) : isNull(marketingCreativeReferences.workspaceId),
    isNull(marketingCreativeReferences.archivedAt),
    inArray(marketingCreativeReferences.id, ids),
  ));
  if (rows.length !== ids.length) throw new TenantResourceNotFoundError();
  const byId = new Map(rows.map((row) => [row.id, toReference(row)]));
  return ids.map((id) => byId.get(id)!);
}

export function serializeCreativeReferences(references: CreativeReference[]) {
  return references.map((reference) => ({
    title: reference.title,
    type: reference.referenceType,
    sourceUrl: reference.sourceUrl,
    transcript: reference.transcript,
    whatToBorrow: reference.creativeNotes,
    adaptationAndDoNotCopyRules: reference.adaptationRules,
  }));
}
