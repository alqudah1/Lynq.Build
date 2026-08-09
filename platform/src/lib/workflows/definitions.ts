import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, or, isNull, inArray, desc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { workflowDefinitions, workspaceMemberships, workspaces } from "@/db/schema";
import { requireOrganizationMembership, requireTenantScopedResource } from "@/lib/authz/helpers";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { resolveWorkflowAuthContext, requireWorkflowCreateAuthority, requireWorkflowViewAuthority, requireWorkflowManageAuthority } from "./authz";
import { WorkflowKeyAlreadyTakenError, InvalidWorkflowTransitionError, StaleWorkflowUpdateError } from "./errors";
import type { WorkflowDefinitionStatus } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface WorkflowDefinition {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  name: string;
  workflowKey: string;
  description: string | null;
  status: WorkflowDefinitionStatus;
  currentPublishedVersionId: string | null;
  isTemplate: boolean;
  createdByUserId: string | null;
  revision: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDefinition(row: typeof workflowDefinitions.$inferSelect): WorkflowDefinition {
  return {
    id: row.id,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    name: row.name,
    workflowKey: row.workflowKey,
    description: row.description,
    status: row.status,
    currentPublishedVersionId: row.currentPublishedVersionId,
    isTemplate: row.isTemplate,
    createdByUserId: row.createdByUserId,
    revision: row.revision,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface CreateWorkflowDefinitionInput {
  organizationId: string;
  workspaceId?: string | null;
  name: string;
  workflowKey: string;
  description?: string | null;
  isTemplate?: boolean;
  actorUserId: string;
}

export async function createWorkflowDefinition(db: Db, input: CreateWorkflowDefinitionInput): Promise<WorkflowDefinition> {
  const orgMembership = await requireOrganizationMembership(db, input.organizationId, input.actorUserId);

  let workspaceRole = null;
  if (input.workspaceId) {
    const [wsRow] = await db.select({ role: workspaceMemberships.role }).from(workspaceMemberships).where(and(eq(workspaceMemberships.workspaceId, input.workspaceId), eq(workspaceMemberships.userId, input.actorUserId)));
    workspaceRole = wsRow?.role ?? null;
    const [ws] = await db.select({ id: workspaces.id }).from(workspaces).where(and(eq(workspaces.id, input.workspaceId), eq(workspaces.organizationId, input.organizationId)));
    if (!ws) throw new TenantResourceNotFoundError();
  }
  requireWorkflowCreateAuthority({ orgRole: orgMembership.role, workspaceId: input.workspaceId ?? null, workspaceRole });

  const id = randomUUID();
  let row;
  try {
    [row] = await db
      .insert(workflowDefinitions)
      .values({
        id,
        organizationId: input.organizationId,
        workspaceId: input.workspaceId ?? null,
        name: input.name,
        workflowKey: input.workflowKey,
        description: input.description ?? null,
        isTemplate: input.isTemplate ?? false,
        createdByUserId: input.actorUserId,
      })
      .returning();
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new WorkflowKeyAlreadyTakenError(input.workflowKey);
    throw err;
  }

  await recordAuditEvent(db, { eventType: "workflow_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "workflow_definition", targetId: id, metadata: { workflowKey: input.workflowKey, workspaceScoped: Boolean(input.workspaceId) } });

  return toDefinition(row);
}

export async function resolveWorkflowDefinitionById(db: Db, organizationId: string, definitionId: string): Promise<WorkflowDefinition> {
  const row = await requireTenantScopedResource(async () => {
    const [found] = await db.select().from(workflowDefinitions).where(and(eq(workflowDefinitions.id, definitionId), eq(workflowDefinitions.organizationId, organizationId)));
    return found;
  });
  return toDefinition(row);
}

export async function getWorkflowDefinitionForUser(db: Db, input: { organizationId: string; definitionId: string; actorUserId: string }): Promise<WorkflowDefinition> {
  const definition = await resolveWorkflowDefinitionById(db, input.organizationId, input.definitionId);
  const ctx = await resolveWorkflowAuthContext(db, { organizationId: input.organizationId, workspaceId: definition.workspaceId, actorUserId: input.actorUserId });
  await requireWorkflowViewAuthority(db, ctx, definition.id);
  return definition;
}

export interface ListWorkflowDefinitionsInput {
  organizationId: string;
  actorUserId: string;
  workspaceId?: string;
  status?: WorkflowDefinitionStatus;
  isTemplate?: boolean;
}

/** Org owner/admin see every definition; everyone else sees org-wide (non-workspace-scoped) definitions plus any workspace-scoped definition for a workspace they belong to. */
export async function listWorkflowDefinitionsForUser(db: Db, input: ListWorkflowDefinitionsInput): Promise<WorkflowDefinition[]> {
  const membership = await requireOrganizationMembership(db, input.organizationId, input.actorUserId);
  const isAdmin = membership.role === "owner" || membership.role === "admin";

  const conditions = [eq(workflowDefinitions.organizationId, input.organizationId)];
  if (input.workspaceId) conditions.push(eq(workflowDefinitions.workspaceId, input.workspaceId));
  if (input.status) conditions.push(eq(workflowDefinitions.status, input.status));
  if (input.isTemplate !== undefined) conditions.push(eq(workflowDefinitions.isTemplate, input.isTemplate));

  if (isAdmin) {
    const rows = await db.select().from(workflowDefinitions).where(and(...conditions)).orderBy(desc(workflowDefinitions.updatedAt));
    return rows.map(toDefinition);
  }

  const memberWorkspaceIds = await db.select({ workspaceId: workspaceMemberships.workspaceId }).from(workspaceMemberships).where(eq(workspaceMemberships.userId, input.actorUserId));
  const wsList = memberWorkspaceIds.map((r) => r.workspaceId);

  // Org-wide (unscoped) definitions are visible to every organization member; a workspace-scoped definition additionally requires membership in that specific workspace.
  const scopeCondition = or(isNull(workflowDefinitions.workspaceId), wsList.length > 0 ? inArray(workflowDefinitions.workspaceId, wsList) : undefined)!;
  conditions.push(scopeCondition);

  const rows = await db.select().from(workflowDefinitions).where(and(...conditions)).orderBy(desc(workflowDefinitions.updatedAt));
  return rows.map(toDefinition);
}

export interface UpdateWorkflowDefinitionInput {
  organizationId: string;
  definitionId: string;
  actorUserId: string;
  expectedRevision: number;
  updates: { name?: string; description?: string | null };
}

/** `workflowKey` is never accepted here — immutable after creation, matching Projects Core's own `projectKey` precedent. */
export async function updateWorkflowDefinition(db: Db, input: UpdateWorkflowDefinitionInput): Promise<WorkflowDefinition> {
  const definition = await resolveWorkflowDefinitionById(db, input.organizationId, input.definitionId);
  const ctx = await resolveWorkflowAuthContext(db, { organizationId: input.organizationId, workspaceId: definition.workspaceId, actorUserId: input.actorUserId });
  await requireWorkflowManageAuthority(db, ctx, definition.id);

  const [row] = await db
    .update(workflowDefinitions)
    .set({ ...input.updates, revision: input.expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(workflowDefinitions.id, definition.id), eq(workflowDefinitions.revision, input.expectedRevision)))
    .returning();

  if (!row) throw new StaleWorkflowUpdateError("workflow");

  await recordAuditEvent(db, { eventType: "workflow_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "workflow_definition", targetId: definition.id, metadata: { fields: Object.keys(input.updates) } });

  return toDefinition(row);
}

const DEFINITION_TRANSITIONS: Record<WorkflowDefinitionStatus, WorkflowDefinitionStatus[]> = {
  draft: ["archived"],
  published: ["paused", "archived"],
  paused: ["published", "archived"],
  archived: [],
};

export function getLegalWorkflowDefinitionTransitions(status: WorkflowDefinitionStatus): WorkflowDefinitionStatus[] {
  return DEFINITION_TRANSITIONS[status] ?? [];
}

export interface TransitionWorkflowDefinitionInput {
  organizationId: string;
  definitionId: string;
  toStatus: WorkflowDefinitionStatus;
  actorUserId: string;
  expectedRevision: number;
}

/** Direct human-triggered status changes only — `draft -> published` never happens here; it is an automatic side effect of `publishWorkflowVersion` publishing this definition's very first version (see `versions.ts`). */
export async function transitionWorkflowDefinitionStatus(db: Db, input: TransitionWorkflowDefinitionInput): Promise<WorkflowDefinition> {
  const definition = await resolveWorkflowDefinitionById(db, input.organizationId, input.definitionId);
  const ctx = await resolveWorkflowAuthContext(db, { organizationId: input.organizationId, workspaceId: definition.workspaceId, actorUserId: input.actorUserId });
  await requireWorkflowManageAuthority(db, ctx, definition.id);

  const legalTargets = DEFINITION_TRANSITIONS[definition.status] ?? [];
  if (!legalTargets.includes(input.toStatus)) throw new InvalidWorkflowTransitionError(definition.status, input.toStatus);

  const extra: Record<string, unknown> = {};
  if (input.toStatus === "archived") extra.archivedAt = new Date();

  const [row] = await db
    .update(workflowDefinitions)
    .set({ status: input.toStatus, revision: input.expectedRevision + 1, updatedAt: new Date(), ...extra })
    .where(and(eq(workflowDefinitions.id, definition.id), eq(workflowDefinitions.revision, input.expectedRevision), eq(workflowDefinitions.status, definition.status)))
    .returning();

  if (!row) throw new InvalidWorkflowTransitionError(definition.status, input.toStatus);

  await recordAuditEvent(db, {
    eventType: input.toStatus === "archived" ? "workflow_archived" : "workflow_updated",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "workflow_definition",
    targetId: definition.id,
    metadata: { from: definition.status, to: input.toStatus },
  });

  return toDefinition(row);
}
