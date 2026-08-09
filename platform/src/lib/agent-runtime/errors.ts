import { DomainRuleViolationError } from "@/lib/authz/errors";

/**
 * ============================================================================
 * Agent Runtime Core error taxonomy — Module 7
 * ============================================================================
 */

/** The atomic `UPDATE ... WHERE status IN (...) AND revision = expected` guard matched zero rows — either a stale revision (lost the race) or the requested transition is illegal from the execution's actual current status. Both report identically: the caller must re-fetch and decide. */
export class InvalidExecutionTransitionError extends DomainRuleViolationError {
  readonly reason = "invalid_execution_transition";
  constructor(fromStatus: string, toStatus: string) {
    super(`This execution cannot move from "${fromStatus}" to "${toStatus}" (or another worker already changed it)`);
    this.name = "InvalidExecutionTransitionError";
  }
}

/** §12: "a task can only be actively claimed by one execution process at a time." Two workers racing to claim/start the same execution — the loser gets this, never a silent double-start. */
export class ExecutionAlreadyClaimedError extends DomainRuleViolationError {
  readonly reason = "execution_already_claimed";
  constructor() {
    super("This execution is already claimed by another worker");
    this.name = "ExecutionAlreadyClaimedError";
  }
}

/** §12's "hallucinated execution" gate: Completed is reachable only when real, logged evidence exists — never on the agent's own narrative claim alone. */
export class InsufficientCompletionEvidenceError extends DomainRuleViolationError {
  readonly reason = "insufficient_completion_evidence";
  constructor(detail: string) {
    super(`This execution cannot be marked completed: ${detail}`);
    this.name = "InsufficientCompletionEvidenceError";
  }
}

/** §12: "a hard maximum delegation depth... exceeding it forces escalation regardless of whether a true cycle was ever detected." */
export class DelegationDepthExceededError extends DomainRuleViolationError {
  readonly reason = "delegation_depth_exceeded";
  constructor(maxDepth: number) {
    super(`Delegation depth exceeds the maximum of ${maxDepth}`);
    this.name = "DelegationDepthExceededError";
  }
}

/** §6: "a new delegation is rejected outright if its target agent already appears in [the ancestry] — never detected only after the fact." */
export class DelegationCycleError extends DomainRuleViolationError {
  readonly reason = "delegation_cycle";
  constructor() {
    super("This delegation would create a cycle — the target agent already appears in this execution's ancestry");
    this.name = "DelegationCycleError";
  }
}

/** §6/§12: "an agent cannot delegate its way into a capability it doesn't independently hold." */
export class DelegatorLacksCapabilityError extends DomainRuleViolationError {
  readonly reason = "delegator_lacks_capability";
  constructor() {
    super("The delegating agent does not itself hold the capability required for this delegation");
    this.name = "DelegatorLacksCapabilityError";
  }
}

/** §2: "must be acyclic — enforced structurally, not merely by convention." */
export class DependencyCycleError extends DomainRuleViolationError {
  readonly reason = "dependency_cycle";
  constructor() {
    super("This dependency would create a cycle");
    this.name = "DependencyCycleError";
  }
}

/** An approval request already resolved (approved/rejected/expired/cancelled/revision-requested) cannot be decided again — §7's "approval is single-use." */
export class ApprovalAlreadyDecidedError extends DomainRuleViolationError {
  readonly reason = "approval_already_decided";
  constructor() {
    super("This approval request has already been decided");
    this.name = "ApprovalAlreadyDecidedError";
  }
}

/** §7: fail-closed — an execution paused at `human_approval` cannot proceed past it without a real, currently-approved decision. */
export class ApprovalRequiredError extends DomainRuleViolationError {
  readonly reason = "approval_required";
  constructor() {
    super("This action requires a resolved, approved approval request before it can proceed");
    this.name = "ApprovalRequiredError";
  }
}

/** §11: retries apply only to failures classified as transient — never to a human rejection or a permission denial, "which retrying cannot fix." */
export class FailureNotRetryableError extends DomainRuleViolationError {
  readonly reason = "failure_not_retryable";
  constructor(failureClass: string) {
    super(`A "${failureClass}" failure is not retryable`);
    this.name = "FailureNotRetryableError";
  }
}

/** §2/§8: bounded retry — the configured `maxRetries` ceiling. */
export class RetryLimitExceededError extends DomainRuleViolationError {
  readonly reason = "retry_limit_exceeded";
  constructor(maxRetries: number) {
    super(`This execution has already used its maximum of ${maxRetries} retries`);
    this.name = "RetryLimitExceededError";
  }
}

/** §3/§12: a live re-check found the assigned agent's Brain grant (or other required authorization) has been revoked since the Execution Context snapshot was taken — the snapshot is never authoritative for a gated action. */
export class LivePermissionRevalidationFailedError extends DomainRuleViolationError {
  readonly reason = "live_permission_revalidation_failed";
  constructor(detail: string) {
    super(`Live permission re-check failed: ${detail}`);
    this.name = "LivePermissionRevalidationFailedError";
  }
}

/** The agent driving this call is not the execution's own `assignedAgentId` — an execution's own work can only be advanced by the agent it was actually assigned to. */
export class NotAssignedAgentError extends DomainRuleViolationError {
  readonly reason = "not_assigned_agent";
  constructor() {
    super("This agent is not the execution's assigned agent");
    this.name = "NotAssignedAgentError";
  }
}

/** A checkpoint older than the execution's current progress cannot be used to resume — §8/§12's "stale checkpoint cannot overwrite newer progress." */
export class StaleCheckpointError extends DomainRuleViolationError {
  readonly reason = "stale_checkpoint";
  constructor() {
    super("This checkpoint is older than the execution's current recorded progress");
    this.name = "StaleCheckpointError";
  }
}
