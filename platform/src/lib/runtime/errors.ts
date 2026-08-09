import { DomainRuleViolationError, AuthzError, TenantResourceNotFoundError } from "@/lib/authz/errors";

/** A job row with this id doesn't exist (or isn't visible to the caller's tenant scope) — reuses the codebase's own 404 shape rather than inventing a parallel one. */
export { TenantResourceNotFoundError as RuntimeJobNotFoundError };

/** Raised whenever a heartbeat/complete/fail/cancel call's `leaseOwner` doesn't match the job's own current `leaseOwner` — a valid lease can never be stolen or acted on by a process that doesn't hold it. */
export class LeaseNotHeldError extends DomainRuleViolationError {
  readonly reason = "lease_not_held";
  constructor() {
    super("The caller does not hold the current lease on this job (it was reclaimed, released, or never held)");
    this.name = "LeaseNotHeldError";
  }
}

export class InvalidJobTransitionError extends DomainRuleViolationError {
  readonly reason = "invalid_job_transition";
  constructor(from: string, to: string) {
    super(`Cannot transition runtime job from "${from}" to "${to}"`);
    this.name = "InvalidJobTransitionError";
  }
}

export class JobRetryLimitExceededError extends DomainRuleViolationError {
  readonly reason = "job_retry_limit_exceeded";
  constructor() {
    super("This job has exhausted its maximum attempts and must be dead-lettered, not retried again");
    this.name = "JobRetryLimitExceededError";
  }
}

/** §11/§12: an uncertain, possibly-already-executed non-idempotent side effect must never be blindly retried — this is the explicit "pause for human review" signal, never silently resolved either way. */
export class UnsafeRetryError extends DomainRuleViolationError {
  readonly reason = "unsafe_retry";
  constructor(detail: string) {
    super(`Cannot safely retry: ${detail}`);
    this.name = "UnsafeRetryError";
  }
}

export class DeadLetterJobNotRetryableError extends DomainRuleViolationError {
  readonly reason = "dead_letter_job_not_retryable";
  constructor(detail: string) {
    super(`This dead-lettered job cannot be retried: ${detail}`);
    this.name = "DeadLetterJobNotRetryableError";
  }
}

export class WorkerCredentialInvalidError extends AuthzError {
  readonly httpStatus = 401;
  readonly code = "worker_credential_invalid";
  constructor() {
    super("Invalid worker credential");
    this.name = "WorkerCredentialInvalidError";
  }
}

export class WorkerCredentialRevokedError extends AuthzError {
  readonly httpStatus = 401;
  readonly code = "worker_credential_revoked";
  constructor() {
    super("This worker credential has been revoked");
    this.name = "WorkerCredentialRevokedError";
  }
}

export class WorkerBootstrapNotConfiguredError extends DomainRuleViolationError {
  readonly reason = "worker_bootstrap_not_configured";
  constructor() {
    super("WORKER_BOOTSTRAP_SECRET is not configured in this environment");
    this.name = "WorkerBootstrapNotConfiguredError";
  }
}

export class WorkerBootstrapSecretInvalidError extends AuthzError {
  readonly httpStatus = 401;
  readonly code = "worker_bootstrap_secret_invalid";
  constructor() {
    super("Invalid worker bootstrap secret");
    this.name = "WorkerBootstrapSecretInvalidError";
  }
}
