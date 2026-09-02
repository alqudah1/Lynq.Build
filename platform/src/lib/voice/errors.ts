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
