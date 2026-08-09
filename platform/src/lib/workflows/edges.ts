import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { workflowEdges, workflowNodes } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { resolveWorkflowDefinitionById } from "./definitions";
import { resolveWorkflowVersionById } from "./versions";
import { resolveWorkflowAuthContext, requireWorkflowManageAuthority, requireWorkflowViewAuthority } from "./authz";
import { SelfEdgeError, DuplicateEdgeError, CrossVersionEdgeError, WorkflowVersionNotEditableError } from "./errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface WorkflowEdge {
  id: string;
  organizationId: string;
  workflowVersionId: string;
  sourceNodeId: string;
  targetNodeId: string;
  conditionKey: string | null;
  sequence: number;
  label: string | null;
  createdAt: Date;
}

function toEdge(row: typeof workflowEdges.$inferSelect): WorkflowEdge {
  return {
    id: row.id,
    organizationId: row.organizationId,
    workflowVersionId: row.workflowVersionId,
    sourceNodeId: row.sourceNodeId,
    targetNodeId: row.targetNodeId,
    conditionKey: row.conditionKey,
    sequence: row.sequence,
    label: row.label,
    createdAt: row.createdAt,
  };
}

async function requireEditableVersion(db: Db, organizationId: string, definitionId: string, versionId: string, actorUserId: string) {
  const definition = await resolveWorkflowDefinitionById(db, organizationId, definitionId);
  const ctx = await resolveWorkflowAuthContext(db, { organizationId, workspaceId: definition.workspaceId, actorUserId });
  await requireWorkflowManageAuthority(db, ctx, definition.id);
  const version = await resolveWorkflowVersionById(db, organizationId, versionId);
  if (version.workflowDefinitionId !== definition.id) throw new TenantResourceNotFoundError();
  if (version.status !== "draft") throw new WorkflowVersionNotEditableError(version.status);
  return { definition, version };
}

export interface CreateWorkflowEdgeInput {
  organizationId: string;
  definitionId: string;
  versionId: string;
  sourceNodeId: string;
  targetNodeId: string;
  conditionKey?: string | null;
  sequence?: number;
  label?: string | null;
  actorUserId: string;
}

export async function createWorkflowEdge(db: Db, input: CreateWorkflowEdgeInput): Promise<WorkflowEdge> {
  await requireEditableVersion(db, input.organizationId, input.definitionId, input.versionId, input.actorUserId);

  if (input.sourceNodeId === input.targetNodeId) throw new SelfEdgeError();

  // "No cross-version edge" is enforced structurally by the composite FK
  // (`workflow_edges_source_version_fk`/`_target_version_fk`, both scoped
  // to `[nodeId, workflowVersionId]`) — this pre-check exists only to
  // produce a clear application error instead of a raw FK-violation.
  const [source] = await db.select({ id: workflowNodes.id }).from(workflowNodes).where(and(eq(workflowNodes.id, input.sourceNodeId), eq(workflowNodes.workflowVersionId, input.versionId)));
  const [target] = await db.select({ id: workflowNodes.id }).from(workflowNodes).where(and(eq(workflowNodes.id, input.targetNodeId), eq(workflowNodes.workflowVersionId, input.versionId)));
  if (!source || !target) throw new CrossVersionEdgeError();

  let row;
  try {
    [row] = await db
      .insert(workflowEdges)
      .values({
        id: randomUUID(),
        organizationId: input.organizationId,
        workflowVersionId: input.versionId,
        sourceNodeId: input.sourceNodeId,
        targetNodeId: input.targetNodeId,
        conditionKey: input.conditionKey ?? null,
        sequence: input.sequence ?? 0,
        label: input.label ?? null,
      })
      .returning();
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new DuplicateEdgeError();
    throw err;
  }

  await recordAuditEvent(db, { eventType: "workflow_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "workflow_edge", targetId: row.id, metadata: { workflowVersionId: input.versionId, sourceNodeId: input.sourceNodeId, targetNodeId: input.targetNodeId } });

  return toEdge(row);
}

export async function listWorkflowEdges(db: Db, input: { organizationId: string; definitionId: string; versionId: string; actorUserId: string }): Promise<WorkflowEdge[]> {
  const definition = await resolveWorkflowDefinitionById(db, input.organizationId, input.definitionId);
  const ctx = await resolveWorkflowAuthContext(db, { organizationId: input.organizationId, workspaceId: definition.workspaceId, actorUserId: input.actorUserId });
  await requireWorkflowViewAuthority(db, ctx, definition.id);
  const version = await resolveWorkflowVersionById(db, input.organizationId, input.versionId);
  if (version.workflowDefinitionId !== definition.id) throw new TenantResourceNotFoundError();

  const rows = await db.select().from(workflowEdges).where(eq(workflowEdges.workflowVersionId, input.versionId));
  return rows.map(toEdge);
}

export async function deleteWorkflowEdge(db: Db, input: { organizationId: string; definitionId: string; versionId: string; edgeId: string; actorUserId: string }): Promise<void> {
  await requireEditableVersion(db, input.organizationId, input.definitionId, input.versionId, input.actorUserId);

  const [existing] = await db.select({ id: workflowEdges.id }).from(workflowEdges).where(and(eq(workflowEdges.id, input.edgeId), eq(workflowEdges.workflowVersionId, input.versionId)));
  if (!existing) throw new TenantResourceNotFoundError();

  await db.delete(workflowEdges).where(eq(workflowEdges.id, existing.id));

  await recordAuditEvent(db, { eventType: "workflow_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "workflow_edge", targetId: existing.id, metadata: { deleted: true } });
}
