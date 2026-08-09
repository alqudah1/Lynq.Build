import "server-only";
import { and, eq, inArray, lt } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { agentExecutions, runtimeJobs, agentApprovalRequests, agentExecutionEvents } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { recordExecutionEvent } from "@/lib/agent-runtime/events";
import { getUnresolvedDependencies } from "@/lib/agent-runtime/dependencies";
import { expirePendingApprovals } from "@/lib/agent-runtime/approvals";
import { enqueueJob } from "./queue";
import { RUNTIME_CONFIG } from "./config";
import { startOperationRun, finishOperationRun } from "./operation-runs";
import { hasActiveJobForExecution, ACTIVE_JOB_STATUSES } from "./job-queries";

type Db = NeonHttpDatabase<Record<string, unknown>>;

const IN_PROGRESS_EXECUTION_STATUSES = ["gathering_context", "planning", "reasoning", "waiting", "executing", "delegating", "verifying"] as const;

export type ExecutionReconciliationAction = "enqueue_resume" | "cancel_queued_work" | "mark_failed" | "flag_human_review" | "none";

export interface ExecutionReconciliationOutcome {
  executionId: string;
  organizationId: string;
  detectedCase: string;
  action: ExecutionReconciliationAction;
}

async function recordReconciled(db: Db, executionId: string, organizationId: string, detectedCase: string, action: ExecutionReconciliationAction): Promise<void> {
  await recordAuditEvent(db, {
    eventType: "execution_reconciled",
    organizationId,
    targetType: "agent_execution",
    targetId: executionId,
    metadata: { detectedCase, action },
  });
  await recordExecutionEvent(db, { organizationId, executionId, eventType: "agent_execution_conflict", metadata: { reconciliation: true, detectedCase, action } });
}

async function enqueueResume(db: Db, execution: { id: string; organizationId: string; workspaceId: string | null }): Promise<void> {
  await enqueueJob(db, {
    organizationId: execution.organizationId,
    workspaceId: execution.workspaceId,
    jobType: "execution_resume",
    executionId: execution.id,
    idempotencyKey: `exec:${execution.id}`,
  });
}

/**
 * ============================================================================
 * Execution reconciliation — Module 9
 * ============================================================================
 * §8's "reconciliation pass finds every task last recorded as 'in
 * progress' with no recent heartbeat, and resumes each from its last
 * durable checkpoint," made concrete. One deterministic pass, one
 * decision per execution, every decision audited — never a silent state
 * change.
 */
export async function reconcileExecutions(db: Db, input: { organizationId?: string } = {}): Promise<{ outcomes: ExecutionReconciliationOutcome[]; recordsExamined: number }> {
  const run = await startOperationRun(db, "execution_reconciliation");
  await recordAuditEvent(db, { eventType: "runtime_reconciliation_started", organizationId: input.organizationId ?? undefined, targetType: "runtime_operation_run", targetId: run.id, metadata: { operationType: "execution_reconciliation" } });

  const outcomes: ExecutionReconciliationOutcome[] = [];
  const staleThreshold = new Date(Date.now() - RUNTIME_CONFIG.executionStuckThresholdSeconds * 1000);

  try {
    // "Expired approval requests" cleanup — folded into this pass rather
    // than a dedicated job type (the approved narrow job-type list has
    // no slot for it): expire every organization's own overdue pending
    // approvals, scoped to the caller's org if given, or every org that
    // currently has one overdue if this is a global sweep.
    if (input.organizationId) {
      await expirePendingApprovals(db, input.organizationId);
    } else {
      const overdueOrgs = await db
        .selectDistinct({ organizationId: agentApprovalRequests.organizationId })
        .from(agentApprovalRequests)
        .where(and(eq(agentApprovalRequests.status, "pending"), lt(agentApprovalRequests.expiresAt, new Date())));
      for (const { organizationId } of overdueOrgs) {
        await expirePendingApprovals(db, organizationId);
      }
    }

    // Case: in-progress (including "waiting", folding in "waiting with an
    // expired retry time" as the same underlying condition — an
    // in-progress execution with no active job and stale `updatedAt`)
    // AND stuck beyond the threshold, with no active job already
    // covering it.
    const staleActive = await db
      .select()
      .from(agentExecutions)
      .where(
        and(
          inArray(agentExecutions.status, [...IN_PROGRESS_EXECUTION_STATUSES]),
          lt(agentExecutions.updatedAt, staleThreshold),
          input.organizationId ? eq(agentExecutions.organizationId, input.organizationId) : undefined
        )
      );

    for (const execution of staleActive) {
      if (await hasActiveJobForExecution(db, execution.id)) continue;

      // "Waiting for a dependency" sub-case: if unresolved dependencies
      // remain, this isn't actually stuck — it's correctly waiting on
      // something else; leave it alone rather than forcing a resume that
      // would just re-wait.
      if (execution.status === "waiting") {
        const unresolved = await getUnresolvedDependencies(db, execution.organizationId, execution.id);
        if (unresolved.length > 0) {
          outcomes.push({ executionId: execution.id, organizationId: execution.organizationId, detectedCase: "waiting_on_unresolved_dependency", action: "none" });
          continue;
        }
      }

      await enqueueResume(db, execution);
      await recordReconciled(db, execution.id, execution.organizationId, "stuck_in_progress_no_active_job", "enqueue_resume");
      outcomes.push({ executionId: execution.id, organizationId: execution.organizationId, detectedCase: "stuck_in_progress_no_active_job", action: "enqueue_resume" });
    }

    // Case: paused at human_approval, but the request was already
    // decided `approved` — `approveRequest` should have already moved
    // the execution back to `executing`; if it's still sitting here,
    // something interrupted that transition. Safe to resume: the next
    // continuation call re-validates everything live before doing
    // anything.
    const pausedAfterApproval = await db
      .select({ execution: agentExecutions })
      .from(agentExecutions)
      .innerJoin(agentApprovalRequests, eq(agentApprovalRequests.executionId, agentExecutions.id))
      .where(
        and(
          eq(agentExecutions.status, "human_approval"),
          eq(agentApprovalRequests.status, "approved"),
          input.organizationId ? eq(agentExecutions.organizationId, input.organizationId) : undefined
        )
      );

    for (const { execution } of pausedAfterApproval) {
      if (await hasActiveJobForExecution(db, execution.id)) continue;
      await enqueueResume(db, execution);
      await recordReconciled(db, execution.id, execution.organizationId, "paused_after_approval_decided", "enqueue_resume");
      outcomes.push({ executionId: execution.id, organizationId: execution.organizationId, detectedCase: "paused_after_approval_decided", action: "enqueue_resume" });
    }

    // Case: completed but missing its own required completion event —
    // cannot be safely auto-repaired (we don't know WHY it's missing),
    // so this is flagged for human review only, never silently patched.
    const completedExecutions = await db
      .select()
      .from(agentExecutions)
      .where(and(eq(agentExecutions.status, "completed"), input.organizationId ? eq(agentExecutions.organizationId, input.organizationId) : undefined));

    for (const execution of completedExecutions) {
      const [event] = await db
        .select({ id: agentExecutionEvents.id })
        .from(agentExecutionEvents)
        .where(and(eq(agentExecutionEvents.executionId, execution.id), eq(agentExecutionEvents.eventType, "agent_execution_completed")))
        .limit(1);
      if (event) continue;

      await recordReconciled(db, execution.id, execution.organizationId, "completed_missing_final_event", "flag_human_review");
      outcomes.push({ executionId: execution.id, organizationId: execution.organizationId, detectedCase: "completed_missing_final_event", action: "flag_human_review" });
    }

    // Case: cancelled while work remains queued — cancel the orphaned jobs too.
    const cancelledExecutions = await db
      .select()
      .from(agentExecutions)
      .where(and(eq(agentExecutions.status, "cancelled"), input.organizationId ? eq(agentExecutions.organizationId, input.organizationId) : undefined));

    for (const execution of cancelledExecutions) {
      const activeJobs = await db
        .select()
        .from(runtimeJobs)
        .where(and(eq(runtimeJobs.executionId, execution.id), inArray(runtimeJobs.status, [...ACTIVE_JOB_STATUSES])));
      if (activeJobs.length === 0) continue;

      for (const job of activeJobs) {
        await db.update(runtimeJobs).set({ status: "cancelled", completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, revision: job.revision + 1, updatedAt: new Date() }).where(eq(runtimeJobs.id, job.id));
        await recordAuditEvent(db, { eventType: "runtime_job_cancelled", organizationId: execution.organizationId, targetType: "runtime_job", targetId: job.id, metadata: { reason: "execution_already_cancelled" } });
      }
      await recordReconciled(db, execution.id, execution.organizationId, "cancelled_with_queued_work", "cancel_queued_work");
      outcomes.push({ executionId: execution.id, organizationId: execution.organizationId, detectedCase: "cancelled_with_queued_work", action: "cancel_queued_work" });
    }

    await recordAuditEvent(db, { eventType: "runtime_reconciliation_completed", organizationId: input.organizationId ?? undefined, targetType: "runtime_operation_run", targetId: run.id, metadata: { outcomeCount: outcomes.length } });
    await finishOperationRun(db, run.id, { recordsExamined: staleActive.length + pausedAfterApproval.length + completedExecutions.length + cancelledExecutions.length, recordsAffected: outcomes.filter((o) => o.action !== "none").length, succeeded: true, outcomeSummary: { outcomes } });

    return { outcomes, recordsExamined: staleActive.length + pausedAfterApproval.length + completedExecutions.length + cancelledExecutions.length };
  } catch (err) {
    await finishOperationRun(db, run.id, { recordsExamined: 0, recordsAffected: 0, succeeded: false, errorMessage: err instanceof Error ? err.message.slice(0, 1000) : String(err) });
    throw err;
  }
}
