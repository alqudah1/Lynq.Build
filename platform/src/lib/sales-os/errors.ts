import { DomainRuleViolationError } from "@/lib/authz/errors";

export class StaleSalesUpdateError extends DomainRuleViolationError {
  readonly reason = "stale_update";
  constructor(entity = "record") {
    super(`This ${entity} was modified by someone else — reload and try again`);
    this.name = "StaleSalesUpdateError";
  }
}

export class InvalidSalesTransitionError extends DomainRuleViolationError {
  readonly reason = "invalid_sales_transition";
  constructor(entity: string, from: string, to: string) {
    super(`Cannot transition ${entity} from "${from}" to "${to}"`);
    this.name = "InvalidSalesTransitionError";
  }
}

export class SalesKeyAlreadyTakenError extends DomainRuleViolationError {
  readonly reason = "sales_key_taken";
  constructor(entity: string, key: string) {
    super(`A ${entity} with key "${key}" already exists in this organization`);
    this.name = "SalesKeyAlreadyTakenError";
  }
}

export class IneligibleAssigneeError extends DomainRuleViolationError {
  readonly reason = "ineligible_assignee";
  constructor(detail: string) {
    super(`This user is not an eligible sales rep: ${detail}`);
    this.name = "IneligibleAssigneeError";
  }
}

export class NoEligibleAssigneeError extends DomainRuleViolationError {
  readonly reason = "no_eligible_assignee";
  constructor() {
    super("No eligible, active sales rep is available for assignment");
    this.name = "NoEligibleAssigneeError";
  }
}

export class PlaybookNotPublishedError extends DomainRuleViolationError {
  readonly reason = "playbook_not_published";
  constructor() {
    super("This playbook has no published version yet");
    this.name = "PlaybookNotPublishedError";
  }
}

export class PlaybookVersionImmutableError extends DomainRuleViolationError {
  readonly reason = "playbook_version_immutable";
  constructor() {
    super("A published playbook version cannot be edited — create a new version instead");
    this.name = "PlaybookVersionImmutableError";
  }
}

export class DuplicateActiveRunError extends DomainRuleViolationError {
  readonly reason = "duplicate_active_run";
  constructor(entity: string) {
    super(`This ${entity} already has an active run in progress`);
    this.name = "DuplicateActiveRunError";
  }
}

export class DuplicateActiveEnrollmentError extends DomainRuleViolationError {
  readonly reason = "duplicate_active_enrollment";
  constructor() {
    super("This record already has an active follow-up sequence enrollment");
    this.name = "DuplicateActiveEnrollmentError";
  }
}

export class SequenceNotPublishedError extends DomainRuleViolationError {
  readonly reason = "sequence_not_published";
  constructor() {
    super("This follow-up sequence has no published version yet");
    this.name = "SequenceNotPublishedError";
  }
}

export class InvalidTargetScopeError extends DomainRuleViolationError {
  readonly reason = "invalid_target_scope";
  constructor(detail: string) {
    super(`Invalid target scope: ${detail}`);
    this.name = "InvalidTargetScopeError";
  }
}

export class SalesRoleAlreadyGrantedError extends DomainRuleViolationError {
  readonly reason = "sales_role_already_granted";
  constructor() {
    super("This user already holds an active Sales OS role in this organization");
    this.name = "SalesRoleAlreadyGrantedError";
  }
}

export class SalesAgentNotSeededError extends DomainRuleViolationError {
  readonly reason = "sales_agent_not_seeded";
  constructor(agentName: string) {
    super(`The "${agentName}" Sales agent has not been seeded for this organization yet`);
    this.name = "SalesAgentNotSeededError";
  }
}

export class SalesWorkflowTemplateNotSeededError extends DomainRuleViolationError {
  readonly reason = "sales_workflow_template_not_seeded";
  constructor(workflowKey: string) {
    super(`The "${workflowKey}" Sales OS workflow template has not been seeded for this organization yet`);
    this.name = "SalesWorkflowTemplateNotSeededError";
  }
}

/** Module 14 — one of the 10 required conditions for lead qualification: every mandatory playbook checklist item must be complete before a rep/manager can qualify the lead. Disqualification deliberately has no such gate — a lead can be recognized as unqualified at any point in the run. */
export class QualificationChecklistIncompleteError extends DomainRuleViolationError {
  readonly reason = "qualification_checklist_incomplete";
  constructor(missingStepKeys: string[]) {
    super(`This qualification run still has required item(s) incomplete: ${missingStepKeys.join(", ")}`);
    this.name = "QualificationChecklistIncompleteError";
  }
}
