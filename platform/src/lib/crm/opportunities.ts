import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { crmOpportunities, crmPipelineStages } from "@/db/schema";
import { requireOrganizationMembership, requireWorkspaceMembership, requireTenantScopedResource } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { resolveCrmAuthContext, requireCrmManageAuthority, requireCrmViewAuthority } from "./authz";
import { StaleCrmUpdateError, OpportunityClosedError, OpportunityNotClosedError, LostReasonRequiredError, StageNotInPipelineError } from "./errors";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { resolvePipelineById } from "./pipelines";
import { assertPipelineHasOpenStage } from "./stages";
import type { CrmOpportunityStatus } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface CrmOpportunity {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  pipelineId: string;
  stageId: string;
  name: string;
  primaryContactId: string | null;
  companyId: string | null;
  ownerUserId: string | null;
  amount: string | null;
  currency: string | null;
  expectedCloseDate: Date | null;
  probabilityOverride: number | null;
  sourceId: string | null;
  status: CrmOpportunityStatus;
  lostReason: string | null;
  wonAt: Date | null;
  lostAt: Date | null;
  createdByUserId: string | null;
  revision: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

async function resolveStage(db: Db, organizationId: string, pipelineId: string, stageId: string) {
  const [stage] = await db.select().from(crmPipelineStages).where(and(eq(crmPipelineStages.id, stageId), eq(crmPipelineStages.pipelineId, pipelineId), eq(crmPipelineStages.organizationId, organizationId)));
  if (!stage) throw new StageNotInPipelineError();
  return stage;
}

async function validateOwner(db: Db, organizationId: string, workspaceId: string | null, ownerUserId: string | null | undefined): Promise<void> {
  if (!ownerUserId) return;
  await requireOrganizationMembership(db, organizationId, ownerUserId);
  if (workspaceId) await requireWorkspaceMembership(db, workspaceId, ownerUserId);
}

export interface CreateOpportunityInput {
  organizationId: string;
  workspaceId?: string | null;
  pipelineId: string;
  stageId: string;
  name: string;
  primaryContactId?: string | null;
  companyId?: string | null;
  ownerUserId?: string | null;
  amount?: number | null;
  currency?: string | null;
  expectedCloseDate?: Date | null;
  probabilityOverride?: number | null;
  sourceId?: string | null;
  idempotencyKey?: string | null;
  actorUserId: string;
}

/** Opportunity state (`open`/`won`/`lost`) is always derived from the stage moved into — never accepted as a direct input field on create; a new opportunity always starts `open`, requiring an explicitly non-closed starting stage. */
export async function createOpportunity(db: Db, input: CreateOpportunityInput): Promise<CrmOpportunity> {
  const pipeline = await resolvePipelineById(db, input.organizationId, input.pipelineId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: input.workspaceId ?? pipeline.workspaceId, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_opportunity", "new");
  await validateOwner(db, input.organizationId, input.workspaceId ?? null, input.ownerUserId);

  if (input.idempotencyKey) {
    const [existing] = await db.select().from(crmOpportunities).where(and(eq(crmOpportunities.organizationId, input.organizationId), eq(crmOpportunities.idempotencyKey, input.idempotencyKey)));
    if (existing) return existing as CrmOpportunity;
  }

  await assertPipelineHasOpenStage(db, input.organizationId, input.pipelineId);
  const stage = await resolveStage(db, input.organizationId, input.pipelineId, input.stageId);
  if (stage.isClosed) throw new OpportunityClosedError();

  let row;
  try {
    [row] = await db
      .insert(crmOpportunities)
      .values({
        organizationId: input.organizationId,
        workspaceId: input.workspaceId ?? null,
        pipelineId: input.pipelineId,
        stageId: input.stageId,
        name: input.name,
        primaryContactId: input.primaryContactId ?? null,
        companyId: input.companyId ?? null,
        ownerUserId: input.ownerUserId ?? null,
        amount: input.amount != null ? String(input.amount) : null,
        currency: input.currency ?? null,
        expectedCloseDate: input.expectedCloseDate ?? null,
        probabilityOverride: input.probabilityOverride ?? null,
        sourceId: input.sourceId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        createdByUserId: input.actorUserId,
      })
      .returning();
  } catch (err) {
    if (input.idempotencyKey && isPostgresUniqueViolation(err)) {
      const [existing] = await db.select().from(crmOpportunities).where(and(eq(crmOpportunities.organizationId, input.organizationId), eq(crmOpportunities.idempotencyKey, input.idempotencyKey)));
      if (existing) return existing as CrmOpportunity;
    }
    throw err;
  }

  await recordAuditEvent(db, { eventType: "crm_opportunity_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_opportunity", targetId: row.id, metadata: { pipelineId: input.pipelineId, stageId: input.stageId } });
  return row as CrmOpportunity;
}

export async function resolveOpportunityById(db: Db, organizationId: string, opportunityId: string): Promise<CrmOpportunity> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(crmOpportunities).where(and(eq(crmOpportunities.id, opportunityId), eq(crmOpportunities.organizationId, organizationId)));
    return row as CrmOpportunity | undefined;
  });
}

export async function getOpportunityForUser(db: Db, input: { organizationId: string; opportunityId: string; actorUserId: string }): Promise<CrmOpportunity> {
  const opportunity = await resolveOpportunityById(db, input.organizationId, input.opportunityId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: opportunity.workspaceId, actorUserId: input.actorUserId });
  await requireCrmViewAuthority(db, ctx, "crm_opportunity", opportunity.id);
  return opportunity;
}

export interface UpdateOpportunityInput {
  organizationId: string;
  opportunityId: string;
  expectedRevision: number;
  actorUserId: string;
  name?: string;
  primaryContactId?: string | null;
  companyId?: string | null;
  ownerUserId?: string | null;
  amount?: number | null;
  currency?: string | null;
  expectedCloseDate?: Date | null;
  probabilityOverride?: number | null;
  sourceId?: string | null;
}

export async function updateOpportunity(db: Db, input: UpdateOpportunityInput): Promise<CrmOpportunity> {
  const existing = await resolveOpportunityById(db, input.organizationId, input.opportunityId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: existing.workspaceId, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_opportunity", existing.id);
  if (input.ownerUserId !== undefined) await validateOwner(db, input.organizationId, existing.workspaceId, input.ownerUserId);

  const values: Record<string, unknown> = { updatedAt: new Date(), revision: input.expectedRevision + 1 };
  if (input.name !== undefined) values.name = input.name;
  if (input.primaryContactId !== undefined) values.primaryContactId = input.primaryContactId;
  if (input.companyId !== undefined) values.companyId = input.companyId;
  if (input.ownerUserId !== undefined) values.ownerUserId = input.ownerUserId;
  if (input.amount !== undefined) values.amount = input.amount != null ? String(input.amount) : null;
  if (input.currency !== undefined) values.currency = input.currency;
  if (input.expectedCloseDate !== undefined) values.expectedCloseDate = input.expectedCloseDate;
  if (input.probabilityOverride !== undefined) values.probabilityOverride = input.probabilityOverride;
  if (input.sourceId !== undefined) values.sourceId = input.sourceId;

  const [updated] = await db
    .update(crmOpportunities)
    .set(values)
    .where(and(eq(crmOpportunities.id, input.opportunityId), eq(crmOpportunities.organizationId, input.organizationId), eq(crmOpportunities.revision, input.expectedRevision)))
    .returning();

  if (!updated) throw new StaleCrmUpdateError("opportunity");
  await recordAuditEvent(db, { eventType: "crm_opportunity_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_opportunity", targetId: updated.id, metadata: { fields: Object.keys(values).filter((k) => k !== "updatedAt" && k !== "revision") } });
  return updated as CrmOpportunity;
}

export interface MoveOpportunityStageInput {
  organizationId: string;
  opportunityId: string;
  targetStageId: string;
  expectedRevision: number;
  lostReason?: string;
  actorUserId: string;
}

/**
 * Moves an open opportunity to a new stage within the same pipeline
 * (enforced by the `crm_opportunities_stage_pipeline_fk` composite FK — a
 * stage from a different pipeline is structurally rejected, not just
 * app-checked). Refuses to operate on an already-closed opportunity —
 * `reopenOpportunity` is the only door back to `open`. Moving into a
 * won/lost stage sets `status`/`wonAt`/`lostAt` atomically in the same
 * revision-guarded `UPDATE`, never a separate follow-up write.
 */
export async function moveOpportunityStage(db: Db, input: MoveOpportunityStageInput): Promise<CrmOpportunity> {
  const existing = await resolveOpportunityById(db, input.organizationId, input.opportunityId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: existing.workspaceId, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_opportunity", existing.id);

  if (existing.status !== "open") throw new OpportunityClosedError();

  const targetStage = await resolveStage(db, input.organizationId, existing.pipelineId, input.targetStageId);

  const values: Record<string, unknown> = { stageId: input.targetStageId, updatedAt: new Date(), revision: input.expectedRevision + 1 };
  let eventType: "crm_opportunity_stage_changed" | "crm_opportunity_won" | "crm_opportunity_lost" = "crm_opportunity_stage_changed";

  if (targetStage.isWon) {
    values.status = "won";
    values.wonAt = new Date();
    eventType = "crm_opportunity_won";
  } else if (targetStage.isLost) {
    if (!input.lostReason) throw new LostReasonRequiredError();
    values.status = "lost";
    values.lostAt = new Date();
    values.lostReason = input.lostReason;
    eventType = "crm_opportunity_lost";
  }

  const [updated] = await db
    .update(crmOpportunities)
    .set(values)
    .where(and(eq(crmOpportunities.id, input.opportunityId), eq(crmOpportunities.organizationId, input.organizationId), eq(crmOpportunities.revision, input.expectedRevision), eq(crmOpportunities.status, "open")))
    .returning();

  if (!updated) throw new StaleCrmUpdateError("opportunity");
  await recordAuditEvent(db, { eventType, actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_opportunity", targetId: updated.id, metadata: { stageId: input.targetStageId } });
  return updated as CrmOpportunity;
}

export interface ReopenOpportunityInput {
  organizationId: string;
  opportunityId: string;
  targetStageId: string;
  expectedRevision: number;
  actorUserId: string;
}

/** The one explicit door back to `open` from `won`/`lost` — a closed opportunity never silently reopens via an ordinary stage move. */
export async function reopenOpportunity(db: Db, input: ReopenOpportunityInput): Promise<CrmOpportunity> {
  const existing = await resolveOpportunityById(db, input.organizationId, input.opportunityId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: existing.workspaceId, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_opportunity", existing.id);

  if (existing.status === "open") throw new OpportunityNotClosedError();

  const targetStage = await resolveStage(db, input.organizationId, existing.pipelineId, input.targetStageId);
  if (targetStage.isClosed) throw new OpportunityClosedError();

  const [updated] = await db
    .update(crmOpportunities)
    .set({ status: "open", stageId: input.targetStageId, wonAt: null, lostAt: null, lostReason: null, updatedAt: new Date(), revision: input.expectedRevision + 1 })
    .where(and(eq(crmOpportunities.id, input.opportunityId), eq(crmOpportunities.organizationId, input.organizationId), eq(crmOpportunities.revision, input.expectedRevision)))
    .returning();

  if (!updated) throw new StaleCrmUpdateError("opportunity");
  await recordAuditEvent(db, { eventType: "crm_opportunity_reopened", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_opportunity", targetId: updated.id, metadata: { stageId: input.targetStageId } });
  return updated as CrmOpportunity;
}

export interface ListOpportunitiesInput {
  organizationId: string;
  actorUserId: string;
  workspaceId?: string | null;
  pipelineId?: string;
  stageId?: string;
  status?: CrmOpportunityStatus;
  ownerUserId?: string;
  companyId?: string;
  limit?: number;
}

export async function listOpportunitiesForUser(db: Db, input: ListOpportunitiesInput): Promise<CrmOpportunity[]> {
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: input.workspaceId ?? null, actorUserId: input.actorUserId });
  await requireCrmViewAuthority(db, ctx, "crm_opportunity", "list");

  const conditions = [eq(crmOpportunities.organizationId, input.organizationId)];
  if (input.workspaceId) conditions.push(eq(crmOpportunities.workspaceId, input.workspaceId));
  if (input.pipelineId) conditions.push(eq(crmOpportunities.pipelineId, input.pipelineId));
  if (input.stageId) conditions.push(eq(crmOpportunities.stageId, input.stageId));
  if (input.status) conditions.push(eq(crmOpportunities.status, input.status));
  if (input.ownerUserId) conditions.push(eq(crmOpportunities.ownerUserId, input.ownerUserId));
  if (input.companyId) conditions.push(eq(crmOpportunities.companyId, input.companyId));

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const rows = await db.select().from(crmOpportunities).where(and(...conditions)).limit(limit);
  return rows as CrmOpportunity[];
}

export async function listOpportunitiesByIds(db: Db, organizationId: string, opportunityIds: string[]): Promise<CrmOpportunity[]> {
  if (opportunityIds.length === 0) return [];
  const rows = await db.select().from(crmOpportunities).where(and(eq(crmOpportunities.organizationId, organizationId), inArray(crmOpportunities.id, opportunityIds)));
  return rows as CrmOpportunity[];
}
