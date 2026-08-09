import { DomainRuleViolationError } from "@/lib/authz/errors";

/**
 * ============================================================================
 * Tool Runtime error taxonomy — Module 8
 * ============================================================================
 * Every error here carries a `toolErrorClass` so `invokeTool` can map it to
 * the exact stored `tool_invocations.error_class` value deterministically —
 * tools never return arbitrary strings the Runtime has to interpret.
 */

export type ToolErrorClass =
  | "invalid_input"
  | "permission_denied"
  | "approval_required"
  | "tool_disabled"
  | "tool_not_found"
  | "timeout"
  | "transient_failure"
  | "permanent_failure"
  | "provider_unavailable"
  | "idempotency_conflict"
  | "unsafe_retry"
  | "runtime_error";

export abstract class ToolInvocationError extends DomainRuleViolationError {
  abstract readonly toolErrorClass: ToolErrorClass;
}

export class ToolNotFoundError extends ToolInvocationError {
  readonly reason = "tool_not_found";
  readonly toolErrorClass: ToolErrorClass = "tool_not_found";
  constructor(toolKey: string) {
    super(`No tool is registered with key "${toolKey}"`);
    this.name = "ToolNotFoundError";
  }
}

export class ToolDisabledError extends ToolInvocationError {
  readonly reason = "tool_disabled";
  readonly toolErrorClass: ToolErrorClass = "tool_disabled";
  constructor(toolKey: string) {
    super(`Tool "${toolKey}" is currently disabled`);
    this.name = "ToolDisabledError";
  }
}

export class InvalidToolInputError extends ToolInvocationError {
  readonly reason = "invalid_input";
  readonly toolErrorClass: ToolErrorClass = "invalid_input";
  constructor(detail: string) {
    super(`Invalid tool input: ${detail}`);
    this.name = "InvalidToolInputError";
  }
}

/** Covers every "the caller cannot use this tool right now" case: missing Brain capability, permission level below the tool's floor, agent not assigned/eligible, execution not in a tool-usable state. */
export class ToolPermissionDeniedError extends ToolInvocationError {
  readonly reason = "permission_denied";
  readonly toolErrorClass: ToolErrorClass = "permission_denied";
  constructor(detail: string) {
    super(`Tool permission denied: ${detail}`);
    this.name = "ToolPermissionDeniedError";
  }
}

/** Not a failure — this is the expected result when a high-risk tool has no resolved, approved approval yet. The invocation is durably recorded at `waiting_for_approval`, never silently dropped. */
export class ToolApprovalRequiredError extends ToolInvocationError {
  readonly reason = "approval_required";
  readonly toolErrorClass: ToolErrorClass = "approval_required";
  constructor() {
    super("This tool call requires human approval before it can proceed");
    this.name = "ToolApprovalRequiredError";
  }
}

/** A concurrent duplicate call under the same idempotency key is already in flight (not yet `succeeded`/`failed`) — the caller should retry/poll rather than race a second attempt. */
export class ToolIdempotencyConflictError extends ToolInvocationError {
  readonly reason = "idempotency_conflict";
  readonly toolErrorClass: ToolErrorClass = "idempotency_conflict";
  constructor() {
    super("An invocation with this idempotency key is already in flight");
    this.name = "ToolIdempotencyConflictError";
  }
}

export class ToolTimeoutError extends ToolInvocationError {
  readonly reason = "timeout";
  readonly toolErrorClass: ToolErrorClass = "timeout";
  constructor(toolKey: string, timeoutSeconds: number) {
    super(`Tool "${toolKey}" did not complete within ${timeoutSeconds}s`);
    this.name = "ToolTimeoutError";
  }
}

export class ToolRuntimeError extends ToolInvocationError {
  readonly reason = "runtime_error";
  readonly toolErrorClass: ToolErrorClass = "runtime_error";
  constructor(detail: string) {
    super(`Tool runtime error: ${detail}`);
    this.name = "ToolRuntimeError";
  }
}
