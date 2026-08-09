import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, or, inArray, desc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { workflowExecutions, workflowNodeExecutions, projects, projectTasks, projectMembers, runtimeJobs } from "@/db/schema";
import { requireOrganizationMembership, requireWorkspaceMembership } from "@/lib/authz/helpers";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { recordAuditEvent } from "@/lib/audit";
import { resolveWorkflowDefinitionById } from "./definitions";
import { resolvePublishedVersion } from "./versions";
import { resolveWorkflowAuthContext, requireWorkflowStartAuthority, requireWorkflowExecutionViewAuthority, requireWorkflowExecutionManageAuthority } from "./authz";
import { recordWorkflowEvent, listWorkflowEvents } from "./events";
import { createNodeExecution } from "./node-executions";
import { InvalidWorkflowExecutionTransitionError } from "./errors";
import { enqueueJob } from "@/lib/runtime/queue";
import type { WorkflowExecutionStatus } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

const MAX_WORKFLOW_INPUT_BYTES = 20_000;

export interface WorkflowExecution {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  workflowDefinitionId: string;
  workflowVersionId: string;
  status: WorkflowExecutionStatus;
  initiatorUserId: string | null;
  projectId: string | null;
  projectTaskId: string | null;
  input: Record<string, unknown>;
  currentNodeId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  failureClassification: string | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

function toExecution(row: typeof workflowExecutions.$inferSelect): WorkflowExecution {
  return {
    id: row.id,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    workflowDefinitionId: row.workflowDefinitionId,
    workflowVersionId: row.workflowVersionId,
    status: row.status,
    initiatorUserId: row.initiatorUserId,
    projectId: row.projectId,
    projectTaskId: row.projectTaskId,
    input: (row.input ?? {}) as Record<string, unknown>,
    currentNodeId: row.currentNodeId,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    cancelledAt: row.cancelledAt,
    failureClassification: row.failureClassification,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface StartWorkflowExecutionInput {
  organizationId: string;
  definitionId: string;
  projectId?: string | null;
  projectTaskId?: string | null;
  input?: Record<string, unknown>;
  actorUserId: string;
}

/** Creates a durable execution instance of a workflow's current published version, then enqueues `workflow_start` through the existing runtime queue — never executed synchronously inside this call. */
export async function startWorkflowExecution(db: Db, input: StartWorkflowExecutionInput): Promise<WorkflowExecution> {
  const definition = await resolveWorkflowDefinitionById(db, input.organizationId, input.definitionId);
  if (definition.status !== "published") {
    throw new InvalidWorkflowExecutionTransitionError(`definition:${definition.status}`, "execution:queued");
  }

  const ctx = await resolveWorkflowAuthContext(db, { organizationId: input.organizationId, workspaceId: definition.workspaceId, actorUserId: input.actorUserId });
  await requireWorkflowStartAuthority(db, ctx, definition.id, input.projectId ?? null);

  if (definition.workspaceId) {
    await requireWorkspaceMembership(db, definition.workspaceId, input.actorUserId);
  } else {
    await requireOrganizationMembership(db, input.organizationId, input.actorUserId);
  }

  const version = await resolvePublishedVersion(db, input.organizationId, definition.id);

  if (input.projectId) {
    const [project] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, input.projectId), eq(projects.organizationId, input.organizationId)));
    if (!project) throw new TenantResourceNotFoundError();
  }
  if (input.projectTaskId) {
    const [task] = await db.select({ id: projectTasks.id, projectId: projectTasks.projectId }).from(projectTasks).where(and(eq(projectTasks.id, input.projectTaskId), eq(projectTasks.organizationId, input.organizationId)));
    if (!task || (input.projectId && task.projectId !== input.projectId)) throw new TenantResourceNotFoundError();
  }

  const boundedInput = input.input ?? {};
  if (JSON.stringify(boundedInput).length > MAX_WORKFLOW_INPUT_BYTES) {
    throw new InvalidWorkflowExecutionTransitionError("input_too_large", "queued");
  }

  const id = randomUUID();
  const [row] = await db
    .insert(workflowExecutions)
    .values({
      id,
      organizationId: input.organizationId,
      workspaceId: definition.workspaceId,
      workflowDefinitionId: definition.id,
      workflowVersionId: version.id,
      initiatorUserId: input.actorUserId,
      projectId: input.projectId ?? null,
      projectTaskId: input.projectTaskId ?? null,
      input: boundedInput,
    })
    .returning();

  await recordAuditEvent(db, { eventType: "workflow_execution_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "workflow_execution", targetId: id, metadata: { workflowDefinitionId: definition.id, workflowVersionId: version.id, projectId: input.projectId ?? null } });
  await recordWorkflowEvent(db, { organizationId: input.organizationId, workflowExecutionId: id, eventType: "workflow_execution_created", actorUserId: input.actorUserId, metadata: { versionNumber: version.versionNumber } });

  await enqueueJob(db, { organizationId: input.organizationId, workspaceId: definition.workspaceId, jobType: "workflow_start", workflowExecutionId: id, idempotencyKey: `wf-start:${id}` });

  return toExecution(row);
}

export async function resolveWorkflowExecutionById(db: Db, organizationId: string, executionId: string): Promise<WorkflowExecution> {
  const [row] = await db.select().from(workflowExecutions).where(and(eq(workflowExecutions.id, executionId), eq(workflowExecutions.organizationId, organizationId)));
  if (!row) throw new TenantResourceNotFoundError();
  return toExecution(row);
}

export async function getWorkflowExecutionForUser(db: Db, input: { organizationId: string; executionId: string; actorUserId: string }): Promise<WorkflowExecution> {
  const execution = await resolveWorkflowExecutionById(db, input.organizationId, input.executionId);
  const definition = await resolveWorkflowDefinitionById(db, input.organizationId, execution.workflowDefinitionId);
  const ctx = await resolveWorkflowAuthContext(db, { organizationId: input.organizationId, workspaceId: definition.workspaceId, actorUserId: input.actorUserId });
  await requireWorkflowExecutionViewAuthority(db, ctx, execution.id, execution.projectId);
  return execution;
}

export interface ListWorkflowExecutionsInput {
  organizationId: string;
  actorUserId: string;
  workflowDefinitionId?: string;
  status?: WorkflowExecutionStatus;
  projectId?: string;
}

export async function listWorkflowExecutionsForUser(db: Db, input: ListWorkflowExecutionsInput): Promise<WorkflowExecution[]> {
  const membership = await requireOrganizationMembership(db, input.organizationId, input.actorUserId);
  const isAdmin = membership.role === "owner" || membership.role === "admin";

  const conditions = [eq(workflowExecutions.organizationId, input.organizationId)];
  if (input.workflowDefinitionId) conditions.push(eq(workflowExecutions.workflowDefinitionId, input.workflowDefinitionId));
  if (input.status) conditions.push(eq(workflowExecutions.status, input.status));
  if (input.projectId) conditions.push(eq(workflowExecutions.projectId, input.projectId));

  if (isAdmin) {
    const rows = await db.select().from(workflowExecutions).where(and(...conditions)).orderBy(desc(workflowExecutions.createdAt)).limit(100);
    return rows.map(toExecution);
  }

  // Non-admins see: executions they started, plus executions linked to a project they belong to.
  const memberProjectIds = await db.select({ projectId: projectMembers.projectId }).from(projectMembers).where(eq(projectMembers.userId, input.actorUserId));
  const projectIds = memberProjectIds.map((r) => r.projectId);

  const visibility = or(eq(workflowExecutions.initiatorUserId, input.actorUserId), projectIds.length > 0 ? inArray(workflowExecutions.projectId, projectIds) : undefined)!;
  conditions.push(visibility);

  const rows = await db.select().from(workflowExecutions).where(and(...conditions)).orderBy(desc(workflowExecutions.createdAt)).limit(100);
  return rows.map(toExecution);
}

async function transitionExecution(db: Db, executionId: string, organizationId: string, expectedRevision: number, fromStatuses: WorkflowExecutionStatus[], toStatus: WorkflowExecutionStatus, extra: Record<string, unknown> = {}): Promise<WorkflowExecution | null> {
  const [row] = await db
    .update(workflowExecutions)
    .set({ status: toStatus, revision: expectedRevision + 1, updatedAt: new Date(), ...extra })
    .where(and(eq(workflowExecutions.id, executionId), eq(workflowExecutions.organizationId, organizationId), eq(workflowExecutions.revision, expectedRevision), inArray(workflowExecutions.status, fromStatuses)))
    .returning();
  return row ? toExecution(row) : null;
}

export { transitionExecution as transitionWorkflowExecutionStatus };

const PAUSABLE_STATUSES: WorkflowExecutionStatus[] = ["queued", "running", "waiting", "waiting_for_approval"];

export async function pauseWorkflowExecution(db: Db, input: { organizationId: string; executionId: string; expectedRevision: number; actorUserId: string }): Promise<WorkflowExecution> {
  const execution = await resolveWorkflowExecutionById(db, input.organizationId, input.executionId);
  const definition = await resolveWorkflowDefinitionById(db, input.organizationId, execution.workflowDefinitionId);
  const ctx = await resolveWorkflowAuthContext(db, { organizationId: input.organizationId, workspaceId: definition.workspaceId, actorUserId: input.actorUserId });
  await requireWorkflowExecutionManageAuthority(db, ctx, execution.id, { initiatorUserId: execution.initiatorUserId, projectId: execution.projectId });

  if (!PAUSABLE_STATUSES.includes(execution.status)) throw new InvalidWorkflowExecutionTransitionError(execution.status, "paused");
  const updated = await transitionExecution(db, execution.id, input.organizationId, input.expectedRevision, [execution.status], "paused");
  if (!updated) throw new InvalidWorkflowExecutionTransitionError(execution.status, "paused");

  await recordAuditEvent(db, { eventType: "workflow_execution_paused", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "workflow_execution", targetId: execution.id, metadata: { from: execution.status } });
  await recordWorkflowEvent(db, { organizationId: input.organizationId, workflowExecutionId: execution.id, eventType: "workflow_execution_paused", actorUserId: input.actorUserId });

  return updated;
}

export async function resumeWorkflowExecution(db: Db, input: { organizationId: string; executionId: string; expectedRevision: number; actorUserId: string }): Promise<WorkflowExecution> {
  const execution = await resolveWorkflowExecutionById(db, input.organizationId, input.executionId);
  const definition = await resolveWorkflowDefinitionById(db, input.organizationId, execution.workflowDefinitionId);
  const ctx = await resolveWorkflowAuthContext(db, { organizationId: input.organizationId, workspaceId: definition.workspaceId, actorUserId: input.actorUserId });
  await requireWorkflowExecutionManageAuthority(db, ctx, execution.id, { initiatorUserId: execution.initiatorUserId, projectId: execution.projectId });

  if (execution.status !== "paused") throw new InvalidWorkflowExecutionTransitionError(execution.status, "running");
  // Resume revalidates live permissions/eligibility at continuation time (in the engine), not here — this transition only re-opens the door.
  const updated = await transitionExecution(db, execution.id, input.organizationId, input.expectedRevision, ["paused"], "running");
  if (!updated) throw new InvalidWorkflowExecutionTransitionError(execution.status, "running");

  await recordAuditEvent(db, { eventType: "workflow_execution_resumed", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "workflow_execution", targetId: execution.id, metadata: {} });
  await recordWorkflowEvent(db, { organizationId: input.organizationId, workflowExecutionId: execution.id, eventType: "workflow_execution_resumed", actorUserId: input.actorUserId });

  await enqueueJob(db, { organizationId: input.organizationId, workspaceId: definition.workspaceId, jobType: "workflow_continue", workflowExecutionId: execution.id, idempotencyKey: `wf-continue:${execution.id}` } as never);

  return updated;
}

const TERMINAL_EXECUTION_STATUSES: WorkflowExecutionStatus[] = ["completed", "failed", "cancelled"];

export async function cancelWorkflowExecution(db: Db, input: { organizationId: string; executionId: string; expectedRevision: number; actorUserId: string }): Promise<WorkflowExecution> {
  const execution = await resolveWorkflowExecutionById(db, input.organizationId, input.executionId);
  const definition = await resolveWorkflowDefinitionById(db, input.organizationId, execution.workflowDefinitionId);
  const ctx = await resolveWorkflowAuthContext(db, { organizationId: input.organizationId, workspaceId: definition.workspaceId, actorUserId: input.actorUserId });
  await requireWorkflowExecutionManageAuthority(db, ctx, execution.id, { initiatorUserId: execution.initiatorUserId, projectId: execution.projectId });

  if (TERMINAL_EXECUTION_STATUSES.includes(execution.status)) throw new InvalidWorkflowExecutionTransitionError(execution.status, "cancelled");
  const updated = await transitionExecution(db, execution.id, input.organizationId, input.expectedRevision, [execution.status], "cancelled", { cancelledAt: new Date() });
  if (!updated) throw new InvalidWorkflowExecutionTransitionError(execution.status, "cancelled");

  await recordAuditEvent(db, { eventType: "workflow_execution_cancelled", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "workflow_execution", targetId: execution.id, metadata: { from: execution.status } });
  await recordWorkflowEvent(db, { organizationId: input.organizationId, workflowExecutionId: execution.id, eventType: "workflow_execution_cancelled", actorUserId: input.actorUserId });

  // Cancel queued/active workflow jobs for this execution — "cancellation propagates to queued child work where safe." Runtime-side child work (an in-flight agent execution) is governed by its own subsystem's cancellation rules, never silently overridden here.
  const activeJobs = await db.select().from(runtimeJobs).where(and(eq(runtimeJobs.workflowExecutionId, execution.id), inArray(runtimeJobs.status, ["queued", "leased", "running", "retry_scheduled"])));
  for (const job of activeJobs) {
    await db.update(runtimeJobs).set({ status: "cancelled", completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, revision: job.revision + 1, updatedAt: new Date() }).where(eq(runtimeJobs.id, job.id));
  }

  return updated;
}

/**
 * Manual override for a `failed` execution: creates a fresh attempt for
 * whichever node was current when it failed and resumes from `running` —
 * an explicit human decision to retry despite the node's own configured
 * failure policy (which already had its chance to auto-retry). Requires
 * the same manage authority as pause/resume/cancel.
 */
export async function retryWorkflowExecution(db: Db, input: { organizationId: string; executionId: string; expectedRevision: number; actorUserId: string }): Promise<WorkflowExecution> {
  const execution = await resolveWorkflowExecutionById(db, input.organizationId, input.executionId);
  const definition = await resolveWorkflowDefinitionById(db, input.organizationId, execution.workflowDefinitionId);
  const ctx = await resolveWorkflowAuthContext(db, { organizationId: input.organizationId, workspaceId: definition.workspaceId, actorUserId: input.actorUserId });
  await requireWorkflowExecutionManageAuthority(db, ctx, execution.id, { initiatorUserId: execution.initiatorUserId, projectId: execution.projectId });

  if (execution.status !== "failed") throw new InvalidWorkflowExecutionTransitionError(execution.status, "running");
  if (!execution.currentNodeId) throw new InvalidWorkflowExecutionTransitionError(execution.status, "running");

  const [lastAttempt] = await db
    .select()
    .from(workflowNodeExecutions)
    .where(and(eq(workflowNodeExecutions.workflowExecutionId, execution.id), eq(workflowNodeExecutions.workflowNodeId, execution.currentNodeId)))
    .orderBy(desc(workflowNodeExecutions.attemptNumber))
    .limit(1);

  await createNodeExecution(db, { organizationId: input.organizationId, workflowExecutionId: execution.id, workflowNodeId: execution.currentNodeId, attemptNumber: (lastAttempt?.attemptNumber ?? 0) + 1 });

  const updated = await transitionExecution(db, execution.id, input.organizationId, input.expectedRevision, ["failed"], "running", { failureClassification: null });
  if (!updated) throw new InvalidWorkflowExecutionTransitionError(execution.status, "running");

  await recordAuditEvent(db, { eventType: "workflow_execution_resumed", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "workflow_execution", targetId: execution.id, metadata: { manualRetry: true } });
  await recordWorkflowEvent(db, { organizationId: input.organizationId, workflowExecutionId: execution.id, eventType: "workflow_execution_resumed", actorUserId: input.actorUserId, metadata: { manualRetry: true } });

  await enqueueJob(db, { organizationId: input.organizationId, workspaceId: definition.workspaceId, jobType: "workflow_continue", workflowExecutionId: execution.id, idempotencyKey: `wf-continue:${execution.id}:manual-retry:${Date.now()}` });

  return updated;
}

export async function listWorkflowExecutionTimeline(db: Db, input: { organizationId: string; executionId: string; actorUserId: string; limit?: number }) {
  await getWorkflowExecutionForUser(db, input);
  return listWorkflowEvents(db, input.executionId, input.limit);
}
