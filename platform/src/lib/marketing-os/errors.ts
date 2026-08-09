import { DomainRuleViolationError } from "@/lib/authz/errors";

export class StaleMarketingUpdateError extends DomainRuleViolationError {
  readonly reason = "stale_update";
  constructor(entity = "record") {
    super(`This ${entity} was modified by someone else — reload and try again`);
    this.name = "StaleMarketingUpdateError";
  }
}

export class InvalidMarketingTransitionError extends DomainRuleViolationError {
  readonly reason = "invalid_marketing_transition";
  constructor(entity: string, from: string, to: string) {
    super(`Cannot transition ${entity} from "${from}" to "${to}"`);
    this.name = "InvalidMarketingTransitionError";
  }
}

export class MarketingKeyAlreadyTakenError extends DomainRuleViolationError {
  readonly reason = "marketing_key_taken";
  constructor(entity: string, key: string) {
    super(`A ${entity} with key "${key}" already exists in this organization`);
    this.name = "MarketingKeyAlreadyTakenError";
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

export class MarketingRoleAlreadyGrantedError extends DomainRuleViolationError {
  readonly reason = "marketing_role_already_granted";
  constructor() {
    super("This user already holds an active Marketing OS role in this organization");
    this.name = "MarketingRoleAlreadyGrantedError";
  }
}

export class MarketingAgentNotSeededError extends DomainRuleViolationError {
  readonly reason = "marketing_agent_not_seeded";
  constructor(agentName: string) {
    super(`The "${agentName}" Marketing agent has not been seeded for this organization yet`);
    this.name = "MarketingAgentNotSeededError";
  }
}

export class MarketingWorkflowTemplateNotSeededError extends DomainRuleViolationError {
  readonly reason = "marketing_workflow_template_not_seeded";
  constructor(workflowKey: string) {
    super(`The "${workflowKey}" Marketing OS workflow template has not been seeded for this organization yet`);
    this.name = "MarketingWorkflowTemplateNotSeededError";
  }
}

export class InvalidAudienceFilterError extends DomainRuleViolationError {
  readonly reason = "invalid_audience_filter";
  constructor(detail: string) {
    super(`Invalid audience filter: ${detail}`);
    this.name = "InvalidAudienceFilterError";
  }
}

export class ContentNotApprovableError extends DomainRuleViolationError {
  readonly reason = "content_not_approvable";
  constructor(detail: string) {
    super(`This content cannot be approved: ${detail}`);
    this.name = "ContentNotApprovableError";
  }
}

export class AgentCannotApproveOwnContentError extends DomainRuleViolationError {
  readonly reason = "agent_cannot_approve_own_content";
  constructor() {
    super("An agent may not approve content it authored — a human decision is required");
    this.name = "AgentCannotApproveOwnContentError";
  }
}

export class CampaignRequirementsIncompleteError extends DomainRuleViolationError {
  readonly reason = "campaign_requirements_incomplete";
  constructor(missingStepKeys: string[]) {
    super(`This campaign run still has required item(s) incomplete: ${missingStepKeys.join(", ")}`);
    this.name = "CampaignRequirementsIncompleteError";
  }
}
