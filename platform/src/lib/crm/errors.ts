import { DomainRuleViolationError } from "@/lib/authz/errors";

export class StaleCrmUpdateError extends DomainRuleViolationError {
  readonly reason = "stale_update";
  constructor(entity = "record") {
    super(`This ${entity} was modified by someone else — reload and try again`);
    this.name = "StaleCrmUpdateError";
  }
}

export class InvalidCrmTransitionError extends DomainRuleViolationError {
  readonly reason = "invalid_crm_transition";
  constructor(entity: string, from: string, to: string) {
    super(`Cannot transition ${entity} from "${from}" to "${to}"`);
    this.name = "InvalidCrmTransitionError";
  }
}

export class PipelineKeyAlreadyTakenError extends DomainRuleViolationError {
  readonly reason = "pipeline_key_taken";
  constructor(pipelineKey: string) {
    super(`A pipeline with key "${pipelineKey}" already exists in this organization`);
    this.name = "PipelineKeyAlreadyTakenError";
  }
}

export class StageKeyAlreadyTakenError extends DomainRuleViolationError {
  readonly reason = "stage_key_taken";
  constructor(stageKey: string) {
    super(`A stage with key "${stageKey}" already exists in this pipeline`);
    this.name = "StageKeyAlreadyTakenError";
  }
}

export class PipelineHasNoOpenStageError extends DomainRuleViolationError {
  readonly reason = "pipeline_has_no_open_stage";
  constructor() {
    super("This pipeline has no open (non-closed) stage — add one before creating opportunities in it");
    this.name = "PipelineHasNoOpenStageError";
  }
}

export class StageNotInPipelineError extends DomainRuleViolationError {
  readonly reason = "stage_not_in_pipeline";
  constructor() {
    super("The target stage does not belong to this opportunity's pipeline");
    this.name = "StageNotInPipelineError";
  }
}

export class OpportunityClosedError extends DomainRuleViolationError {
  readonly reason = "opportunity_closed";
  constructor() {
    super("This opportunity is closed — use the explicit reopen operation before moving its stage");
    this.name = "OpportunityClosedError";
  }
}

export class OpportunityNotClosedError extends DomainRuleViolationError {
  readonly reason = "opportunity_not_closed";
  constructor() {
    super("This opportunity is not closed — there is nothing to reopen");
    this.name = "OpportunityNotClosedError";
  }
}

export class LostReasonRequiredError extends DomainRuleViolationError {
  readonly reason = "lost_reason_required";
  constructor() {
    super("A lost reason is required when moving an opportunity into a closed-lost stage");
    this.name = "LostReasonRequiredError";
  }
}

export class InvalidLeadTransitionError extends DomainRuleViolationError {
  readonly reason = "invalid_lead_transition";
  constructor(from: string, to: string) {
    super(`Cannot transition lead from "${from}" to "${to}"`);
    this.name = "InvalidLeadTransitionError";
  }
}

export class LeadNotQualifiedError extends DomainRuleViolationError {
  readonly reason = "lead_not_qualified";
  constructor() {
    super("Only a qualified lead may be converted into an opportunity");
    this.name = "LeadNotQualifiedError";
  }
}

export class DuplicateRelationshipError extends DomainRuleViolationError {
  readonly reason = "duplicate_relationship";
  constructor() {
    super("This contact already has an active relationship of this type with this company");
    this.name = "DuplicateRelationshipError";
  }
}

export class DuplicateTagAssignmentError extends DomainRuleViolationError {
  readonly reason = "duplicate_tag_assignment";
  constructor() {
    super("This tag is already assigned to this record");
    this.name = "DuplicateTagAssignmentError";
  }
}

export class DuplicateProjectLinkError extends DomainRuleViolationError {
  readonly reason = "duplicate_project_link";
  constructor() {
    super("This CRM record is already linked to this project");
    this.name = "DuplicateProjectLinkError";
  }
}

export class DuplicateAgentGrantError extends DomainRuleViolationError {
  readonly reason = "duplicate_agent_grant";
  constructor() {
    super("This agent already holds an active grant for this CRM permission");
    this.name = "DuplicateAgentGrantError";
  }
}

export class CustomFieldValidationError extends DomainRuleViolationError {
  readonly reason = "custom_field_invalid";
  constructor(fieldKey: string, detail: string) {
    super(`Invalid value for custom field "${fieldKey}": ${detail}`);
    this.name = "CustomFieldValidationError";
  }
}

export class NoStableIdentityError extends DomainRuleViolationError {
  readonly reason = "no_stable_identity";
  constructor() {
    super("A contact needs at least one stable identity: a name, an email, or a phone number");
    this.name = "NoStableIdentityError";
  }
}

export class NoTargetSpecifiedError extends DomainRuleViolationError {
  readonly reason = "no_target_specified";
  constructor(entity: string) {
    super(`A ${entity} must reference at least one of: contact, company, lead, opportunity`);
    this.name = "NoTargetSpecifiedError";
  }
}
