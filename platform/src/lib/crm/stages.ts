import "server-only";
import { and, eq, asc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { crmPipelineStages } from "@/db/schema";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { recordAuditEvent } from "@/lib/audit";
import { resolveCrmAuthContext, requireCrmManageAuthority, requireCrmViewAuthority } from "./authz";
import { StaleCrmUpdateError, StageKeyAlreadyTakenError, PipelineHasNoOpenStageError } from "./errors";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { resolvePipelineById } from "./pipelines";

type Db = NeonHttpDatabase<Record<string, unknown>>;

const SEQUENCE_GAP = 1000;

export interface CrmPipelineStage {
  id: string;
  organizationId: string;
  pipelineId: string;
  name: string;
  stageKey: string;
  sequence: number;
  stageType: string | null;
  probability: number | null;
  isClosed: boolean;
  isWon: boolean;
  isLost: boolean;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateStageInput {
  organizationId: string;
  pipelineId: string;
  name: string;
  stageKey: string;
  stageType?: string;
  probability?: number;
  isClosed?: boolean;
  isWon?: boolean;
  isLost?: boolean;
  actorUserId: string;
}

export async function createStage(db: Db, input: CreateStageInput): Promise<CrmPipelineStage> {
  const pipeline = await resolvePipelineById(db, input.organizationId, input.pipelineId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: pipeline.workspaceId, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_pipeline_stage", "new");

  const allStages = await db.select({ sequence: crmPipelineStages.sequence }).from(crmPipelineStages).where(eq(crmPipelineStages.pipelineId, pipeline.id)).orderBy(asc(crmPipelineStages.sequence));
  const maxSequence = allStages.length > 0 ? allStages[allStages.length - 1].sequence : 0;

  try {
    const [row] = await db
      .insert(crmPipelineStages)
      .values({
        organizationId: input.organizationId,
        pipelineId: pipeline.id,
        name: input.name,
        stageKey: input.stageKey,
        sequence: maxSequence + SEQUENCE_GAP,
        stageType: input.stageType ?? null,
        probability: input.probability ?? null,
        isClosed: input.isClosed ?? false,
        isWon: input.isWon ?? false,
        isLost: input.isLost ?? false,
      })
      .returning();

    await recordAuditEvent(db, { eventType: "crm_stage_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_pipeline_stage", targetId: row.id, metadata: { pipelineId: pipeline.id, stageKey: row.stageKey } });
    return row as CrmPipelineStage;
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new StageKeyAlreadyTakenError(input.stageKey);
    throw err;
  }
}

export async function listStagesForPipeline(db: Db, input: { organizationId: string; pipelineId: string; actorUserId: string }): Promise<CrmPipelineStage[]> {
  const pipeline = await resolvePipelineById(db, input.organizationId, input.pipelineId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: pipeline.workspaceId, actorUserId: input.actorUserId });
  await requireCrmViewAuthority(db, ctx, "crm_pipeline", pipeline.id);

  const rows = await db.select().from(crmPipelineStages).where(eq(crmPipelineStages.pipelineId, pipeline.id)).orderBy(asc(crmPipelineStages.sequence));
  return rows as CrmPipelineStage[];
}

/** A pipeline must have at least one open (non-closed) stage before it can be used for new opportunities — checked at opportunity-creation time, not at pipeline/stage-creation time (a pipeline mid-setup is allowed to be temporarily all-closed or empty). */
export async function assertPipelineHasOpenStage(db: Db, organizationId: string, pipelineId: string): Promise<void> {
  const stages = await db.select({ isClosed: crmPipelineStages.isClosed }).from(crmPipelineStages).where(and(eq(crmPipelineStages.pipelineId, pipelineId), eq(crmPipelineStages.organizationId, organizationId)));
  if (!stages.some((s) => !s.isClosed)) throw new PipelineHasNoOpenStageError();
}

export interface UpdateStageInput {
  organizationId: string;
  pipelineId: string;
  stageId: string;
  expectedRevision: number;
  actorUserId: string;
  name?: string;
  stageType?: string | null;
  probability?: number | null;
  isClosed?: boolean;
  isWon?: boolean;
  isLost?: boolean;
}

export async function updateStage(db: Db, input: UpdateStageInput): Promise<CrmPipelineStage> {
  const pipeline = await resolvePipelineById(db, input.organizationId, input.pipelineId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: pipeline.workspaceId, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_pipeline_stage", input.stageId);

  const values: Record<string, unknown> = { updatedAt: new Date(), revision: input.expectedRevision + 1 };
  if (input.name !== undefined) values.name = input.name;
  if (input.stageType !== undefined) values.stageType = input.stageType;
  if (input.probability !== undefined) values.probability = input.probability;
  if (input.isClosed !== undefined) values.isClosed = input.isClosed;
  if (input.isWon !== undefined) values.isWon = input.isWon;
  if (input.isLost !== undefined) values.isLost = input.isLost;

  const [updated] = await db
    .update(crmPipelineStages)
    .set(values)
    .where(and(eq(crmPipelineStages.id, input.stageId), eq(crmPipelineStages.pipelineId, input.pipelineId), eq(crmPipelineStages.revision, input.expectedRevision)))
    .returning();

  if (!updated) throw new StaleCrmUpdateError("stage");
  await recordAuditEvent(db, { eventType: "crm_stage_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_pipeline_stage", targetId: updated.id, metadata: { fields: Object.keys(values).filter((k) => k !== "updatedAt" && k !== "revision") } });
  return updated as CrmPipelineStage;
}

export interface ReorderStageInput {
  organizationId: string;
  pipelineId: string;
  stageId: string;
  targetIndex: number;
  actorUserId: string;
}

/** Gap-based reorder (1000-increments) — identical mechanism `project_phases.reorderPhase` established: move only the target stage's own sequence to the midpoint of its new neighbors; fall back to a full renumber only when a gap is exhausted. */
export async function reorderStage(db: Db, input: ReorderStageInput): Promise<CrmPipelineStage[]> {
  const pipeline = await resolvePipelineById(db, input.organizationId, input.pipelineId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: pipeline.workspaceId, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_pipeline_stage", input.stageId);

  const all = await db.select().from(crmPipelineStages).where(eq(crmPipelineStages.pipelineId, pipeline.id)).orderBy(asc(crmPipelineStages.sequence));
  const moving = all.find((s) => s.id === input.stageId);
  if (!moving) throw new TenantResourceNotFoundError();

  const rest = all.filter((s) => s.id !== input.stageId);
  const clampedIndex = Math.max(0, Math.min(input.targetIndex, rest.length));
  const before = rest[clampedIndex - 1];
  const after = rest[clampedIndex];

  let newSequence: number;
  if (!before && !after) newSequence = SEQUENCE_GAP;
  else if (!before) newSequence = after.sequence - SEQUENCE_GAP > 0 ? after.sequence - SEQUENCE_GAP : Math.floor(after.sequence / 2);
  else if (!after) newSequence = before.sequence + SEQUENCE_GAP;
  else newSequence = Math.floor((before.sequence + after.sequence) / 2);

  const gapExhausted = (before && newSequence <= before.sequence) || (after && newSequence >= after.sequence) || newSequence < 1;

  if (gapExhausted) {
    const reordered = [...rest.slice(0, clampedIndex), moving, ...rest.slice(clampedIndex)];
    for (let i = 0; i < reordered.length; i++) {
      await db.update(crmPipelineStages).set({ sequence: (i + 1) * SEQUENCE_GAP, revision: reordered[i].revision + 1, updatedAt: new Date() }).where(eq(crmPipelineStages.id, reordered[i].id));
    }
  } else {
    const updated = await db
      .update(crmPipelineStages)
      .set({ sequence: newSequence, revision: moving.revision + 1, updatedAt: new Date() })
      .where(and(eq(crmPipelineStages.id, moving.id), eq(crmPipelineStages.revision, moving.revision)))
      .returning();
    if (updated.length === 0) throw new StaleCrmUpdateError("stage");
  }

  await recordAuditEvent(db, { eventType: "crm_stage_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_pipeline_stage", targetId: input.stageId, metadata: { reordered: true } });

  const finalStages = await db.select().from(crmPipelineStages).where(eq(crmPipelineStages.pipelineId, pipeline.id)).orderBy(asc(crmPipelineStages.sequence));
  return finalStages as CrmPipelineStage[];
}
