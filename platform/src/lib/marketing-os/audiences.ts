import "server-only";
import { and, eq, count } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingAudiences, marketingCampaignAudienceLinks, crmContacts, crmCompanies, crmLeads, crmOpportunities } from "@/db/schema";
import { requireTenantScopedResource } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { resolveMarketingAuthContext, requireMarketingViewAuthority, requireMarketingManageAudiencesAuthority } from "./authz";
import { resolveCrmAuthContext, requireCrmViewAuthority } from "@/lib/crm/authz";
import { compileAudienceFilter } from "./audience-filters";
import { MarketingKeyAlreadyTakenError, StaleMarketingUpdateError } from "./errors";
import { marketingAudienceFilterDefinitionSchema, type MarketingAudienceEntityType, type MarketingAudienceEvaluationMode, type MarketingAudienceFilterCondition } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface MarketingAudience {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  name: string;
  audienceKey: string;
  description: string | null;
  entityType: MarketingAudienceEntityType;
  filterDefinition: MarketingAudienceFilterCondition[];
  evaluationMode: MarketingAudienceEvaluationMode;
  snapshotAt: Date | null;
  snapshotCount: number | null;
  snapshotRecordIds: string[] | null;
  ownerUserId: string | null;
  revision: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ENTITY_TABLES = { contact: crmContacts, company: crmCompanies, lead: crmLeads, opportunity: crmOpportunities } as const;
const ENTITY_TARGET_TYPES: Record<MarketingAudienceEntityType, string> = { contact: "crm_contact", company: "crm_company", lead: "crm_lead", opportunity: "crm_opportunity" };

export interface CreateAudienceInput {
  organizationId: string;
  workspaceId?: string | null;
  name: string;
  audienceKey: string;
  description?: string;
  entityType: MarketingAudienceEntityType;
  filterDefinition?: MarketingAudienceFilterCondition[];
  evaluationMode?: MarketingAudienceEvaluationMode;
  ownerUserId?: string | null;
  actorUserId: string;
}

export async function createAudience(db: Db, input: CreateAudienceInput): Promise<MarketingAudience> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageAudiencesAuthority(db, ctx, "marketing_audience", "new");

  const filterDefinition = marketingAudienceFilterDefinitionSchema.parse(input.filterDefinition ?? []);
  // Validated eagerly against the safe registry — a bad field/operator fails at create time, never silently at evaluation time.
  compileAudienceFilter(input.entityType, filterDefinition);

  let row: MarketingAudience;
  try {
    [row] = (await db
      .insert(marketingAudiences)
      .values({
        organizationId: input.organizationId,
        workspaceId: input.workspaceId ?? null,
        name: input.name,
        audienceKey: input.audienceKey,
        description: input.description ?? null,
        entityType: input.entityType,
        filterDefinition,
        evaluationMode: input.evaluationMode ?? "dynamic",
        ownerUserId: input.ownerUserId ?? null,
      })
      .returning()) as unknown as MarketingAudience[];
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new MarketingKeyAlreadyTakenError("marketing audience", input.audienceKey);
    throw err;
  }

  await recordAuditEvent(db, { eventType: "marketing_audience_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_audience", targetId: row.id, metadata: { audienceKey: row.audienceKey, entityType: row.entityType, conditionCount: filterDefinition.length } });
  return row;
}

export async function resolveAudienceById(db: Db, organizationId: string, audienceId: string): Promise<MarketingAudience> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(marketingAudiences).where(and(eq(marketingAudiences.id, audienceId), eq(marketingAudiences.organizationId, organizationId)));
    return row as unknown as MarketingAudience | undefined;
  });
}

export async function getAudienceForUser(db: Db, input: { organizationId: string; audienceId: string; actorUserId: string }): Promise<MarketingAudience> {
  const audience = await resolveAudienceById(db, input.organizationId, input.audienceId);
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_audience", audience.id);
  return audience;
}

export async function listAudiencesForUser(db: Db, input: { organizationId: string; actorUserId: string; limit?: number }): Promise<MarketingAudience[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_audience", "list");
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const rows = await db.select().from(marketingAudiences).where(eq(marketingAudiences.organizationId, input.organizationId)).limit(limit);
  return rows as unknown as MarketingAudience[];
}

export interface UpdateAudienceInput {
  organizationId: string;
  audienceId: string;
  expectedRevision: number;
  actorUserId: string;
  name?: string;
  description?: string | null;
  filterDefinition?: MarketingAudienceFilterCondition[];
  evaluationMode?: MarketingAudienceEvaluationMode;
  ownerUserId?: string | null;
}

export async function updateAudience(db: Db, input: UpdateAudienceInput): Promise<MarketingAudience> {
  const existing = await resolveAudienceById(db, input.organizationId, input.audienceId);
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageAudiencesAuthority(db, ctx, "marketing_audience", existing.id);

  const values: Record<string, unknown> = { updatedAt: new Date(), revision: input.expectedRevision + 1 };
  if (input.name !== undefined) values.name = input.name;
  if (input.description !== undefined) values.description = input.description;
  if (input.filterDefinition !== undefined) {
    const filterDefinition = marketingAudienceFilterDefinitionSchema.parse(input.filterDefinition);
    compileAudienceFilter(existing.entityType, filterDefinition);
    values.filterDefinition = filterDefinition;
  }
  if (input.evaluationMode !== undefined) values.evaluationMode = input.evaluationMode;
  if (input.ownerUserId !== undefined) values.ownerUserId = input.ownerUserId;

  const [updated] = await db
    .update(marketingAudiences)
    .set(values)
    .where(and(eq(marketingAudiences.id, input.audienceId), eq(marketingAudiences.organizationId, input.organizationId), eq(marketingAudiences.revision, input.expectedRevision)))
    .returning();
  if (!updated) throw new StaleMarketingUpdateError("audience");

  await recordAuditEvent(db, { eventType: "marketing_audience_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_audience", targetId: updated.id, metadata: { fields: Object.keys(values).filter((k) => k !== "updatedAt" && k !== "revision") } });
  return updated as unknown as MarketingAudience;
}

export interface AudienceEvaluationResult {
  count: number;
  recordIds: string[];
  evaluatedAt: Date;
  fromSnapshot: boolean;
}

/**
 * Live CRM evaluation — dual-gated (Marketing view authority, then CRM view
 * authority for the audience's own entity type), tenant-scoped, and bounded
 * to `recordIds`/`count` only. Never exposes contact email/phone/notes or
 * any other PII field — a preview UI resolves individual records back
 * through CRM's own authorized read functions, not through this call.
 * `evaluationMode: "static"` with a prior snapshot returns that frozen
 * result instead of re-querying, for campaign reproducibility; pass
 * `forceLive: true` to bypass the snapshot explicitly.
 */
export async function evaluateAudience(db: Db, input: { organizationId: string; audienceId: string; actorUserId: string; limit?: number; forceLive?: boolean }): Promise<AudienceEvaluationResult> {
  const audience = await getAudienceForUser(db, { organizationId: input.organizationId, audienceId: input.audienceId, actorUserId: input.actorUserId });

  if (audience.evaluationMode === "static" && audience.snapshotAt && !input.forceLive) {
    return { count: audience.snapshotCount ?? 0, recordIds: audience.snapshotRecordIds ?? [], evaluatedAt: audience.snapshotAt, fromSnapshot: true };
  }

  const crmCtx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: null, actorUserId: input.actorUserId });
  await requireCrmViewAuthority(db, crmCtx, ENTITY_TARGET_TYPES[audience.entityType], "list");

  const table = ENTITY_TABLES[audience.entityType];
  const filterCondition = compileAudienceFilter(audience.entityType, audience.filterDefinition);
  const tenantCondition = eq(table.organizationId, input.organizationId);
  const whereCondition = filterCondition ? and(tenantCondition, filterCondition) : tenantCondition;

  const [{ value: total }] = await db.select({ value: count() }).from(table).where(whereCondition);
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 1000);
  const rows = await db.select({ id: table.id }).from(table).where(whereCondition).limit(limit);

  return { count: total, recordIds: rows.map((r) => r.id), evaluatedAt: new Date(), fromSnapshot: false };
}

/** Freezes the current live evaluation into the audience's own `snapshotAt`/`snapshotCount`/`snapshotRecordIds` fields — used for campaign reproducibility (`evaluationMode: "static"`). */
export async function snapshotAudience(db: Db, input: { organizationId: string; audienceId: string; expectedRevision: number; actorUserId: string }): Promise<MarketingAudience> {
  const existing = await resolveAudienceById(db, input.organizationId, input.audienceId);
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageAudiencesAuthority(db, ctx, "marketing_audience", existing.id);

  const evaluation = await evaluateAudience(db, { organizationId: input.organizationId, audienceId: input.audienceId, actorUserId: input.actorUserId, forceLive: true, limit: 1000 });

  const [updated] = await db
    .update(marketingAudiences)
    .set({ snapshotAt: evaluation.evaluatedAt, snapshotCount: evaluation.count, snapshotRecordIds: evaluation.recordIds, updatedAt: new Date(), revision: input.expectedRevision + 1 })
    .where(and(eq(marketingAudiences.id, input.audienceId), eq(marketingAudiences.organizationId, input.organizationId), eq(marketingAudiences.revision, input.expectedRevision)))
    .returning();
  if (!updated) throw new StaleMarketingUpdateError("audience");
  return updated as unknown as MarketingAudience;
}

/** Links an ADDITIONAL (non-primary) audience to a campaign — the campaign's own `primaryAudienceId` already covers the common single-audience case. Idempotent-by-construction: a duplicate link is rejected, never silently doubled. */
export async function linkAudienceToCampaign(db: Db, input: { organizationId: string; campaignId: string; audienceId: string; actorUserId: string }): Promise<void> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageAudiencesAuthority(db, ctx, "marketing_campaign", input.campaignId);
  await resolveAudienceById(db, input.organizationId, input.audienceId);

  try {
    await db.insert(marketingCampaignAudienceLinks).values({ organizationId: input.organizationId, campaignId: input.campaignId, audienceId: input.audienceId, createdByUserId: input.actorUserId });
  } catch (err) {
    if (isPostgresUniqueViolation(err)) return; // already linked — idempotent no-op.
    throw err;
  }
}

export async function listAudiencesForCampaign(db: Db, input: { organizationId: string; campaignId: string; actorUserId: string }): Promise<MarketingAudience[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_campaign", input.campaignId);

  const rows = await db
    .select({ audience: marketingAudiences })
    .from(marketingCampaignAudienceLinks)
    .innerJoin(marketingAudiences, eq(marketingAudiences.id, marketingCampaignAudienceLinks.audienceId))
    .where(and(eq(marketingCampaignAudienceLinks.organizationId, input.organizationId), eq(marketingCampaignAudienceLinks.campaignId, input.campaignId)));
  return rows.map((r) => r.audience) as unknown as MarketingAudience[];
}
