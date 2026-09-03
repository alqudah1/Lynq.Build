import { DomainRuleViolationError } from "@/lib/authz/errors";

/**
 * Domain rule violations for the phone lane.
 *
 * These are the "you can reach this, the request is well-formed, but a
 * business invariant forbids it" cases the existing `DomainRuleViolationError`
 * contract describes — a real, visible resource in a state that refuses the
 * operation. They map to 409, never 404: hiding them would leave the founder
 * looking at a command that is plainly on screen and an error saying it does
 * not exist.
 */

/** The command has already moved past the decision point — dispatched, declined, cancelled, or failed. */
export class CommandNotAwaitingApprovalError extends DomainRuleViolationError {
  readonly reason = "command_not_awaiting_approval";
  constructor(state: string) {
    super(`This command is ${state.replace(/_/g, " ")} and can no longer be decided.`);
    this.name = "CommandNotAwaitingApprovalError";
  }
}

/** Two people (or two clicks) decided the same command; the revision guard rejected the second. */
export class CommandAlreadyDecidedError extends DomainRuleViolationError {
  readonly reason = "command_already_decided";
  constructor() {
    super("This command was already decided. Reload to see the current state.");
    this.name = "CommandAlreadyDecidedError";
  }
}

/** Retry was asked for on a command that is not in `failed`, or that has already used its attempts. */
export class CommandNotRetryableError extends DomainRuleViolationError {
  readonly reason = "command_not_retryable";
  constructor(cause: "not_failed" | "attempts_exhausted" | "partially_created" | "in_flight") {
    super(
      cause === "in_flight"
        ? "Jarvis is opening this one right now. Give it a moment and reload."
        : cause === "not_failed"
        ? "Only a command that failed to start can be retried."
        : cause === "partially_created"
          ? "This one already opened a project before it failed, so retrying would start the work twice. Open the project and carry on from there."
          : "This command has been retried as many times as it can be. Give Jarvis the instruction again if you still want it."
    );
    this.name = "CommandNotRetryableError";
  }
}

/**
 * A directive whose project row exists but whose handoff did not finish.
 *
 * This is deliberately its OWN status rather than the underlying failure's.
 * The operation did not fail — it partially succeeded, and the caller needs to
 * know a project exists before they retry anything. Reporting the cause's 404
 * or 409 would imply nothing happened, which is exactly the wrong thing to
 * tell someone who now has a live project with running agents.
 */
export class DirectiveHandoffIncompleteError extends DomainRuleViolationError {
  readonly reason = "directive_handoff_incomplete";
  constructor(public readonly projectId: string, projectName: string) {
    super(`The project "${projectName}" was created, but Jarvis could not finish briefing the team. Open it before trying again — some of the work may already be running.`);
    this.name = "DirectiveHandoffIncompleteError";
  }
}
