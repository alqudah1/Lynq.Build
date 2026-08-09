import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, desc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { workflowVersions, workflowNodes, workflowEdges, workflowDefinitions } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { resolveWorkflowDefinitionById } from "./definitions";
import { resolveWorkflowAuthContext, requireWorkflowManageAuthority, requireWorkflowViewAuthority } from "./authz";
import { StaleWorkflowUpdateError, WorkflowVersionNotEditableError, WorkflowValidationFailedError, WorkflowNotPublishedError } from "./errors";
import { validateWorkflowGraph, type WorkflowValidationResult } from "./graph-validation";
import type { WorkflowVersionStatus } from "./validation";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface WorkflowVersion {
  id: string;
  organizationId: string;
  workflowDefinitionId: string;
  versionNumber: number;
  status: WorkflowVersionStatus;
  name: string;
  description: string | null;
  inputSchema: unknown;
  outputSchema: unknown;
  createdByUserId: string | null;
  changeReason: string | null;
  validationResult: WorkflowValidationResult | null;
  publishedAt: Date | null;
  revision: number;
  createdAt: Date;
}

function toVersion(row: typeof workflowVersions.$inferSelect): WorkflowVersion {
  return {
    id: row.id,
    organizationId: row.organizationId,
    workflowDefinitionId: row.workflowDefinitionId,
    versionNumber: row.versionNumber,
    status: row.status,
    name: row.name,
    description: row.description,
    inputSchema: row.inputSchema,
    outputSchema: row.outputSchema,
    createdByUserId: row.createdByUserId,
    changeReason: row.changeReason,
    validationResult: row.validationResult as WorkflowValidationResult | null,
    publishedAt: row.publishedAt,
    revision: row.revision,
    createdAt: row.createdAt,
  };
}

export interface CreateWorkflowVersionInput {
  organizationId: string;
  definitionId: string;
  name?: string;
  description?: string | null;
  inputSchema?: unknown;
  outputSchema?: unknown;
  changeReason?: string | null;
  actorUserId: string;
  /** Clone nodes/edges from an existing version (typically the current published one) as the new draft's starting point — "editing a published workflow creates a new draft version," not a blank graph. */
  cloneFromVersionId?: string;
}

/** Always a new draft — never mutates an existing version. */
export async function createWorkflowVersion(db: Db, input: CreateWorkflowVersionInput): Promise<WorkflowVersion> {
  const definition = await resolveWorkflowDefinitionById(db, input.organizationId, input.definitionId);
  const ctx = await resolveWorkflowAuthContext(db, { organizationId: input.organizationId, workspaceId: definition.workspaceId, actorUserId: input.actorUserId });
  await requireWorkflowManageAuthority(db, ctx, definition.id);

  const [last] = await db.select({ versionNumber: workflowVersions.versionNumber }).from(workflowVersions).where(eq(workflowVersions.workflowDefinitionId, definition.id)).orderBy(desc(workflowVersions.versionNumber)).limit(1);
  const versionNumber = (last?.versionNumber ?? 0) + 1;

  const id = randomUUID();
  const [row] = await db
    .insert(workflowVersions)
    .values({
      id,
      organizationId: input.organizationId,
      workflowDefinitionId: definition.id,
      versionNumber,
      name: input.name ?? definition.name,
      description: input.description ?? definition.description,
      inputSchema: (input.inputSchema ?? null) as object | null,
      outputSchema: (input.outputSchema ?? null) as object | null,
      createdByUserId: input.actorUserId,
      changeReason: input.changeReason ?? null,
    })
    .returning();

  if (input.cloneFromVersionId) {
    await cloneGraph(db, { organizationId: input.organizationId, fromVersionId: input.cloneFromVersionId, toVersionId: id });
  }

  await recordAuditEvent(db, { eventType: "workflow_version_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "workflow_version", targetId: id, metadata: { workflowDefinitionId: definition.id, versionNumber } });

  return toVersion(row);
}

async function cloneGraph(db: Db, input: { organizationId: string; fromVersionId: string; toVersionId: string }): Promise<void> {
  const sourceNodes = await db.select().from(workflowNodes).where(and(eq(workflowNodes.workflowVersionId, input.fromVersionId), eq(workflowNodes.organizationId, input.organizationId)));
  const sourceEdges = await db.select().from(workflowEdges).where(and(eq(workflowEdges.workflowVersionId, input.fromVersionId), eq(workflowEdges.organizationId, input.organizationId)));

  const idMap = new Map<string, string>();
  for (const node of sourceNodes) {
    const newId = randomUUID();
    idMap.set(node.id, newId);
    await db.insert(workflowNodes).values({
      id: newId,
      organizationId: input.organizationId,
      workflowVersionId: input.toVersionId,
      nodeKey: node.nodeKey,
      nodeType: node.nodeType,
      name: node.name,
      description: node.description,
      configuration: node.configuration as object,
      inputMapping: node.inputMapping as object,
      outputMapping: node.outputMapping as object,
      retryPolicy: node.retryPolicy as object,
      timeoutPolicy: node.timeoutPolicy as object,
      positionX: node.positionX,
      positionY: node.positionY,
    });
  }

  for (const edge of sourceEdges) {
    const newSource = idMap.get(edge.sourceNodeId);
    const newTarget = idMap.get(edge.targetNodeId);
    if (!newSource || !newTarget) continue;
    await db.insert(workflowEdges).values({
      id: randomUUID(),
      organizationId: input.organizationId,
      workflowVersionId: input.toVersionId,
      sourceNodeId: newSource,
      targetNodeId: newTarget,
      conditionKey: edge.conditionKey,
      sequence: edge.sequence,
      label: edge.label,
    });
  }
}

export async function resolveWorkflowVersionById(db: Db, organizationId: string, versionId: string): Promise<WorkflowVersion> {
  const [row] = await db.select().from(workflowVersions).where(and(eq(workflowVersions.id, versionId), eq(workflowVersions.organizationId, organizationId)));
  if (!row) throw new TenantResourceNotFoundError();
  return toVersion(row);
}

export async function getWorkflowVersionForUser(db: Db, input: { organizationId: string; definitionId: string; versionId: string; actorUserId: string }): Promise<WorkflowVersion> {
  const definition = await resolveWorkflowDefinitionById(db, input.organizationId, input.definitionId);
  const ctx = await resolveWorkflowAuthContext(db, { organizationId: input.organizationId, workspaceId: definition.workspaceId, actorUserId: input.actorUserId });
  await requireWorkflowViewAuthority(db, ctx, definition.id);
  const version = await resolveWorkflowVersionById(db, input.organizationId, input.versionId);
  if (version.workflowDefinitionId !== definition.id) throw new TenantResourceNotFoundError();
  return version;
}

export async function listWorkflowVersions(db: Db, input: { organizationId: string; definitionId: string; actorUserId: string }): Promise<WorkflowVersion[]> {
  const definition = await resolveWorkflowDefinitionById(db, input.organizationId, input.definitionId);
  const ctx = await resolveWorkflowAuthContext(db, { organizationId: input.organizationId, workspaceId: definition.workspaceId, actorUserId: input.actorUserId });
  await requireWorkflowViewAuthority(db, ctx, definition.id);

  const rows = await db.select().from(workflowVersions).where(eq(workflowVersions.workflowDefinitionId, definition.id)).orderBy(desc(workflowVersions.versionNumber));
  return rows.map(toVersion);
}

export interface UpdateWorkflowVersionInput {
  organizationId: string;
  definitionId: string;
  versionId: string;
  expectedRevision: number;
  actorUserId: string;
  updates: { name?: string; description?: string | null; inputSchema?: unknown; outputSchema?: unknown };
}

/** Only a `draft` version may be edited — publishing makes it permanently immutable. */
export async function updateWorkflowVersion(db: Db, input: UpdateWorkflowVersionInput): Promise<WorkflowVersion> {
  const definition = await resolveWorkflowDefinitionById(db, input.organizationId, input.definitionId);
  const ctx = await resolveWorkflowAuthContext(db, { organizationId: input.organizationId, workspaceId: definition.workspaceId, actorUserId: input.actorUserId });
  await requireWorkflowManageAuthority(db, ctx, definition.id);

  const version = await resolveWorkflowVersionById(db, input.organizationId, input.versionId);
  if (version.workflowDefinitionId !== definition.id) throw new TenantResourceNotFoundError();
  if (version.status !== "draft") throw new WorkflowVersionNotEditableError(version.status);

  const [row] = await db
    .update(workflowVersions)
    .set({ ...input.updates, inputSchema: input.updates.inputSchema as object | undefined, outputSchema: input.updates.outputSchema as object | undefined, revision: input.expectedRevision + 1 })
    .where(and(eq(workflowVersions.id, version.id), eq(workflowVersions.revision, input.expectedRevision)))
    .returning();

  if (!row) throw new StaleWorkflowUpdateError("workflow version");
  return toVersion(row);
}

export interface ValidateWorkflowVersionInput {
  organizationId: string;
  definitionId: string;
  versionId: string;
  actorUserId: string;
}

/** Runs the deterministic graph-validation pass and persists the structured result. A version passing validation moves `draft -> valid`; a version failing stays `draft` (so it can be fixed and re-validated), with the failing result still recorded for the UI's own validation panel. */
export async function validateWorkflowVersionAndPersist(db: Db, input: ValidateWorkflowVersionInput): Promise<WorkflowValidationResult> {
  const definition = await resolveWorkflowDefinitionById(db, input.organizationId, input.definitionId);
  const ctx = await resolveWorkflowAuthContext(db, { organizationId: input.organizationId, workspaceId: definition.workspaceId, actorUserId: input.actorUserId });
  await requireWorkflowManageAuthority(db, ctx, definition.id);

  const version = await resolveWorkflowVersionById(db, input.organizationId, input.versionId);
  if (version.workflowDefinitionId !== definition.id) throw new TenantResourceNotFoundError();
  if (version.status !== "draft" && version.status !== "valid") throw new WorkflowVersionNotEditableError(version.status);

  const result = await validateWorkflowGraph(db, { organizationId: input.organizationId, versionId: version.id });

  await db
    .update(workflowVersions)
    .set({ status: result.valid ? "valid" : "draft", validationResult: result as object, revision: version.revision + 1 })
    .where(eq(workflowVersions.id, version.id));

  await recordAuditEvent(db, { eventType: "workflow_version_validated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "workflow_version", targetId: version.id, metadata: { valid: result.valid, issueCount: result.issues.length } });

  return result;
}

export interface PublishWorkflowVersionInput {
  organizationId: string;
  definitionId: string;
  versionId: string;
  expectedRevision: number;
  actorUserId: string;
}

/**
 * Atomic and concurrency-safe on the ONE invariant that actually matters —
 * "only one current published version may exist" — via the real, partial
 * Postgres unique index `workflow_versions_one_published_unique`, checked
 * on the promoting `UPDATE` itself. The definition's own
 * `currentPublishedVersionId` pointer is a denormalized fast-path cache
 * only; `resolvePublishedVersion` (below) never trusts it blindly, always
 * re-verifying against the versions table directly — so even a rare
 * pointer-update lag (the neon-http driver has no multi-statement
 * transaction to make this whole function one atomic unit — the same
 * documented, structural limitation already noted for Module 10's
 * execution-launch guard) can never let the system disagree with itself
 * about which version is actually live.
 */
export async function publishWorkflowVersion(db: Db, input: PublishWorkflowVersionInput): Promise<WorkflowVersion> {
  const definition = await resolveWorkflowDefinitionById(db, input.organizationId, input.definitionId);
  const ctx = await resolveWorkflowAuthContext(db, { organizationId: input.organizationId, workspaceId: definition.workspaceId, actorUserId: input.actorUserId });
  await requireWorkflowManageAuthority(db, ctx, definition.id);

  const version = await resolveWorkflowVersionById(db, input.organizationId, input.versionId);
  if (version.workflowDefinitionId !== definition.id) throw new TenantResourceNotFoundError();
  if (version.status !== "valid") throw new WorkflowValidationFailedError([{ message: `version must pass validation (currently "${version.status}") before publishing` }]);

  if (definition.currentPublishedVersionId && definition.currentPublishedVersionId !== version.id) {
    await db.update(workflowVersions).set({ status: "superseded" }).where(and(eq(workflowVersions.id, definition.currentPublishedVersionId), eq(workflowVersions.status, "published")));
  }

  let row;
  try {
    [row] = await db
      .update(workflowVersions)
      .set({ status: "published", publishedAt: new Date(), revision: input.expectedRevision + 1 })
      .where(and(eq(workflowVersions.id, version.id), eq(workflowVersions.revision, input.expectedRevision), eq(workflowVersions.status, "valid")))
      .returning();
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new StaleWorkflowUpdateError("workflow version (another version was published concurrently)");
    throw err;
  }
  if (!row) throw new StaleWorkflowUpdateError("workflow version");

  const freshDefinition = await resolveWorkflowDefinitionById(db, input.organizationId, input.definitionId);
  await updateDefinitionPointer(db, freshDefinition.id, freshDefinition.organizationId, version.id, freshDefinition.revision, freshDefinition.status);

  await recordAuditEvent(db, { eventType: "workflow_version_published", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "workflow_version", targetId: version.id, metadata: { workflowDefinitionId: definition.id, versionNumber: version.versionNumber } });

  return toVersion(row);
}

async function updateDefinitionPointer(db: Db, definitionId: string, organizationId: string, versionId: string, expectedRevision: number, currentStatus: string): Promise<void> {
  const nextStatus = currentStatus === "draft" ? "published" : currentStatus;
  await db
    .update(workflowDefinitions)
    .set({ currentPublishedVersionId: versionId, status: nextStatus as "draft" | "published" | "paused" | "archived", revision: expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(workflowDefinitions.id, definitionId), eq(workflowDefinitions.organizationId, organizationId), eq(workflowDefinitions.revision, expectedRevision)));
}

/** The authoritative "what is currently published" resolver — never trusts the definition's own cached pointer, always re-verified live. Throws if nothing is currently published. */
export async function resolvePublishedVersion(db: Db, organizationId: string, definitionId: string): Promise<WorkflowVersion> {
  const [row] = await db.select().from(workflowVersions).where(and(eq(workflowVersions.workflowDefinitionId, definitionId), eq(workflowVersions.organizationId, organizationId), eq(workflowVersions.status, "published")));
  if (!row) throw new WorkflowNotPublishedError();
  return toVersion(row);
}
