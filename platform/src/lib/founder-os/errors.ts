import { DomainRuleViolationError } from "@/lib/authz/errors";

export class StaleFounderUpdateError extends DomainRuleViolationError {
  readonly reason = "stale_founder_update";
  constructor(entity = "record") {
    super(`This ${entity} was modified by someone else — reload and try again`);
    this.name = "StaleFounderUpdateError";
  }
}

export class FounderRoleAlreadyGrantedError extends DomainRuleViolationError {
  readonly reason = "founder_role_already_granted";
  constructor() {
    super("This user already has an active Founder Workspace role.");
    this.name = "FounderRoleAlreadyGrantedError";
  }
}

export class UnknownGoalMetricError extends DomainRuleViolationError {
  readonly reason = "unknown_goal_metric";
  constructor(metricKey: string) {
    super(`"${metricKey}" is not a registered Analytics metric.`);
    this.name = "UnknownGoalMetricError";
  }
}

export class DecisionAlreadySupersededError extends DomainRuleViolationError {
  readonly reason = "decision_already_superseded";
  constructor() {
    super("This decision has already been superseded.");
    this.name = "DecisionAlreadySupersededError";
  }
}

export class InvalidRelatedRecordError extends DomainRuleViolationError {
  readonly reason = "invalid_related_record";
  constructor(entity: string) {
    super(`The referenced ${entity} does not belong to this organization.`);
    this.name = "InvalidRelatedRecordError";
  }
}

export class FounderAgentNotSeededError extends DomainRuleViolationError {
  readonly reason = "founder_agent_not_seeded";
  constructor() {
    super("The Founder Analyst agent has not been seeded for this organization yet.");
    this.name = "FounderAgentNotSeededError";
  }
}
