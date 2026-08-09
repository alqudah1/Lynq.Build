import { DomainRuleViolationError } from "@/lib/authz/errors";

export class ProjectKeyAlreadyTakenError extends DomainRuleViolationError {
  readonly reason = "project_key_taken";
  constructor(projectKey: string) {
    super(`A project with key "${projectKey}" already exists in this organization`);
    this.name = "ProjectKeyAlreadyTakenError";
  }
}

export class InvalidProjectTransitionError extends DomainRuleViolationError {
  readonly reason = "invalid_project_transition";
  constructor(from: string, to: string) {
    super(`Cannot transition project from "${from}" to "${to}"`);
    this.name = "InvalidProjectTransitionError";
  }
}

export class LastProjectOwnerViolationError extends DomainRuleViolationError {
  readonly reason = "last_project_owner";
  constructor() {
    super("Cannot remove or demote the project's final owner");
    this.name = "LastProjectOwnerViolationError";
  }
}

export class DuplicateProjectMemberError extends DomainRuleViolationError {
  readonly reason = "duplicate_project_member";
  constructor() {
    super("This user is already a member of this project");
    this.name = "DuplicateProjectMemberError";
  }
}

export class InvalidPhaseSequenceError extends DomainRuleViolationError {
  readonly reason = "invalid_phase_sequence";
  constructor(detail: string) {
    super(`Invalid phase sequence: ${detail}`);
    this.name = "InvalidPhaseSequenceError";
  }
}

export class InvalidTaskTransitionError extends DomainRuleViolationError {
  readonly reason = "invalid_task_transition";
  constructor(from: string, to: string) {
    super(`Cannot transition task from "${from}" to "${to}"`);
    this.name = "InvalidTaskTransitionError";
  }
}

/** Shared by projects, phases, milestones, and tasks — the identical revision-guard conflict, one error type rather than four near-identical ones. */
export class StaleUpdateError extends DomainRuleViolationError {
  readonly reason = "stale_update";
  constructor(entity = "record") {
    super(`This ${entity} was modified by someone else — reload and try again`);
    this.name = "StaleUpdateError";
  }
}

export class DuplicateTaskAssignmentError extends DomainRuleViolationError {
  readonly reason = "duplicate_task_assignment";
  constructor() {
    super("This user is already assigned to this task");
    this.name = "DuplicateTaskAssignmentError";
  }
}

export class SelfDependencyError extends DomainRuleViolationError {
  readonly reason = "self_dependency";
  constructor() {
    super("A task cannot depend on itself");
    this.name = "SelfDependencyError";
  }
}

export class DuplicateDependencyError extends DomainRuleViolationError {
  readonly reason = "duplicate_dependency";
  constructor() {
    super("This dependency already exists");
    this.name = "DuplicateDependencyError";
  }
}

export class DependencyCycleError extends DomainRuleViolationError {
  readonly reason = "dependency_cycle";
  constructor() {
    super("This dependency would create a cycle");
    this.name = "DependencyCycleError";
  }
}

export class CrossProjectDependencyError extends DomainRuleViolationError {
  readonly reason = "cross_project_dependency";
  constructor() {
    super("Tasks must belong to the same project to have a dependency between them");
    this.name = "CrossProjectDependencyError";
  }
}

export class UnresolvedDependenciesError extends DomainRuleViolationError {
  readonly reason = "unresolved_dependencies";
  constructor(count: number) {
    super(`Cannot complete this task — ${count} blocking dependenc${count === 1 ? "y is" : "ies are"} not yet resolved`);
    this.name = "UnresolvedDependenciesError";
  }
}

export class DuplicateArtifactLinkError extends DomainRuleViolationError {
  readonly reason = "duplicate_artifact_link";
  constructor() {
    super("This artifact is already linked to this entity");
    this.name = "DuplicateArtifactLinkError";
  }
}

export class DuplicateApprovalLinkError extends DomainRuleViolationError {
  readonly reason = "duplicate_approval_link";
  constructor() {
    super("This approval request is already linked to this entity");
    this.name = "DuplicateApprovalLinkError";
  }
}

export class ActiveExecutionAlreadyLinkedError extends DomainRuleViolationError {
  readonly reason = "active_execution_already_linked";
  constructor() {
    super("This task already has an active agent execution — wait for it to finish before launching another");
    this.name = "ActiveExecutionAlreadyLinkedError";
  }
}
