import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { claimJobs, startJob, completeJob, reportJobFailure, type RuntimeJob } from "./queue";
import { RUNTIME_CONFIG } from "./config";
import { RUNTIME_JOB_TYPES, type JobFailureClass } from "./validation";
import { continueKnowledgeAnalystExecution, NoAccessibleDomainsError } from "@/lib/agents/knowledge-analyst";
import { continueOfficeDirectiveExecution, isOfficeDirectiveExecution } from "@/lib/office/execution";
import { reconcileToolInvocations } from "./reconciliation-tool-invocations";
import { reconcileExecutions } from "./reconciliation-executions";
import { cleanupExpiredSessions, cleanupStaleRateLimitCounters } from "./cleanup";
import { LivePermissionRevalidationFailedError, NotAssignedAgentError, InvalidExecutionTransitionError } from "@/lib/agent-runtime/errors";
import { failExecution } from "@/lib/agent-runtime/lifecycle";
import { ToolPermissionDeniedError, ToolDisabledError, ToolApprovalRequiredError } from "@/lib/tools/errors";
import { driveWorkflowForward, executeWorkflowNodeJob, continueWorkflowExecution } from "@/lib/workflows/engine";
import { reconcileWorkflows } from "@/lib/workflows/reconciliation";
import { enqueueWorkflowContinuation } from "@/lib/workflows/scheduling";
import { UnsupportedAgentDriverError } from "@/lib/workflows/errors";
import { UnsupportedAgentTaskTypeError, AgentTaskEligibilityError, InvalidAgentTaskInputError } from "@/lib/agent-runtime/task-handlers";
import { workflowNodeExecutions } from "@/db/schema";
import { processSendJob, parseMessageIdFromSendJobKey } from "@/lib/communications-os/messages";
import { reconcileCommunications } from "@/lib/communications-os/reconciliation";
import { notifyJarvisExecutionStopped } from "@/lib/email/jarvis-notifier";

type Db = NeonHttpDatabase<Record<string, unknown>>;
type RawSql = NeonQueryFunction<false, false>;

/**
 * ============================================================================
 * Worker — Module 9
 * ============================================================================
 * Orchestrates existing domain operations; never duplicates execution
 * logic. The `execution_run`/`execution_resume`/`execution_retry` job
 * types all resolve to the same call — `continueKnowledgeAnalystExecution`
 * is resumable by construction (see that module's own doc comment), so
 * there is no meaningful difference between "run it for the first time"
 * and "resume it" from the worker's point of view; the 3 job type names
 * exist for observability/audit clarity, not 3 different code paths.
 *
 * Execution jobs are dispatched by durable execution provenance: the
 * Knowledge Analyst keeps its evidence-bounded continuation, while founder
 * directives use the Office continuation. Other bounded task types remain
 * synchronous until they gain their own reviewed continuation driver.
 */
export function classifyExecutionError(err: unknown): { failureClass: JobFailureClass; errorCode: string; requiresHumanReview: boolean } {
  if (err instanceof LivePermissionRevalidationFailedError) return { failureClass: "permission_revoked", errorCode: "agent_ineligible", requiresHumanReview: false };
  if (err instanceof NoAccessibleDomainsError) return { failureClass: "permission_revoked", errorCode: "no_accessible_domains", requiresHumanReview: false };
  if (err instanceof ToolPermissionDeniedError) return { failureClass: "permission_revoked", errorCode: "tool_permission_denied", requiresHumanReview: false };
  if (err instanceof ToolDisabledError) return { failureClass: "permanent", errorCode: "tool_disabled", requiresHumanReview: false };
  if (err instanceof ToolApprovalRequiredError) return { failureClass: "unsafe_uncertain", errorCode: "approval_required", requiresHumanReview: false };
  if (err instanceof NotAssignedAgentError) return { failureClass: "permanent", errorCode: "not_assigned_agent", requiresHumanReview: true };
  if (err instanceof InvalidExecutionTransitionError) return { failureClass: "unsafe_uncertain", errorCode: "invalid_transition", requiresHumanReview: true };
  if (err instanceof UnsupportedAgentDriverError) return { failureClass: "permanent", errorCode: "unsupported_agent_driver", requiresHumanReview: true };
  if (err instanceof UnsupportedAgentTaskTypeError) return { failureClass: "permanent", errorCode: "unsupported_agent_task_type", requiresHumanReview: true };
  if (err instanceof AgentTaskEligibilityError) return { failureClass: "permanent", errorCode: "agent_task_ineligible", requiresHumanReview: true };
  if (err instanceof InvalidAgentTaskInputError) return { failureClass: "permanent", errorCode: "invalid_agent_task_input", requiresHumanReview: true };
  return { failureClass: "transient", errorCode: "runtime_error", requiresHumanReview: false };
}

function executionFailureClass(failureClass: JobFailureClass) {
  switch (failureClass) {
    case "permission_revoked":
      return "permission_failure" as const;
    case "cancelled":
      return "cancellation" as const;
    case "permanent":
      return "permanent_tool_failure" as const;
    case "unsafe_uncertain":
      return "dependency_failure" as const;
    case "transient":
      return "runtime_error" as const;
  }
}

/**
 * Module 14 — a `company_knowledge_report` `agent_execution` node's linked
 * Runtime execution completes asynchronously, through THIS job, not the
 * `workflow_node_execute`/`workflow_continue` jobs that dispatched it.
 * Without an explicit nudge here, the linked workflow would only resume
 * once the periodic `workflow_reconcile` sweep notices it's stuck — slow,
 * and never exercised in this exact form before (Sales OS's agent tasks
 * complete synchronously and need no such nudge; Module 11 shipped with no
 * end-to-end `agent_execution` test at all). Mirrors the exact pattern
 * `notifyApprovalDecided`/`notifyProjectTaskChanged` already use for
 * approval/project_task nodes: a cheap, idempotent "is anything actually
 * linked?" check, then `enqueueWorkflowContinuation` — never a duplicate
 * mechanism, and a safe no-op when this execution isn't linked to any
 * workflow node at all (the vast majority of Knowledge Analyst tasks,
 * launched directly rather than through a workflow).
 */
async function notifyLinkedWorkflowNodeIfAny(db: Db, organizationId: string, runtimeExecutionId: string): Promise<void> {
  const [row] = await db
    .select({ workflowExecutionId: workflowNodeExecutions.workflowExecutionId })
    .from(workflowNodeExecutions)
    .where(and(eq(workflowNodeExecutions.runtimeExecutionId, runtimeExecutionId), eq(workflowNodeExecutions.organizationId, organizationId)));
  if (!row) return;
  await enqueueWorkflowContinuation(db, { organizationId, workflowExecutionId: row.workflowExecutionId });
}

async function runExecutionJob(db: Db, rawSql: RawSql, job: RuntimeJob): Promise<unknown> {
  if (!job.executionId || !job.organizationId) throw new Error("execution job is missing executionId/organizationId");
  if (await isOfficeDirectiveExecution(db, job.organizationId, job.executionId)) {
    const execution = await continueOfficeDirectiveExecution(db, { organizationId: job.organizationId, executionId: job.executionId });
    await notifyLinkedWorkflowNodeIfAny(db, job.organizationId, job.executionId);
    return { executionStatus: execution.status, source: "office_directive" };
  }
  const result = await continueKnowledgeAnalystExecution(db, rawSql, { organizationId: job.organizationId, executionId: job.executionId });
  await notifyLinkedWorkflowNodeIfAny(db, job.organizationId, job.executionId);
  return { artifactId: result.artifactId, executionStatus: result.execution.status };
}

function requireWorkflowExecutionId(job: RuntimeJob): { organizationId: string; workflowExecutionId: string } {
  if (!job.workflowExecutionId || !job.organizationId) throw new Error("workflow job is missing workflowExecutionId/organizationId");
  return { organizationId: job.organizationId, workflowExecutionId: job.workflowExecutionId };
}

/**
 * Processes exactly one already-claimed job: respects cancellation
 * before continuing, transitions `leased -> running`, dispatches by
 * `jobType`, and reports the outcome back through the queue's own
 * single failure-policy entry point (`reportJobFailure`) — this
 * function never decides retry-vs-fail itself.
 */
export async function processClaimedJob(db: Db, rawSql: RawSql, job: RuntimeJob, leaseOwner: string): Promise<RuntimeJob> {
  await startJob(db, { jobId: job.id, leaseOwner });

  try {
    let resultRef: unknown;
    switch (job.jobType) {
      case "execution_run":
      case "execution_resume":
      case "execution_retry":
        resultRef = await runExecutionJob(db, rawSql, job);
        break;
      case "tool_invocation_reconcile": {
        const summary = await reconcileToolInvocations(db, rawSql, { organizationId: job.organizationId ?? undefined });
        resultRef = summary;
        break;
      }
      case "execution_reconcile": {
        const summary = await reconcileExecutions(db, { organizationId: job.organizationId ?? undefined });
        resultRef = summary;
        break;
      }
      case "cleanup_expired_sessions":
        resultRef = await cleanupExpiredSessions(db);
        break;
      case "cleanup_rate_limit_counters":
        resultRef = await cleanupStaleRateLimitCounters(db);
        break;
      case "workflow_start":
        await driveWorkflowForward(db, rawSql, requireWorkflowExecutionId(job));
        resultRef = { dispatched: true };
        break;
      case "workflow_node_execute":
        await executeWorkflowNodeJob(db, rawSql, requireWorkflowExecutionId(job));
        resultRef = { dispatched: true };
        break;
      case "workflow_continue":
        await continueWorkflowExecution(db, rawSql, requireWorkflowExecutionId(job));
        resultRef = { dispatched: true };
        break;
      case "workflow_reconcile": {
        const summary = await reconcileWorkflows(db, { organizationId: job.organizationId ?? undefined });
        resultRef = summary;
        break;
      }
      case "communication_send": {
        if (!job.organizationId) throw new Error("communication_send job is missing organizationId");
        const messageId = parseMessageIdFromSendJobKey(job.idempotencyKey);
        if (!messageId) throw new Error(`communication_send job has an unparseable idempotency key: ${job.idempotencyKey}`);
        resultRef = await processSendJob(db, { organizationId: job.organizationId, messageId });
        break;
      }
      case "communication_reconcile": {
        const summary = await reconcileCommunications(db, { organizationId: job.organizationId ?? undefined });
        resultRef = summary;
        break;
      }
      default: {
        const exhaustive: never = job.jobType;
        throw new Error(`unhandled job type: ${exhaustive as string}`);
      }
    }

    return await completeJob(db, { jobId: job.id, leaseOwner, resultRef });
  } catch (err) {
    const { failureClass, errorCode, requiresHumanReview } = classifyExecutionError(err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    const outcome = await reportJobFailure(db, { jobId: job.id, leaseOwner, failureClass, errorCode, errorMessage, requiresHumanReview });
    if (outcome.outcome !== "retry_scheduled" && job.organizationId && job.executionId) {
      try {
        if (await isOfficeDirectiveExecution(db, job.organizationId, job.executionId)) {
          await failExecution(db, {
            organizationId: job.organizationId,
            executionId: job.executionId,
            failureClass: executionFailureClass(failureClass),
            reason: errorMessage.slice(0, 1000),
          }).catch(() => undefined);
          await notifyJarvisExecutionStopped(db, {
            organizationId: job.organizationId,
            executionId: job.executionId,
            reason: errorMessage.slice(0, 1000),
            requiresHumanReview: outcome.outcome === "dead_lettered" || requiresHumanReview,
          });
        }
      } catch (notificationError) {
        console.error("[jarvis] terminal failure notification could not be evaluated:", notificationError instanceof Error ? notificationError.message : "unknown error");
      }
    }
    return outcome.job;
  }
}

export interface WorkerPollAndProcessInput {
  leaseOwner?: string;
  jobTypes?: readonly (typeof RUNTIME_JOB_TYPES)[number][];
  maxJobs?: number;
  /** Deterministic job targeting — real workers never set this; see `claimJobs`'s own doc comment. */
  onlyJobIds?: string[];
}

/**
 * One full poll cycle: claim up to `maxJobs` eligible jobs (fresh or
 * reclaimed from an expired lease) and process each to a terminal
 * outcome for THIS attempt (completed, retry-scheduled, failed, or
 * dead-lettered) — a single synchronous call, suited to a serverless
 * invocation triggered by `POST /api/internal/runtime/worker/poll`.
 * `leaseOwner` defaults to a fresh id per call when not supplied by the
 * caller (a long-running worker process should generate its OWN stable
 * instance id once and pass it every call, so a heartbeat between polls
 * extends the SAME lease).
 */
export async function pollAndProcess(db: Db, rawSql: RawSql, input: WorkerPollAndProcessInput = {}): Promise<{ leaseOwner: string; processed: RuntimeJob[] }> {
  const leaseOwner = input.leaseOwner ?? randomUUID();
  const jobTypes = input.jobTypes ?? RUNTIME_JOB_TYPES;
  const claimed = await claimJobs(db, rawSql, { leaseOwner, jobTypes: [...jobTypes], maxJobs: input.maxJobs ?? RUNTIME_CONFIG.maxJobsPerPoll, onlyJobIds: input.onlyJobIds });

  const processed: RuntimeJob[] = [];
  for (const { job } of claimed) {
    processed.push(await processClaimedJob(db, rawSql, job, leaseOwner));
  }

  return { leaseOwner, processed };
}
