import { AuthzError, DomainRuleViolationError } from "@/lib/authz/errors";

/**
 * ============================================================================
 * Agent Registry error taxonomy (`marketing/AGENT_FRAMEWORK.md` §2, §5, §14)
 * ============================================================================
 */

/**
 * AGENT_FRAMEWORK §2: "No agent skips a stage, and no agent re-enters
 * Deployment after Retirement without going through Specification again."
 * The lifecycle is a strict forward sequence with exactly one exception —
 * retirement, reachable from any non-retired stage. Every other requested
 * `(from, to)` pair that isn't "the next stage in sequence" is this error.
 */
export class InvalidAgentLifecycleTransitionError extends DomainRuleViolationError {
  readonly reason = "invalid_agent_lifecycle_transition";
  constructor(fromStage: string, toStage: string) {
    super(`An agent cannot move from "${fromStage}" to "${toStage}"`);
    this.name = "InvalidAgentLifecycleTransitionError";
  }
}

/** Retiring an already-retired agent — mirrors `KnowledgeItemAlreadyArchivedError`'s "fails safely, never silently" precedent. */
export class AgentAlreadyRetiredError extends DomainRuleViolationError {
  readonly reason = "agent_already_retired";
  constructor() {
    super("This agent is already retired");
    this.name = "AgentAlreadyRetiredError";
  }
}

/**
 * AGENT_FRAMEWORK §5: "only a human approval moves an agent up," and a
 * permission-level change is only ever meaningful for an agent that is
 * actually live — an idea/spec/development/testing/approval-stage agent
 * has no runtime authority yet to change, and a retired agent has none
 * left. Reserved for `deployment`/`monitoring`/`improvement` stages.
 */
export class AgentNotLiveError extends DomainRuleViolationError {
  readonly reason = "agent_not_live";
  constructor(currentStage: string) {
    super(`This agent's permission level cannot be changed while it is "${currentStage}" — only a live (deployment/monitoring/improvement) agent can be`);
    this.name = "AgentNotLiveError";
  }
}

/**
 * AGENT_FRAMEWORK §5: "Founder... No AI agent may ever be assigned this
 * level, under any circumstance." Enforced structurally by
 * `agentPermissionLevelEnum` not even containing the value — this error
 * exists only in case a future caller tries to smuggle the string through
 * an untyped path (e.g. a raw SQL statement), so the rule has a named,
 * explicit failure mode rather than relying solely on a type error.
 */
export class FounderLevelNotAssignableError extends DomainRuleViolationError {
  readonly reason = "founder_level_not_assignable";
  constructor() {
    super("The \"founder\" permission level can never be assigned to an agent");
    this.name = "FounderLevelNotAssignableError";
  }
}

/**
 * The caller's `expectedVersionNumber` no longer matches the agent's
 * actual current version — someone else's anatomy edit landed first.
 * Identical concurrency philosophy to `KnowledgeVersionConflictError`.
 */
export class AgentVersionConflictError extends DomainRuleViolationError {
  readonly reason = "agent_version_conflict";
  constructor() {
    super("This agent was changed by someone else since you loaded it. Refresh and try again.");
    this.name = "AgentVersionConflictError";
  }
}

/** An already-revoked credential cannot be revoked again. */
export class AgentCredentialAlreadyRevokedError extends DomainRuleViolationError {
  readonly reason = "credential_already_revoked";
  constructor() {
    super("This agent credential is already revoked");
    this.name = "AgentCredentialAlreadyRevokedError";
  }
}

/**
 * Brain Module 16 — extends `AuthzError` (not `DomainRuleViolationError`)
 * because a rate limit is a "can this request even proceed" gate, the
 * same family `UnauthenticatedError`/`InsufficientRoleError` belong to,
 * not a business-rule conflict on an existing resource. Mirrors
 * `InvitationRateLimitedError`'s exact shape and message.
 */
export class AgentBrainRateLimitedError extends AuthzError {
  readonly httpStatus = 429;
  readonly code = "rate_limited";
  constructor() {
    super("Too many requests. Please try again later.");
    this.name = "AgentBrainRateLimitedError";
  }
}
