import "server-only";
import { and, eq, inArray, lt, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { workflowExecutions, runtimeJobs, workflowNodeExecutions } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { recordWorkflowEvent } from "./events";
import { enqueueWorkflowContinuation } from "./scheduling";
import { createNodeExecution, transitionNodeExecution } from "./node-executions";
import { startOperationRun, finishOperationRun } from "@/lib/runtime/operation-runs";
import { ACTIVE_JOB_STATUSES } from "@/lib/runtime/job-queries";
import { RUNTIME_CONFIG } from "@/lib/runtime/config";

type Db = NeonHttpDatabase<Record<string, unknown>>;

const IN_PROGRESS_STATUSES = ["running", "waiting", "waiting_for_approval"] as const;

export type WorkflowReconciliationAction = "enqueue_continue" | "cancel_queued_work" | "flag_human_review" | "none";

export interface WorkflowReconciliationOutcome {
  workflowExecutionId: string;
  organizationId: string;
  detectedCase: string;
  action: WorkflowReconciliationAction;
}

async function hasActiveJobForWorkflowExecution(db: Db, workflowExecutionId: string): Promise<boolean> {
  const [row] = await db.select({ id: runtimeJobs.id }).from(runtimeJobs).where(and(eq(runtimeJobs.workflowExecutionId, workflowExecutionId), inArray(runtimeJobs.status, [...ACTIVE_JOB_STATUSES]))).limit(1);
  return Boolean(row);
}

async function recordReconciled(db: Db, workflowExecutionId: string, organizationId: string, detectedCase: string, action: WorkflowReconciliationAction): Promise<void> {
  await recordAuditEvent(db, { eventType: "workflow_reconciled", organizationId, targetType: "workflow_execution", targetId: workflowExecutionId, metadata: { detectedCase, action } });
  await recordWorkflowEvent(db, { organizationId, workflowExecutionId, eventType: "workflow_reconciled", metadata: { detectedCase, action } });
}

/**
 * ============================================================================
 * Workflow reconciliation — Module 11
 * ============================================================================
 * Extends the exact reconciliation pattern `reconciliation-executions.ts`
 * (Module 9) already established — one deterministic pass, one decision per
 * execution, every decision audited. Detects: a running/waiting execution
 * with no active job covering it (the primary "stuck" case — covers a
 * decided approval, a completed human task, a completed linked agent
 * execution, a completed project task, and an expired wait all at once,
 * since `continueWorkflowExecution` itself re-checks live state); a
 * cancelled execution with queued work still active; a completed execution
 * missing its own final event. Re-enqueuing a continuation for an
 * execution that already has one in flight is a guaranteed no-op — the
 * queue's own idempotency key de-duplicates it, never a second mechanism.
 */
export async function reconcileWorkflows(db: Db, input: { organizationId?: string } = {}): Promise<{ outcomes: WorkflowReconciliationOutcome[]; recordsExamined: number }> {
  const run = await startOperationRun(db, "workflow_reconciliation");
  await recordAuditEvent(db, { eventType: "workflow_reconciled", organizationId: input.organizationId, targetType: "runtime_operation_run", targetId: run.id, metadata: { operationType: "workflow_reconciliation", phase: "started" } });

  const outcomes: WorkflowReconciliationOutcome[] = [];
  const staleThreshold = new Date(Date.now() - RUNTIME_CONFIG.executionStuckThresholdSeconds * 1000);

  try {
    const stuckExecutions = await db
      .select()
      .from(workflowExecutions)
      .where(
        and(
          inArray(workflowExecutions.status, [...IN_PROGRESS_STATUSES]),
          lt(workflowExecutions.updatedAt, staleThreshold),
          input.organizationId ? eq(workflowExecutions.organizationId, input.organizationId) : undefined
        )
      );

    for (const execution of stuckExecutions) {
      if (await hasActiveJobForWorkflowExecution(db, execution.id)) continue;
      await enqueueWorkflowContinuation(db, { organizationId: execution.organizationId, workflowExecutionId: execution.id });
      await recordReconciled(db, execution.id, execution.organizationId, "stuck_in_progress_no_active_job", "enqueue_continue");
      outcomes.push({ workflowExecutionId: execution.id, organizationId: execution.organizationId, detectedCase: "stuck_in_progress_no_active_job", action: "enqueue_continue" });
    }

    // Module 14 — `agent_execution` nodes claim their attempt (CAS
    // "pending" → "running") before launching a real Runtime execution,
    // closing the race where two workers could otherwise both launch one
    // (see `engine.ts`'s `dispatchAsyncNode`). If the process dies between
    // that claim and persisting `runtimeExecutionId`, the attempt is stuck
    // at "running" forever — it's not "waiting", so `checkAndContinueWorkflow`
    // ignores it, and it's not "pending", so `workflow_node_execute`'s own
    // idempotency key can never re-arm it. This is that state's one
    // recovery path: a claimed-but-never-launched attempt, past the same
    // staleness threshold, with its parent execution otherwise idle, is
    // failed and a fresh attempt is opened — mirroring exactly what
    // `handleNodeFailure`'s own retry path already does for any other
    // node failure, just reached from reconciliation instead of a
    // synchronous throw.
    const staleClaimedNodes = await db
      .select()
      .from(workflowNodeExecutions)
      .where(and(eq(workflowNodeExecutions.status, "running"), isNull(workflowNodeExecutions.runtimeExecutionId), lt(workflowNodeExecutions.updatedAt, staleThreshold), input.organizationId ? eq(workflowNodeExecutions.organizationId, input.organizationId) : undefined));

    for (const nodeExec of staleClaimedNodes) {
      const [we] = await db.select().from(workflowExecutions).where(and(eq(workflowExecutions.id, nodeExec.workflowExecutionId), eq(workflowExecutions.organizationId, nodeExec.organizationId)));
      if (!we || !(IN_PROGRESS_STATUSES as readonly string[]).includes(we.status)) continue;
      if (await hasActiveJobForWorkflowExecution(db, we.id)) continue;

      const failedClaim = await transitionNodeExecution(db, { organizationId: nodeExec.organizationId, nodeExecutionId: nodeExec.id, expectedRevision: nodeExec.revision, fromStatuses: ["running"], toStatus: "failed", extra: { failureClassification: "claim_timeout", completedAt: new Date() } });
      if (!failedClaim) continue; // already resolved by someone else between the select and here.

      await createNodeExecution(db, { organizationId: nodeExec.organizationId, workflowExecutionId: nodeExec.workflowExecutionId, workflowNodeId: nodeExec.workflowNodeId, attemptNumber: nodeExec.attemptNumber + 1 });
      await enqueueWorkflowContinuation(db, { organizationId: we.organizationId, workflowExecutionId: we.id });
      await recordReconciled(db, we.id, we.organizationId, "stuck_node_claim_no_active_job", "enqueue_continue");
      outcomes.push({ workflowExecutionId: we.id, organizationId: we.organizationId, detectedCase: "stuck_node_claim_no_active_job", action: "enqueue_continue" });
    }

    const cancelledExecutions = await db
      .select()
      .from(workflowExecutions)
      .where(and(eq(workflowExecutions.status, "cancelled"), input.organizationId ? eq(workflowExecutions.organizationId, input.organizationId) : undefined));

    for (const execution of cancelledExecutions) {
      const activeJobs = await db.select().from(runtimeJobs).where(and(eq(runtimeJobs.workflowExecutionId, execution.id), inArray(runtimeJobs.status, [...ACTIVE_JOB_STATUSES])));
      if (activeJobs.length === 0) continue;
      for (const job of activeJobs) {
        await db.update(runtimeJobs).set({ status: "cancelled", completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, revision: job.revision + 1, updatedAt: new Date() }).where(eq(runtimeJobs.id, job.id));
      }
      await recordReconciled(db, execution.id, execution.organizationId, "cancelled_with_queued_work", "cancel_queued_work");
      outcomes.push({ workflowExecutionId: execution.id, organizationId: execution.organizationId, detectedCase: "cancelled_with_queued_work", action: "cancel_queued_work" });
    }

    const { workflowExecutionEvents } = await import("@/db/schema");
    const completedExecutions = await db
      .select()
      .from(workflowExecutions)
      .where(and(eq(workflowExecutions.status, "completed"), input.organizationId ? eq(workflowExecutions.organizationId, input.organizationId) : undefined));

    for (const execution of completedExecutions) {
      const [event] = await db
        .select({ id: workflowExecutionEvents.id })
        .from(workflowExecutionEvents)
        .where(and(eq(workflowExecutionEvents.workflowExecutionId, execution.id), eq(workflowExecutionEvents.eventType, "workflow_execution_completed")))
        .limit(1);
      if (event) continue;
      await recordReconciled(db, execution.id, execution.organizationId, "completed_missing_final_event", "flag_human_review");
      outcomes.push({ workflowExecutionId: execution.id, organizationId: execution.organizationId, detectedCase: "completed_missing_final_event", action: "flag_human_review" });
    }

    const recordsExamined = stuckExecutions.length + staleClaimedNodes.length + cancelledExecutions.length + completedExecutions.length;
    await recordAuditEvent(db, { eventType: "workflow_reconciled", organizationId: input.organizationId, targetType: "runtime_operation_run", targetId: run.id, metadata: { operationType: "workflow_reconciliation", phase: "completed", outcomeCount: outcomes.length } });
    await finishOperationRun(db, run.id, { recordsExamined, recordsAffected: outcomes.filter((o) => o.action !== "none").length, succeeded: true, outcomeSummary: { outcomes } });

    return { outcomes, recordsExamined };
  } catch (err) {
    await finishOperationRun(db, run.id, { recordsExamined: 0, recordsAffected: 0, succeeded: false, errorMessage: err instanceof Error ? err.message.slice(0, 1000) : String(err) });
    throw err;
  }
}
