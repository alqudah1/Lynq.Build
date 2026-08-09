import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { crmPipelines } from "@/db/schema";
import { requireTenantScopedResource } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { resolveCrmAuthContext, requireCrmManageAuthority, requireCrmViewAuthority } from "./authz";
import { StaleCrmUpdateError, PipelineKeyAlreadyTakenError } from "./errors";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import type { CrmPipelineStatus } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface CrmPipeline {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  name: string;
  pipelineKey: string;
  description: string | null;
  status: CrmPipelineStatus;
  isDefault: boolean;
  revision: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePipelineInput {
  organizationId: string;
  workspaceId?: string | null;
  name: string;
  pipelineKey: string;
  description?: string;
  isDefault?: boolean;
  actorUserId: string;
}

/**
 * Creates a pipeline. Setting `isDefault: true` here does NOT atomically
 * unset a prior default in the same statement (no multi-statement
 * transactions on this driver) — the real, atomic guarantee is the
 * `crm_pipelines_org_default_unique` partial unique index, which rejects a
 * second concurrent default outright rather than allowing two. Changing
 * the org's default pipeline is therefore a two-step, admin-driven
 * operation (`setDefaultPipeline`), never implicit on plain create.
 */
export async function createPipeline(db: Db, input: CreatePipelineInput): Promise<CrmPipeline> {
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: input.workspaceId ?? null, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_pipeline", "new");

  try {
    const [row] = await db
      .insert(crmPipelines)
      .values({
        organizationId: input.organizationId,
        workspaceId: input.workspaceId ?? null,
        name: input.name,
        pipelineKey: input.pipelineKey,
        description: input.description ?? null,
        isDefault: input.isDefault ?? false,
      })
      .returning();

    await recordAuditEvent(db, { eventType: "crm_pipeline_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_pipeline", targetId: row.id, metadata: { pipelineKey: row.pipelineKey } });
    return row as CrmPipeline;
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new PipelineKeyAlreadyTakenError(input.pipelineKey);
    throw err;
  }
}

export async function resolvePipelineById(db: Db, organizationId: string, pipelineId: string): Promise<CrmPipeline> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(crmPipelines).where(and(eq(crmPipelines.id, pipelineId), eq(crmPipelines.organizationId, organizationId)));
    return row as CrmPipeline | undefined;
  });
}

export async function getPipelineForUser(db: Db, input: { organizationId: string; pipelineId: string; actorUserId: string }): Promise<CrmPipeline> {
  const pipeline = await resolvePipelineById(db, input.organizationId, input.pipelineId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: pipeline.workspaceId, actorUserId: input.actorUserId });
  await requireCrmViewAuthority(db, ctx, "crm_pipeline", pipeline.id);
  return pipeline;
}

export async function listPipelinesForUser(db: Db, input: { organizationId: string; actorUserId: string; workspaceId?: string | null; status?: CrmPipelineStatus }): Promise<CrmPipeline[]> {
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: input.workspaceId ?? null, actorUserId: input.actorUserId });
  await requireCrmViewAuthority(db, ctx, "crm_pipeline", "list");

  const conditions = [eq(crmPipelines.organizationId, input.organizationId), eq(crmPipelines.status, input.status ?? "active")];
  if (input.workspaceId) conditions.push(eq(crmPipelines.workspaceId, input.workspaceId));
  const rows = await db.select().from(crmPipelines).where(and(...conditions));
  return rows as CrmPipeline[];
}

export interface UpdatePipelineInput {
  organizationId: string;
  pipelineId: string;
  expectedRevision: number;
  actorUserId: string;
  name?: string;
  description?: string | null;
  status?: CrmPipelineStatus;
}

export async function updatePipeline(db: Db, input: UpdatePipelineInput): Promise<CrmPipeline> {
  const existing = await resolvePipelineById(db, input.organizationId, input.pipelineId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: existing.workspaceId, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_pipeline", existing.id);

  const values: Record<string, unknown> = { updatedAt: new Date(), revision: input.expectedRevision + 1 };
  if (input.name !== undefined) values.name = input.name;
  if (input.description !== undefined) values.description = input.description;
  if (input.status !== undefined) {
    values.status = input.status;
    if (input.status === "archived") values.archivedAt = new Date();
  }

  const [updated] = await db
    .update(crmPipelines)
    .set(values)
    .where(and(eq(crmPipelines.id, input.pipelineId), eq(crmPipelines.organizationId, input.organizationId), eq(crmPipelines.revision, input.expectedRevision)))
    .returning();

  if (!updated) throw new StaleCrmUpdateError("pipeline");
  await recordAuditEvent(db, { eventType: "crm_pipeline_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_pipeline", targetId: updated.id, metadata: { fields: Object.keys(values).filter((k) => k !== "updatedAt" && k !== "revision") } });
  return updated as CrmPipeline;
}

/**
 * Explicitly promotes one pipeline to the org's default and demotes the
 * prior one — two sequential atomic statements (no cross-statement
 * transaction on this driver), safe specifically because the ONLY way
 * `is_default` can ever be true for two rows at once is prevented by the
 * partial unique index: the demote-then-promote order means a concurrent
 * racer hits the same index and loses, never producing two defaults.
 */
export async function setDefaultPipeline(db: Db, input: { organizationId: string; pipelineId: string; actorUserId: string }): Promise<CrmPipeline> {
  const target = await resolvePipelineById(db, input.organizationId, input.pipelineId);
  const ctx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: null, actorUserId: input.actorUserId });
  await requireCrmManageAuthority(db, ctx, "crm_pipeline", target.id);

  await db.update(crmPipelines).set({ isDefault: false, updatedAt: new Date() }).where(and(eq(crmPipelines.organizationId, input.organizationId), eq(crmPipelines.isDefault, true)));

  const [updated] = await db
    .update(crmPipelines)
    .set({ isDefault: true, updatedAt: new Date(), revision: target.revision + 1 })
    .where(and(eq(crmPipelines.id, input.pipelineId), eq(crmPipelines.organizationId, input.organizationId)))
    .returning();

  await recordAuditEvent(db, { eventType: "crm_pipeline_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_pipeline", targetId: updated.id, metadata: { isDefault: true } });
  return updated as CrmPipeline;
}
