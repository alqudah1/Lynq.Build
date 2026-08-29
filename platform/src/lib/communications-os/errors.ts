import { DomainRuleViolationError } from "@/lib/authz/errors";

export class StaleCommunicationUpdateError extends DomainRuleViolationError {
  readonly reason = "stale_communication_update";
  constructor(entity = "record") {
    super(`This ${entity} was modified by someone else — reload and try again`);
    this.name = "StaleCommunicationUpdateError";
  }
}

export class InvalidMessageTransitionError extends DomainRuleViolationError {
  readonly reason = "invalid_message_transition";
  constructor(from: string, to: string) {
    super(`Cannot move a message from "${from}" to "${to}".`);
    this.name = "InvalidMessageTransitionError";
  }
}

export class CommunicationKeyAlreadyTakenError extends DomainRuleViolationError {
  readonly reason = "communication_key_already_taken";
  constructor(message = "That key is already in use.") {
    super(message);
    this.name = "CommunicationKeyAlreadyTakenError";
  }
}

export class TemplateNotPublishedError extends DomainRuleViolationError {
  readonly reason = "template_not_published";
  constructor() {
    super("The requested template has no published version.");
    this.name = "TemplateNotPublishedError";
  }
}

export class TemplateVersionImmutableError extends DomainRuleViolationError {
  readonly reason = "template_version_immutable";
  constructor() {
    super("A published template version cannot be edited — create a new version instead.");
    this.name = "TemplateVersionImmutableError";
  }
}

export class UnknownTemplateVariableError extends DomainRuleViolationError {
  readonly reason = "unknown_template_variable";
  constructor(name: string) {
    super(`"${name}" is not a declared variable on this template version.`);
    this.name = "UnknownTemplateVariableError";
  }
}

export class MissingRequiredTemplateVariableError extends DomainRuleViolationError {
  readonly reason = "missing_required_template_variable";
  constructor(name: string) {
    super(`Required variable "${name}" was not supplied.`);
    this.name = "MissingRequiredTemplateVariableError";
  }
}

export class RecipientSuppressedError extends DomainRuleViolationError {
  readonly reason = "recipient_suppressed";
  constructor() {
    super("This recipient is on the suppression list and cannot receive this communication.");
    this.name = "RecipientSuppressedError";
  }
}

export class ConsentRequiredError extends DomainRuleViolationError {
  readonly reason = "consent_required";
  constructor() {
    super("This recipient has not opted in and this communication requires consent.");
    this.name = "ConsentRequiredError";
  }
}

export class MessageNotApprovedError extends DomainRuleViolationError {
  readonly reason = "message_not_approved";
  constructor() {
    super("This message has not been approved and cannot be sent.");
    this.name = "MessageNotApprovedError";
  }
}

export class AgentCannotApproveOwnMessageError extends DomainRuleViolationError {
  readonly reason = "agent_cannot_approve_own_message";
  constructor() {
    super("An agent cannot approve a message it drafted.");
    this.name = "AgentCannotApproveOwnMessageError";
  }
}

export class ConnectionNotUsableError extends DomainRuleViolationError {
  readonly reason = "connection_not_usable";
  constructor(status: string) {
    super(`This integration connection is "${status}" and cannot be used to send.`);
    this.name = "ConnectionNotUsableError";
  }
}

export class InvalidRecipientError extends DomainRuleViolationError {
  readonly reason = "invalid_recipient";
  constructor(message = "The recipient is not valid for this channel.") {
    super(message);
    this.name = "InvalidRecipientError";
  }
}

export class DuplicateActiveBulkBatchError extends DomainRuleViolationError {
  readonly reason = "duplicate_active_bulk_batch";
  constructor() {
    super("This campaign already has an active bulk batch in progress.");
    this.name = "DuplicateActiveBulkBatchError";
  }
}

export class BulkBatchRecipientLimitExceededError extends DomainRuleViolationError {
  readonly reason = "bulk_batch_recipient_limit_exceeded";
  constructor(max: number) {
    super(`This batch's recipient snapshot exceeds its configured maximum of ${max}.`);
    this.name = "BulkBatchRecipientLimitExceededError";
  }
}

export class CommunicationRoleAlreadyGrantedError extends DomainRuleViolationError {
  readonly reason = "communication_role_already_granted";
  constructor() {
    super("This user already has an active Communications role.");
    this.name = "CommunicationRoleAlreadyGrantedError";
  }
}

export class CommunicationsAgentNotSeededError extends DomainRuleViolationError {
  readonly reason = "communications_agent_not_seeded";
  constructor() {
    super("The Communications Assistant agent has not been seeded for this organization.");
    this.name = "CommunicationsAgentNotSeededError";
  }
}

export class UncertainSendOutcomeError extends DomainRuleViolationError {
  readonly reason = "uncertain_send_outcome";
  constructor() {
    super("The provider's outcome for this send is uncertain — paused for human review rather than risking a duplicate send.");
    this.name = "UncertainSendOutcomeError";
  }
}

/**
 * Thrown out of `processSendJob` when the provider POSITIVELY refused the
 * request — a rate limit or throttle — and therefore created nothing. The
 * message has already been released back to `queued`; throwing is what
 * makes the durable Runtime job retry with its own exponential backoff.
 * Deliberately NOT a `DomainRuleViolationError`: the worker's
 * `classifyExecutionError` must fall through to its `"transient"` default
 * so the job is retried rather than dead-lettered.
 */
export class ProviderTemporarilyUnavailableError extends Error {
  readonly reason = "provider_temporarily_unavailable";
  constructor(failureCode: string) {
    super(`The provider temporarily refused this send (${failureCode}); it has been re-queued for retry.`);
    this.name = "ProviderTemporarilyUnavailableError";
  }
}
