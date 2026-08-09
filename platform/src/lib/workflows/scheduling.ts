import "server-only";
import { eq, and, inArray } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { workflowExecutions, workflowNodeExecutions } from "@/db/schema";
import { enqueueJob } from "@/lib/runtime/queue";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * The one place every "something changed, the workflow may be able to
 * proceed" signal funnels through — a human completed a task, an approval
 * was decided, a linked project task reached a terminal state. Reuses the
 * queue's own idempotent-enqueue behavior (`enqueueJob`'s partial unique
 * index on active jobs) as the sole de-duplication mechanism: if
 * reconciliation ALSO enqueues the identical continuation before this one
 * is claimed, the second call is a no-op by construction — "duplicate
 * continuation jobs do not duplicate work," satisfied by the same real
 * constraint Module 9 already provides, not a second mechanism.
 */
export async function enqueueWorkflowContinuation(db: Db, input: { organizationId: string; workflowExecutionId: string }): Promise<void> {
  const [execution] = await db.select({ workspaceId: workflowExecutions.workspaceId }).from(workflowExecutions).where(and(eq(workflowExecutions.id, input.workflowExecutionId), eq(workflowExecutions.organizationId, input.organizationId)));
  await enqueueJob(db, {
    organizationId: input.organizationId,
    workspaceId: execution?.workspaceId ?? null,
    jobType: "workflow_continue",
    workflowExecutionId: input.workflowExecutionId,
    idempotencyKey: `wf-continue:${input.workflowExecutionId}`,
  });
}

/**
 * Approval decisions and project-task completions happen through OTHER
 * modules' own, unmodified functions (`approveRequest`/`rejectRequest` —
 * Module 7; `transitionTaskStatus` — Module 10) — this module must never
 * reach into either to add workflow-specific side effects. Instead, the
 * few call sites that trigger these two external events (this module's
 * own dashboard actions, and — as a generic catch-all — periodic
 * reconciliation) opportunistically call one of these two functions
 * afterward: a cheap, indexed lookup for a `waiting` node execution
 * carrying this exact approval/task id, and — only if one exists — an
 * `enqueueWorkflowContinuation` call. A non-workflow-linked approval or
 * task is a guaranteed no-op here, never an error.
 */
export async function notifyApprovalDecided(db: Db, input: { organizationId: string; approvalRequestId: string }): Promise<void> {
  const [nodeExecution] = await db
    .select({ id: workflowNodeExecutions.id, workflowExecutionId: workflowNodeExecutions.workflowExecutionId })
    .from(workflowNodeExecutions)
    .where(and(eq(workflowNodeExecutions.organizationId, input.organizationId), eq(workflowNodeExecutions.approvalRequestId, input.approvalRequestId), inArray(workflowNodeExecutions.status, ["waiting"])));
  if (!nodeExecution) return;
  await enqueueWorkflowContinuation(db, { organizationId: input.organizationId, workflowExecutionId: nodeExecution.workflowExecutionId });
}

export async function notifyProjectTaskChanged(db: Db, input: { organizationId: string; projectTaskId: string }): Promise<void> {
  const [nodeExecution] = await db
    .select({ id: workflowNodeExecutions.id, workflowExecutionId: workflowNodeExecutions.workflowExecutionId })
    .from(workflowNodeExecutions)
    .where(and(eq(workflowNodeExecutions.organizationId, input.organizationId), eq(workflowNodeExecutions.projectTaskId, input.projectTaskId), inArray(workflowNodeExecutions.status, ["waiting"])));
  if (!nodeExecution) return;
  await enqueueWorkflowContinuation(db, { organizationId: input.organizationId, workflowExecutionId: nodeExecution.workflowExecutionId });
}
