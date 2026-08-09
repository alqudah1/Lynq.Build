import { DomainRuleViolationError } from "@/lib/authz/errors";

export class WorkflowKeyAlreadyTakenError extends DomainRuleViolationError {
  readonly reason = "workflow_key_taken";
  constructor(workflowKey: string) {
    super(`A workflow with key "${workflowKey}" already exists in this organization`);
    this.name = "WorkflowKeyAlreadyTakenError";
  }
}

export class InvalidWorkflowTransitionError extends DomainRuleViolationError {
  readonly reason = "invalid_workflow_transition";
  constructor(from: string, to: string) {
    super(`Cannot transition workflow from "${from}" to "${to}"`);
    this.name = "InvalidWorkflowTransitionError";
  }
}

export class StaleWorkflowUpdateError extends DomainRuleViolationError {
  readonly reason = "stale_update";
  constructor(entity = "record") {
    super(`This ${entity} was modified by someone else — reload and try again`);
    this.name = "StaleWorkflowUpdateError";
  }
}

export class WorkflowVersionNotEditableError extends DomainRuleViolationError {
  readonly reason = "version_not_editable";
  constructor(status: string) {
    super(`Cannot modify a version in status "${status}" — only a "draft" version may be edited`);
    this.name = "WorkflowVersionNotEditableError";
  }
}

export class DuplicateNodeKeyError extends DomainRuleViolationError {
  readonly reason = "duplicate_node_key";
  constructor(nodeKey: string) {
    super(`A node with key "${nodeKey}" already exists in this version`);
    this.name = "DuplicateNodeKeyError";
  }
}

export class SelfEdgeError extends DomainRuleViolationError {
  readonly reason = "self_edge";
  constructor() {
    super("A node cannot have an edge to itself");
    this.name = "SelfEdgeError";
  }
}

export class DuplicateEdgeError extends DomainRuleViolationError {
  readonly reason = "duplicate_edge";
  constructor() {
    super("This edge already exists");
    this.name = "DuplicateEdgeError";
  }
}

export class CrossVersionEdgeError extends DomainRuleViolationError {
  readonly reason = "cross_version_edge";
  constructor() {
    super("Both nodes of an edge must belong to the same workflow version");
    this.name = "CrossVersionEdgeError";
  }
}

export class InvalidNodeConfigurationError extends DomainRuleViolationError {
  readonly reason = "invalid_node_configuration";
  constructor(detail: string) {
    super(`Invalid node configuration: ${detail}`);
    this.name = "InvalidNodeConfigurationError";
  }
}

export class WorkflowValidationFailedError extends DomainRuleViolationError {
  readonly reason = "workflow_validation_failed";
  constructor(public readonly issues: Array<{ nodeId?: string; edgeId?: string; message: string }>) {
    super(`Workflow validation failed: ${issues.map((i) => i.message).join("; ")}`);
    this.name = "WorkflowValidationFailedError";
  }
}

export class WorkflowNotPublishedError extends DomainRuleViolationError {
  readonly reason = "workflow_not_published";
  constructor() {
    super("This workflow has no currently published version");
    this.name = "WorkflowNotPublishedError";
  }
}

export class InvalidWorkflowExecutionTransitionError extends DomainRuleViolationError {
  readonly reason = "invalid_workflow_execution_transition";
  constructor(from: string, to: string) {
    super(`Cannot transition workflow execution from "${from}" to "${to}"`);
    this.name = "InvalidWorkflowExecutionTransitionError";
  }
}

export class InvalidNodeExecutionTransitionError extends DomainRuleViolationError {
  readonly reason = "invalid_node_execution_transition";
  constructor(from: string, to: string) {
    super(`Cannot transition node execution from "${from}" to "${to}"`);
    this.name = "InvalidNodeExecutionTransitionError";
  }
}

/**
 * Retained for backward compatibility with any caller still checking for
 * it directly (see `worker.ts`'s failure classification); as of Module 14,
 * `agent_execution` nodes are no longer bound to one hardcoded driver —
 * an unrecognized/unregistered `agentTaskType` now throws
 * `UnsupportedAgentTaskTypeError` (`@/lib/agent-runtime/task-handlers`)
 * instead, which `worker.ts` also classifies as a permanent failure.
 */
export class UnsupportedAgentDriverError extends DomainRuleViolationError {
  readonly reason = "unsupported_agent_driver";
  constructor() {
    super('No registered agent task handler is eligible to drive this "agent_execution" node');
    this.name = "UnsupportedAgentDriverError";
  }
}

export class WorkflowHumanTaskAlreadyDecidedError extends DomainRuleViolationError {
  readonly reason = "human_task_already_decided";
  constructor() {
    super("This human task has already been completed or cancelled");
    this.name = "WorkflowHumanTaskAlreadyDecidedError";
  }
}

export class MissingApprovalSourceError extends DomainRuleViolationError {
  readonly reason = "missing_approval_source";
  constructor() {
    super('An "approval" node requires its own configured agentId to host the underlying Runtime approval request');
    this.name = "MissingApprovalSourceError";
  }
}

/** Module 14 — an `agent_execution` node declared `expectedOutputKey`, and the completed task's bounded structured output does not contain it. A deterministic node failure, not a thrown error — the workflow's own retry/failure-branch policy decides what happens next, exactly like any other node failure. */
export class InvalidAgentTaskOutputError extends DomainRuleViolationError {
  readonly reason = "invalid_agent_task_output";
  constructor(expectedOutputKey: string) {
    super(`Expected output key "${expectedOutputKey}" was not present in the completed agent task's result`);
    this.name = "InvalidAgentTaskOutputError";
  }
}
