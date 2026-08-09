import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, asc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { workflowNodes } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { resolveWorkflowDefinitionById } from "./definitions";
import { resolveWorkflowVersionById } from "./versions";
import { resolveWorkflowAuthContext, requireWorkflowManageAuthority, requireWorkflowViewAuthority } from "./authz";
import { DuplicateNodeKeyError, StaleWorkflowUpdateError, WorkflowVersionNotEditableError, InvalidNodeConfigurationError } from "./errors";
import { nodeConfigSchemaFor, nodeMappingSchema, retryPolicySchema, timeoutPolicySchema, type WorkflowNodeType } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface WorkflowNode {
  id: string;
  organizationId: string;
  workflowVersionId: string;
  nodeKey: string;
  nodeType: WorkflowNodeType;
  name: string;
  description: string | null;
  configuration: Record<string, unknown>;
  inputMapping: Record<string, unknown>;
  outputMapping: Record<string, unknown>;
  retryPolicy: Record<string, unknown>;
  timeoutPolicy: Record<string, unknown>;
  positionX: number;
  positionY: number;
  createdAt: Date;
}

function toNode(row: typeof workflowNodes.$inferSelect): WorkflowNode {
  return {
    id: row.id,
    organizationId: row.organizationId,
    workflowVersionId: row.workflowVersionId,
    nodeKey: row.nodeKey,
    nodeType: row.nodeType,
    name: row.name,
    description: row.description,
    configuration: row.configuration as Record<string, unknown>,
    inputMapping: row.inputMapping as Record<string, unknown>,
    outputMapping: row.outputMapping as Record<string, unknown>,
    retryPolicy: row.retryPolicy as Record<string, unknown>,
    timeoutPolicy: row.timeoutPolicy as Record<string, unknown>,
    positionX: row.positionX,
    positionY: row.positionY,
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

export interface CreateWorkflowNodeInput {
  organizationId: string;
  definitionId: string;
  versionId: string;
  nodeKey: string;
  nodeType: WorkflowNodeType;
  name: string;
  description?: string | null;
  configuration?: unknown;
  inputMapping?: unknown;
  outputMapping?: unknown;
  retryPolicy?: unknown;
  timeoutPolicy?: unknown;
  positionX?: number;
  positionY?: number;
  actorUserId: string;
}

export async function createWorkflowNode(db: Db, input: CreateWorkflowNodeInput): Promise<WorkflowNode> {
  await requireEditableVersion(db, input.organizationId, input.definitionId, input.versionId, input.actorUserId);

  const configSchema = nodeConfigSchemaFor(input.nodeType);
  const parsedConfig = configSchema.safeParse(input.configuration ?? {});
  if (!parsedConfig.success) throw new InvalidNodeConfigurationError(parsedConfig.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));

  const parsedInputMapping = nodeMappingSchema.safeParse(input.inputMapping ?? {});
  if (!parsedInputMapping.success) throw new InvalidNodeConfigurationError(`inputMapping: ${parsedInputMapping.error.issues.map((i) => i.message).join("; ")}`);
  const parsedOutputMapping = nodeMappingSchema.safeParse(input.outputMapping ?? {});
  if (!parsedOutputMapping.success) throw new InvalidNodeConfigurationError(`outputMapping: ${parsedOutputMapping.error.issues.map((i) => i.message).join("; ")}`);
  const parsedRetry = retryPolicySchema.safeParse(input.retryPolicy ?? {});
  if (!parsedRetry.success) throw new InvalidNodeConfigurationError(`retryPolicy: ${parsedRetry.error.issues.map((i) => i.message).join("; ")}`);
  const parsedTimeout = timeoutPolicySchema.safeParse(input.timeoutPolicy ?? {});
  if (!parsedTimeout.success) throw new InvalidNodeConfigurationError(`timeoutPolicy: ${parsedTimeout.error.issues.map((i) => i.message).join("; ")}`);

  let row;
  try {
    [row] = await db
      .insert(workflowNodes)
      .values({
        id: randomUUID(),
        organizationId: input.organizationId,
        workflowVersionId: input.versionId,
        nodeKey: input.nodeKey,
        nodeType: input.nodeType,
        name: input.name,
        description: input.description ?? null,
        configuration: parsedConfig.data as object,
        inputMapping: parsedInputMapping.data as object,
        outputMapping: parsedOutputMapping.data as object,
        retryPolicy: parsedRetry.data as object,
        timeoutPolicy: parsedTimeout.data as object,
        positionX: input.positionX ?? 0,
        positionY: input.positionY ?? 0,
      })
      .returning();
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new DuplicateNodeKeyError(input.nodeKey);
    throw err;
  }

  await recordAuditEvent(db, { eventType: "workflow_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "workflow_node", targetId: row.id, metadata: { workflowVersionId: input.versionId, nodeType: input.nodeType, nodeKey: input.nodeKey } });

  return toNode(row);
}

export async function listWorkflowNodes(db: Db, input: { organizationId: string; definitionId: string; versionId: string; actorUserId: string }): Promise<WorkflowNode[]> {
  const definition = await resolveWorkflowDefinitionById(db, input.organizationId, input.definitionId);
  const ctx = await resolveWorkflowAuthContext(db, { organizationId: input.organizationId, workspaceId: definition.workspaceId, actorUserId: input.actorUserId });
  await requireWorkflowViewAuthority(db, ctx, definition.id);
  const version = await resolveWorkflowVersionById(db, input.organizationId, input.versionId);
  if (version.workflowDefinitionId !== definition.id) throw new TenantResourceNotFoundError();

  const rows = await db.select().from(workflowNodes).where(eq(workflowNodes.workflowVersionId, input.versionId)).orderBy(asc(workflowNodes.createdAt));
  return rows.map(toNode);
}

export interface UpdateWorkflowNodeInput {
  organizationId: string;
  definitionId: string;
  versionId: string;
  nodeId: string;
  actorUserId: string;
  updates: {
    name?: string;
    description?: string | null;
    configuration?: unknown;
    inputMapping?: unknown;
    outputMapping?: unknown;
    retryPolicy?: unknown;
    timeoutPolicy?: unknown;
    positionX?: number;
    positionY?: number;
  };
}

export async function updateWorkflowNode(db: Db, input: UpdateWorkflowNodeInput): Promise<WorkflowNode> {
  await requireEditableVersion(db, input.organizationId, input.definitionId, input.versionId, input.actorUserId);

  const [existing] = await db.select().from(workflowNodes).where(and(eq(workflowNodes.id, input.nodeId), eq(workflowNodes.workflowVersionId, input.versionId)));
  if (!existing) throw new TenantResourceNotFoundError();

  const set: Record<string, unknown> = {};
  if (input.updates.name !== undefined) set.name = input.updates.name;
  if (input.updates.description !== undefined) set.description = input.updates.description;
  if (input.updates.positionX !== undefined) set.positionX = input.updates.positionX;
  if (input.updates.positionY !== undefined) set.positionY = input.updates.positionY;

  if (input.updates.configuration !== undefined) {
    const parsed = nodeConfigSchemaFor(existing.nodeType).safeParse(input.updates.configuration);
    if (!parsed.success) throw new InvalidNodeConfigurationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    set.configuration = parsed.data;
  }
  if (input.updates.inputMapping !== undefined) {
    const parsed = nodeMappingSchema.safeParse(input.updates.inputMapping);
    if (!parsed.success) throw new InvalidNodeConfigurationError(`inputMapping: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    set.inputMapping = parsed.data;
  }
  if (input.updates.outputMapping !== undefined) {
    const parsed = nodeMappingSchema.safeParse(input.updates.outputMapping);
    if (!parsed.success) throw new InvalidNodeConfigurationError(`outputMapping: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    set.outputMapping = parsed.data;
  }
  if (input.updates.retryPolicy !== undefined) {
    const parsed = retryPolicySchema.safeParse(input.updates.retryPolicy);
    if (!parsed.success) throw new InvalidNodeConfigurationError(`retryPolicy: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    set.retryPolicy = parsed.data;
  }
  if (input.updates.timeoutPolicy !== undefined) {
    const parsed = timeoutPolicySchema.safeParse(input.updates.timeoutPolicy);
    if (!parsed.success) throw new InvalidNodeConfigurationError(`timeoutPolicy: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    set.timeoutPolicy = parsed.data;
  }

  const [row] = await db.update(workflowNodes).set(set).where(eq(workflowNodes.id, existing.id)).returning();
  if (!row) throw new StaleWorkflowUpdateError("workflow node");

  await recordAuditEvent(db, { eventType: "workflow_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "workflow_node", targetId: existing.id, metadata: { fields: Object.keys(input.updates) } });

  return toNode(row);
}

export async function deleteWorkflowNode(db: Db, input: { organizationId: string; definitionId: string; versionId: string; nodeId: string; actorUserId: string }): Promise<void> {
  await requireEditableVersion(db, input.organizationId, input.definitionId, input.versionId, input.actorUserId);

  const [existing] = await db.select({ id: workflowNodes.id }).from(workflowNodes).where(and(eq(workflowNodes.id, input.nodeId), eq(workflowNodes.workflowVersionId, input.versionId)));
  if (!existing) throw new TenantResourceNotFoundError();

  await db.delete(workflowNodes).where(eq(workflowNodes.id, existing.id));

  await recordAuditEvent(db, { eventType: "workflow_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "workflow_node", targetId: existing.id, metadata: { deleted: true } });
}
