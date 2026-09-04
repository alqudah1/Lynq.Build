import "server-only";
import { and, eq, desc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { agentApprovalRequests, agentDelegations, agentExecutionEvents } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { resolveAgentById } from "@/lib/agents/agents";
import { requireExecutionManageAuthority, requireAssignedAgent, revalidateAgentEligibility } from "./authz";
import { resolveExecutionById, transitionExecutionStatus, type AgentExecution, type AgentExecutionStatus } from "./executions";
import { assembleExecutionContext } from "./context";
import { createCheckpoint, resolveResumeCheckpoint } from "./checkpoints";
import { getPlanSteps } from "./plans";
import { recordExecutionEvent } from "./events";
import {
  InvalidExecutionTransitionError,
  InsufficientCompletionEvidenceError,
  RetryLimitExceededError,
  FailureNotRetryableError,
} from "./errors";
import { FAILURE_CLASSES, type FailureClass } from "./failures";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Execution lifecycle — Module 7, §1's exact state diagram
 * ============================================================================
 *
 * One shared primitive (`transitionExecutionStatus`, `executions.ts`)
 * underlies every function below: an atomic `UPDATE ... WHERE status IN
 * (legal source states) AND revision = expected`. A `null` result always
 * means "re-fetch and decide" — the caller cannot distinguish a stale
 * revision from an illegal transition, matching this codebase's own
 * established `InvalidLifecycleTransitionError` precedent (Brain Module
 * 8/9) applied here as `InvalidExecutionTransitionError`.
 */

async function recordConflict(db: Db, executionId: string, organizationId: string, from: string, to: string): Promise<void> {
  await recordAuditEvent(db, {
    eventType: "agent_execution_conflict",
    organizationId,
    targetType: "agent_execution",
    targetId: executionId,
    metadata: { attemptedFrom: from, attemptedTo: to },
  });
}

export interface AssignExecutionInput {
  organizationId: string;
  executionId: string;
  assignedAgentId: string;
  actorUserId: string;
}

/** `queued → assigned`. Human-management-gated (who may hand work to whom). Snapshots the agent's CURRENT `currentVersionNumber` — the Execution Context's own reproducibility requirement (§3) starts here, at the moment of assignment, not later. */
export async function assignExecution(db: Db, input: AssignExecutionInput): Promise<AgentExecution> {
  const existing = await resolveExecutionById(db, input.organizationId, input.executionId);
  await requireExecutionManageAuthority(db, { organizationId: input.organizationId, workspaceId: existing.workspaceId, ownerUserId: existing.ownerUserId, actorUserId: input.actorUserId });

  const agent = await resolveAgentById(db, input.assignedAgentId);
  if (!agent || agent.organizationId !== input.organizationId || agent.lifecycleStage === "retired") {
    throw new InvalidExecutionTransitionError(existing.status, "assigned");
  }

  const updated = await transitionExecutionStatus(db, {
    executionId: input.executionId,
    organizationId: input.organizationId,
    expectedRevision: existing.revision,
    fromStatuses: ["queued"],
    toStatus: "assigned",
    extraSet: { assignedAgentId: input.assignedAgentId, assignedAgentVersionNumber: agent.currentVersionNumber },
  });

  if (!updated) {
    await recordConflict(db, input.executionId, input.organizationId, existing.status, "assigned");
    throw new InvalidExecutionTransitionError(existing.status, "assigned");
  }

  await recordExecutionEvent(db, {
    organizationId: input.organizationId,
    executionId: input.executionId,
    eventType: "agent_execution_assigned",
    fromStatus: "queued",
    toStatus: "assigned",
    actorUserId: input.actorUserId,
    metadata: { assignedAgentId: input.assignedAgentId, assignedAgentVersionNumber: agent.currentVersionNumber },
  });

  return updated;
}

export interface StartExecutionInput {
  organizationId: string;
  executionId: string;
  actorUserId: string;
}

/** `assigned → gathering_context`. Assembles and persists the immutable Execution Context snapshot (§3) and writes the first durable checkpoint — the real starting point of an execution's actual work. */
export async function startExecution(db: Db, input: StartExecutionInput): Promise<AgentExecution> {
  const existing = await resolveExecutionById(db, input.organizationId, input.executionId);
  await requireExecutionManageAuthority(db, { organizationId: input.organizationId, workspaceId: existing.workspaceId, ownerUserId: existing.ownerUserId, actorUserId: input.actorUserId });

  if (!existing.assignedAgentId || existing.assignedAgentVersionNumber === null) {
    throw new InvalidExecutionTransitionError(existing.status, "gathering_context");
  }
  await revalidateAgentEligibility(db, input.organizationId, existing.assignedAgentId);
  const agent = await resolveAgentById(db, existing.assignedAgentId);
  if (!agent) throw new InvalidExecutionTransitionError(existing.status, "gathering_context");

  const priorEvents = await db.select({ id: agentExecutionEvents.id }).from(agentExecutionEvents).where(eq(agentExecutionEvents.executionId, input.executionId));

  const contextSnapshot = await assembleExecutionContext(db, {
    organizationId: input.organizationId,
    workspaceId: existing.workspaceId,
    initiatingUserId: existing.initiatingUserId,
    ownerUserId: existing.ownerUserId,
    assignedAgentId: existing.assignedAgentId,
    assignedAgentVersionNumber: existing.assignedAgentVersionNumber,
    assignedAgentPermissionLevel: agent.permissionLevel,
    assignedAgentDepartment: agent.department,
    goal: existing.goal,
    domainsRequested: existing.domainsRequested,
    parentExecutionId: existing.parentExecutionId,
    rootExecutionId: existing.rootExecutionId,
    delegationDepth: existing.delegationDepth,
    priorEventCount: priorEvents.length,
  });

  const updated = await transitionExecutionStatus(db, {
    executionId: input.executionId,
    organizationId: input.organizationId,
    expectedRevision: existing.revision,
    fromStatuses: ["assigned"],
    toStatus: "gathering_context",
    extraSet: { contextSnapshot, startedAt: new Date() },
  });

  if (!updated) {
    await recordConflict(db, input.executionId, input.organizationId, existing.status, "gathering_context");
    throw new InvalidExecutionTransitionError(existing.status, "gathering_context");
  }

  await createCheckpoint(db, { organizationId: input.organizationId, executionId: input.executionId, statusAtCheckpoint: "gathering_context", actorUserId: input.actorUserId, safeStateSummary: { assembledContext: true } });

  await recordExecutionEvent(db, {
    organizationId: input.organizationId,
    executionId: input.executionId,
    eventType: "agent_execution_started",
    fromStatus: "assigned",
    toStatus: "gathering_context",
    actorUserId: input.actorUserId,
  });

  return updated;
}

/**
 * §1's forward/loop-back edges reachable by the assigned agent's own work,
 * collapsed into one validated-adjacency function rather than one
 * near-identical named function per edge — the adjacency map below is the
 * single, auditable source of truth for "which agent-driven transitions
 * are legal," matching the diagram exactly.
 */
const AGENT_DRIVEN_EDGES: Record<string, AgentExecutionStatus[]> = {
  gathering_context: ["planning"],
  planning: ["reasoning"],
  reasoning: ["planning", "waiting", "executing"],
  waiting: ["reasoning"],
  executing: ["delegating", "human_approval", "verifying", "waiting"],
  delegating: ["waiting"],
  human_approval: ["executing", "planning"],
  verifying: ["completed", "planning"],
};

export interface AdvanceExecutionInput {
  organizationId: string;
  executionId: string;
  toStatus: AgentExecutionStatus;
  actorAgentId: string;
  waitReason?: string | null;
}

/** The agent's own progression through Planning/Reasoning/Executing/Waiting/Delegating/HumanApproval/Verifying — never Completed (see `completeExecution`'s own evidence gate) and never Cancelled/Failed (see their own dedicated functions, which record a real reason). */
export async function advanceExecution(db: Db, input: AdvanceExecutionInput): Promise<AgentExecution> {
  if (input.toStatus === "completed" || input.toStatus === "cancelled" || input.toStatus === "failed") {
    throw new InvalidExecutionTransitionError("*", input.toStatus);
  }

  const existing = await resolveExecutionById(db, input.organizationId, input.executionId);
  requireAssignedAgent(existing, input.actorAgentId);
  await revalidateAgentEligibility(db, input.organizationId, input.actorAgentId);

  const legalTargets = AGENT_DRIVEN_EDGES[existing.status] ?? [];
  if (!legalTargets.includes(input.toStatus)) {
    await recordConflict(db, input.executionId, input.organizationId, existing.status, input.toStatus);
    throw new InvalidExecutionTransitionError(existing.status, input.toStatus);
  }

  const updated = await transitionExecutionStatus(db, {
    executionId: input.executionId,
    organizationId: input.organizationId,
    expectedRevision: existing.revision,
    fromStatuses: [existing.status],
    toStatus: input.toStatus,
    extraSet: { waitReason: input.toStatus === "waiting" ? (input.waitReason ?? "unspecified") : null },
  });

  if (!updated) {
    await recordConflict(db, input.executionId, input.organizationId, existing.status, input.toStatus);
    throw new InvalidExecutionTransitionError(existing.status, input.toStatus);
  }

  await recordExecutionEvent(db, {
    organizationId: input.organizationId,
    executionId: input.executionId,
    eventType: "agent_task_created",
    fromStatus: existing.status,
    toStatus: input.toStatus,
    actorAgentId: input.actorAgentId,
    metadata: input.toStatus === "waiting" ? { waitReason: input.waitReason ?? "unspecified" } : undefined,
  });

  return updated;
}

export interface CompleteExecutionInput {
  organizationId: string;
  executionId: string;
  actorAgentId: string;
}

/**
 * `verifying → completed`. §12's "hallucinated execution" gate, encoded
 * structurally: completion requires every step of the CURRENT plan
 * version to have reached a terminal, non-failed status (`completed` or
 * `skipped`) — never the agent's own narrative claim alone. An execution
 * with no plan at all (nothing ever required planning) has no steps to
 * check and passes vacuously — but an execution WITH a plan whose steps
 * aren't all resolved is refused outright.
 */
export async function completeExecution(db: Db, input: CompleteExecutionInput): Promise<AgentExecution> {
  const existing = await resolveExecutionById(db, input.organizationId, input.executionId);
  requireAssignedAgent(existing, input.actorAgentId);
  await revalidateAgentEligibility(db, input.organizationId, input.actorAgentId);

  if (existing.currentPlanId) {
    const steps = await getPlanSteps(db, existing.currentPlanId);
    const unresolved = steps.filter((s) => s.status === "pending" || s.status === "failed");
    if (unresolved.length > 0) {
      throw new InsufficientCompletionEvidenceError(`${unresolved.length} plan step(s) are not yet completed or skipped`);
    }
  }

  const updated = await transitionExecutionStatus(db, {
    executionId: input.executionId,
    organizationId: input.organizationId,
    expectedRevision: existing.revision,
    fromStatuses: ["verifying"],
    toStatus: "completed",
    extraSet: { completedAt: new Date() },
  });

  if (!updated) {
    await recordConflict(db, input.executionId, input.organizationId, existing.status, "completed");
    throw new InvalidExecutionTransitionError(existing.status, "completed");
  }

  await recordExecutionEvent(db, {
    organizationId: input.organizationId,
    executionId: input.executionId,
    eventType: "agent_execution_completed",
    fromStatus: "verifying",
    toStatus: "completed",
    actorAgentId: input.actorAgentId,
  });

  return updated;
}

/** §11's retryable classes only — never a human rejection or a permission denial, "which retrying cannot fix." */
const RETRYABLE_FAILURE_CLASSES = new Set<FailureClass>(["timeout", "provider_unavailable", "transient_tool_failure", "runtime_error"]);

export interface FailExecutionInput {
  organizationId: string;
  executionId: string;
  failureClass: FailureClass;
  reason: string;
  actorAgentId?: string | null;
  actorUserId?: string | null;
}

const TERMINAL_STATES: AgentExecutionStatus[] = ["completed", "failed", "cancelled", "archived"];

/** Any non-terminal state → `failed`. Records the failure class (drives `retryExecution`'s own retryability check) and a bounded reason — never raw reasoning. */
export async function failExecution(db: Db, input: FailExecutionInput): Promise<AgentExecution> {
  const existing = await resolveExecutionById(db, input.organizationId, input.executionId);
  if (TERMINAL_STATES.includes(existing.status)) {
    throw new InvalidExecutionTransitionError(existing.status, "failed");
  }

  const updated = await transitionExecutionStatus(db, {
    executionId: input.executionId,
    organizationId: input.organizationId,
    expectedRevision: existing.revision,
    fromStatuses: [existing.status],
    toStatus: "failed",
    extraSet: { failedAt: new Date() },
  });

  if (!updated) {
    await recordConflict(db, input.executionId, input.organizationId, existing.status, "failed");
    throw new InvalidExecutionTransitionError(existing.status, "failed");
  }

  await recordExecutionEvent(db, {
    organizationId: input.organizationId,
    executionId: input.executionId,
    eventType: "agent_execution_failed",
    fromStatus: existing.status,
    toStatus: "failed",
    actorAgentId: input.actorAgentId ?? null,
    actorUserId: input.actorUserId ?? null,
    metadata: { failureClass: input.failureClass, reason: input.reason, retryable: RETRYABLE_FAILURE_CLASSES.has(input.failureClass) },
  });

  return updated;
}

export interface RetryExecutionInput {
  organizationId: string;
  executionId: string;
  actorUserId: string;
}

/** `failed → queued`, bounded by `maxRetries`, and only for a failure this codebase's own §11 taxonomy classifies as transient — the failure class is read back from the most recent `agent_execution_failed` event, never re-guessed. */
export async function retryExecution(db: Db, input: RetryExecutionInput): Promise<AgentExecution> {
  const existing = await resolveExecutionById(db, input.organizationId, input.executionId);
  await requireExecutionManageAuthority(db, { organizationId: input.organizationId, workspaceId: existing.workspaceId, ownerUserId: existing.ownerUserId, actorUserId: input.actorUserId });

  if (existing.retryCount >= existing.maxRetries) {
    throw new RetryLimitExceededError(existing.maxRetries);
  }

  const [lastFailure] = await db
    .select()
    .from(agentExecutionEvents)
    .where(and(eq(agentExecutionEvents.executionId, input.executionId), eq(agentExecutionEvents.eventType, "agent_execution_failed")))
    .orderBy(desc(agentExecutionEvents.createdAt))
    .limit(1);

  const failureClass = (lastFailure?.metadata as { failureClass?: string } | null)?.failureClass;
  if (!failureClass || !RETRYABLE_FAILURE_CLASSES.has(failureClass as FailureClass)) {
    throw new FailureNotRetryableError(failureClass ?? "unknown");
  }

  const updated = await transitionExecutionStatus(db, {
    executionId: input.executionId,
    organizationId: input.organizationId,
    expectedRevision: existing.revision,
    fromStatuses: ["failed"],
    toStatus: "queued",
    extraSet: { retryCount: existing.retryCount + 1, failedAt: null },
  });

  if (!updated) {
    await recordConflict(db, input.executionId, input.organizationId, existing.status, "queued");
    throw new InvalidExecutionTransitionError(existing.status, "queued");
  }

  await recordExecutionEvent(db, {
    organizationId: input.organizationId,
    executionId: input.executionId,
    eventType: "agent_execution_retry_scheduled",
    fromStatus: "failed",
    toStatus: "queued",
    actorUserId: input.actorUserId,
    metadata: { retryCount: existing.retryCount + 1, maxRetries: existing.maxRetries, failureClass },
  });

  return updated;
}

const PAUSABLE_STATES: AgentExecutionStatus[] = ["assigned", "gathering_context", "planning", "reasoning", "waiting", "executing", "delegating", "human_approval", "verifying"];

export interface PauseExecutionInput {
  organizationId: string;
  executionId: string;
  actorUserId: string;
}

/** §8: "an explicit, first-class control... pauses at the next safe checkpoint." Writes a checkpoint recording the CURRENT status before transitioning, so `resumeExecution` knows exactly where to return to — reusing the checkpoint mechanism rather than a dedicated column. */
export async function pauseExecution(db: Db, input: PauseExecutionInput): Promise<AgentExecution> {
  const existing = await resolveExecutionById(db, input.organizationId, input.executionId);
  await requireExecutionManageAuthority(db, { organizationId: input.organizationId, workspaceId: existing.workspaceId, ownerUserId: existing.ownerUserId, actorUserId: input.actorUserId });

  if (!PAUSABLE_STATES.includes(existing.status)) {
    throw new InvalidExecutionTransitionError(existing.status, "paused");
  }

  await createCheckpoint(db, {
    organizationId: input.organizationId,
    executionId: input.executionId,
    statusAtCheckpoint: existing.status,
    retryCountAtCheckpoint: existing.retryCount,
    actorUserId: input.actorUserId,
    safeStateSummary: { pausedFrom: existing.status },
  });

  const updated = await transitionExecutionStatus(db, {
    executionId: input.executionId,
    organizationId: input.organizationId,
    expectedRevision: existing.revision,
    fromStatuses: [existing.status],
    toStatus: "paused",
  });

  if (!updated) {
    await recordConflict(db, input.executionId, input.organizationId, existing.status, "paused");
    throw new InvalidExecutionTransitionError(existing.status, "paused");
  }

  await recordExecutionEvent(db, {
    organizationId: input.organizationId,
    executionId: input.executionId,
    eventType: "agent_execution_paused",
    fromStatus: existing.status,
    toStatus: "paused",
    actorUserId: input.actorUserId,
  });

  return updated;
}

export interface ResumeExecutionInput {
  organizationId: string;
  executionId: string;
  actorUserId: string;
}

/** §8: resuming requires an explicit human action, never automatic. Loads the latest checkpoint (written by `pauseExecution`), re-validates live permissions before resuming (§3/§12's non-negotiable rule), and returns to the exact prior status. */
export async function resumeExecution(db: Db, input: ResumeExecutionInput): Promise<AgentExecution> {
  const existing = await resolveExecutionById(db, input.organizationId, input.executionId);
  await requireExecutionManageAuthority(db, { organizationId: input.organizationId, workspaceId: existing.workspaceId, ownerUserId: existing.ownerUserId, actorUserId: input.actorUserId });

  if (existing.status !== "paused") {
    throw new InvalidExecutionTransitionError(existing.status, "resume");
  }

  const checkpoint = await resolveResumeCheckpoint(db, input.executionId, 0);

  if (existing.assignedAgentId) {
    await revalidateAgentEligibility(db, input.organizationId, existing.assignedAgentId);
  }

  const updated = await transitionExecutionStatus(db, {
    executionId: input.executionId,
    organizationId: input.organizationId,
    expectedRevision: existing.revision,
    fromStatuses: ["paused"],
    toStatus: checkpoint.statusAtCheckpoint,
  });

  if (!updated) {
    await recordConflict(db, input.executionId, input.organizationId, existing.status, checkpoint.statusAtCheckpoint);
    throw new InvalidExecutionTransitionError(existing.status, checkpoint.statusAtCheckpoint);
  }

  await recordExecutionEvent(db, {
    organizationId: input.organizationId,
    executionId: input.executionId,
    eventType: "agent_execution_resumed",
    fromStatus: "paused",
    toStatus: checkpoint.statusAtCheckpoint,
    actorUserId: input.actorUserId,
    metadata: { resumedFromCheckpoint: checkpoint.id, checkpointSequenceNumber: checkpoint.sequenceNumber },
  });

  return updated;
}

export interface CancelExecutionInput {
  organizationId: string;
  executionId: string;
  reason: string;
  actorUserId: string;
}

/** §8: "cascades cleanly: active delegations are signaled to cancel (best-effort), any pending Human Approval request is withdrawn." Legal from any non-terminal state. */
export async function cancelExecution(db: Db, input: CancelExecutionInput): Promise<AgentExecution> {
  const existing = await resolveExecutionById(db, input.organizationId, input.executionId);
  await requireExecutionManageAuthority(db, { organizationId: input.organizationId, workspaceId: existing.workspaceId, ownerUserId: existing.ownerUserId, actorUserId: input.actorUserId });

  if (TERMINAL_STATES.includes(existing.status)) {
    throw new InvalidExecutionTransitionError(existing.status, "cancelled");
  }

  const updated = await transitionExecutionStatus(db, {
    executionId: input.executionId,
    organizationId: input.organizationId,
    expectedRevision: existing.revision,
    fromStatuses: [existing.status],
    toStatus: "cancelled",
    extraSet: { cancelledAt: new Date() },
  });

  if (!updated) {
    await recordConflict(db, input.executionId, input.organizationId, existing.status, "cancelled");
    throw new InvalidExecutionTransitionError(existing.status, "cancelled");
  }

  // Withdraw any pending approval requests — best-effort, never blocking
  // the cancellation itself.
  await db
    .update(agentApprovalRequests)
    .set({ status: "cancelled", decidedAt: new Date(), decisionNote: "Execution cancelled" })
    .where(and(eq(agentApprovalRequests.executionId, input.executionId), eq(agentApprovalRequests.status, "pending")));

  // Signal active delegations to cancel — best-effort; a delegate whose
  // own side effect already completed cannot be un-executed (§8), only
  // marked. This cascades by recursively cancelling the child execution
  // itself, not merely the delegation-relationship row.
  const activeDelegations = await db
    .select()
    .from(agentDelegations)
    .where(and(eq(agentDelegations.parentExecutionId, input.executionId), eq(agentDelegations.status, "active")));

  for (const delegation of activeDelegations) {
    const child = await resolveExecutionById(db, input.organizationId, delegation.childExecutionId).catch(() => null);
    if (child && !TERMINAL_STATES.includes(child.status)) {
      await cancelExecution(db, { organizationId: input.organizationId, executionId: child.id, reason: "Parent execution cancelled", actorUserId: input.actorUserId });
    }
    await db.update(agentDelegations).set({ status: "cancelled", updatedAt: new Date() }).where(eq(agentDelegations.id, delegation.id));
  }

  await recordExecutionEvent(db, {
    organizationId: input.organizationId,
    executionId: input.executionId,
    eventType: "agent_execution_cancelled",
    fromStatus: existing.status,
    toStatus: "cancelled",
    actorUserId: input.actorUserId,
    metadata: { reason: input.reason },
  });

  return updated;
}

export interface ArchiveExecutionInput {
  organizationId: string;
  executionId: string;
  actorUserId: string;
}

/** `completed | failed | cancelled → archived`. §1: "nothing about a task's history disappears at Archived — this is a status change for the active work queue, not a retention decision." */
export async function archiveExecution(db: Db, input: ArchiveExecutionInput): Promise<AgentExecution> {
  const existing = await resolveExecutionById(db, input.organizationId, input.executionId);
  await requireExecutionManageAuthority(db, { organizationId: input.organizationId, workspaceId: existing.workspaceId, ownerUserId: existing.ownerUserId, actorUserId: input.actorUserId });

  const updated = await transitionExecutionStatus(db, {
    executionId: input.executionId,
    organizationId: input.organizationId,
    expectedRevision: existing.revision,
    fromStatuses: ["completed", "failed", "cancelled"],
    toStatus: "archived",
    extraSet: { archivedAt: new Date() },
  });

  if (!updated) {
    await recordConflict(db, input.executionId, input.organizationId, existing.status, "archived");
    throw new InvalidExecutionTransitionError(existing.status, "archived");
  }

  return updated;
}

export { FAILURE_CLASSES };
export type { FailureClass };
