import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { workflowNodes, workflowEdges } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { createExecution } from "@/lib/agent-runtime/executions";
import { assignExecution, startExecution, advanceExecution, completeExecution, failExecution } from "@/lib/agent-runtime/lifecycle";
import { createArtifact } from "@/lib/agent-runtime/artifacts";
import { requestApproval } from "@/lib/agent-runtime/approvals";
import { invokeTool } from "@/lib/tools/invocation";
import { resolveAgentById } from "@/lib/agents/agents";
import "@/lib/agents/knowledge-analyst";
import "@/lib/sales-os/agents";
import { resolveAgentTaskHandler, type AgentTaskType, type AgentTaskCompletionEvidence } from "@/lib/agent-runtime/task-handlers";
import { createTask, resolveTaskById } from "@/lib/projects/tasks";
import { enqueueJob } from "@/lib/runtime/queue";
import { resolveWorkflowExecutionById, transitionWorkflowExecutionStatus, type WorkflowExecution } from "./executions";
import { createNodeExecution, getActiveNodeExecution, requireTransitionNodeExecution, transitionNodeExecution, type WorkflowNodeExecution } from "./node-executions";
import { createWorkflowHumanTask } from "./human-tasks";
import { recordWorkflowEvent } from "./events";
import { resolveMapping, evaluateConditionBranches, type ConditionBranchConfig } from "./mapping";
import { UnsupportedAgentDriverError } from "./errors";
import type { MappingSource } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;
type RawSql = NeonQueryFunction<false, false>;

type NodeRow = typeof workflowNodes.$inferSelect;

const MAX_SYNCHRONOUS_STEPS_PER_CALL = 50;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function getNode(db: Db, organizationId: string, nodeId: string): Promise<NodeRow> {
  const [row] = await db.select().from(workflowNodes).where(and(eq(workflowNodes.id, nodeId), eq(workflowNodes.organizationId, organizationId)));
  if (!row) throw new Error(`workflow node ${nodeId} not found`);
  return row;
}

async function getStartNode(db: Db, organizationId: string, versionId: string): Promise<NodeRow> {
  const [row] = await db.select().from(workflowNodes).where(and(eq(workflowNodes.workflowVersionId, versionId), eq(workflowNodes.organizationId, organizationId), eq(workflowNodes.nodeType, "start")));
  if (!row) throw new Error(`workflow version ${versionId} has no start node`);
  return row;
}

async function getOutgoingEdges(db: Db, organizationId: string, nodeId: string) {
  return db.select().from(workflowEdges).where(and(eq(workflowEdges.sourceNodeId, nodeId), eq(workflowEdges.organizationId, organizationId)));
}

/** Collects every prior succeeded node's output, keyed by nodeKey — the mapping resolver's `node_output` source reads from this. */
async function collectNodeOutputs(db: Db, organizationId: string, workflowExecutionId: string): Promise<Record<string, unknown>> {
  const { listNodeExecutionsForExecution } = await import("./node-executions");
  const executions = await listNodeExecutionsForExecution(db, workflowExecutionId);
  const outputs: Record<string, unknown> = {};
  for (const nodeExecution of executions) {
    if (nodeExecution.status !== "succeeded" || !nodeExecution.output) continue;
    const node = await getNode(db, organizationId, nodeExecution.workflowNodeId);
    outputs[node.nodeKey] = nodeExecution.output;
  }
  return outputs;
}

async function buildMappingContext(db: Db, organizationId: string, execution: WorkflowExecution) {
  return {
    workflowInput: execution.input,
    nodeOutputs: await collectNodeOutputs(db, organizationId, execution.id),
    trustedContext: { organizationId: execution.organizationId, workspaceId: execution.workspaceId, initiatorUserId: execution.initiatorUserId },
  };
}

type NodeResolution = { resolution: "succeeded"; output: Record<string, unknown> } | { resolution: "waiting" } | { resolution: "failed"; failureClassification: string; message: string };

// ---------------------------------------------------------------------------
// Node executors — one per type. Every one orchestrates an EXISTING system
// (Agent Runtime, Tool Runtime, Projects Core, the runtime queue) — none
// invents a second engine, a workflow-specific agent, or a workflow-specific
// tool.
// ---------------------------------------------------------------------------

async function executeStartNode(execution: WorkflowExecution): Promise<NodeResolution> {
  return { resolution: "succeeded", output: { startedWith: execution.input } };
}

async function executeEndNode(node: NodeRow, mappedInput: Record<string, unknown>): Promise<NodeResolution> {
  const config = node.configuration as { requiredOutputs?: string[] };
  const missing = (config.requiredOutputs ?? []).filter((key) => mappedInput[key] === undefined);
  if (missing.length > 0) {
    return { resolution: "failed", failureClassification: "invalid_mapping", message: `end node is missing required output(s): ${missing.join(", ")}` };
  }
  return { resolution: "succeeded", output: mappedInput };
}

async function executeConditionNode(node: NodeRow, mappingCtx: Parameters<typeof evaluateConditionBranches>[2]): Promise<NodeResolution> {
  const config = node.configuration as { branches: ConditionBranchConfig[]; defaultBranchKey?: string };
  try {
    const branchKey = evaluateConditionBranches(config.branches, config.defaultBranchKey, mappingCtx);
    return { resolution: "succeeded", output: { selectedBranch: branchKey } };
  } catch (err) {
    return { resolution: "failed", failureClassification: "invalid_mapping", message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Shared shell-execution driver — every node type that touches the Agent
 * Runtime (tool_invocation, approval, artifact_transform) creates its OWN
 * minimal `agent_executions` row, driven through the exact existing
 * lifecycle primitives (`createExecution` → `assignExecution` →
 * `startExecution` → `advanceExecution` chain to `executing`) rather than
 * a parallel mechanism. No plan is ever created for these shells —
 * `completeExecution`'s own completion-evidence gate passes vacuously when
 * `currentPlanId` is null, exactly as Module 7 designed it for executions
 * that never required planning.
 */
async function driveShellExecutionToExecuting(db: Db, input: { organizationId: string; workspaceId: string | null; agentId: string; goal: string; actorUserId: string }): Promise<string> {
  const execution = await createExecution(db, {
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    ownerUserId: input.actorUserId,
    goal: input.goal,
    successCriteria: "The workflow node's own configured action completes.",
    failureCriteria: "The workflow node's own configured action cannot be completed.",
    domainsRequested: [],
    actorUserId: input.actorUserId,
  });
  await assignExecution(db, { organizationId: input.organizationId, executionId: execution.id, assignedAgentId: input.agentId, actorUserId: input.actorUserId });
  await startExecution(db, { organizationId: input.organizationId, executionId: execution.id, actorUserId: input.actorUserId });
  await advanceExecution(db, { organizationId: input.organizationId, executionId: execution.id, toStatus: "planning", actorAgentId: input.agentId });
  await advanceExecution(db, { organizationId: input.organizationId, executionId: execution.id, toStatus: "reasoning", actorAgentId: input.agentId });
  await advanceExecution(db, { organizationId: input.organizationId, executionId: execution.id, toStatus: "executing", actorAgentId: input.agentId });
  return execution.id;
}

async function finishShellExecution(db: Db, organizationId: string, executionId: string, agentId: string): Promise<void> {
  await advanceExecution(db, { organizationId, executionId, toStatus: "verifying", actorAgentId: agentId });
  await completeExecution(db, { organizationId, executionId, actorAgentId: agentId });
}

async function executeToolInvocationNode(db: Db, rawSql: RawSql, input: { organizationId: string; workspaceId: string | null; node: NodeRow; mappedInput: Record<string, unknown>; actorUserId: string; idempotencyKey: string }): Promise<NodeResolution & { runtimeExecutionId?: string; toolInvocationId?: string }> {
  const config = input.node.configuration as { agentId: string; toolKey: string };
  const agent = await resolveAgentById(db, config.agentId);
  if (!agent || agent.organizationId !== input.organizationId || agent.lifecycleStage === "retired") {
    return { resolution: "failed", failureClassification: "permission_revoked", message: "referenced agent is retired or no longer eligible" };
  }

  const runtimeExecutionId = await driveShellExecutionToExecuting(db, { organizationId: input.organizationId, workspaceId: input.workspaceId, agentId: agent.id, goal: `Workflow tool invocation: ${input.node.name}`, actorUserId: input.actorUserId });

  try {
    const result = await invokeTool(db, rawSql, { organizationId: input.organizationId, executionId: runtimeExecutionId, agentId: agent.id, toolKey: config.toolKey, idempotencyKey: input.idempotencyKey, toolInput: input.mappedInput });
    await finishShellExecution(db, input.organizationId, runtimeExecutionId, agent.id);
    return { resolution: "succeeded", output: { toolOutput: result.output as Record<string, unknown> }, runtimeExecutionId, toolInvocationId: result.invocationId };
  } catch (err) {
    await failExecution(db, { organizationId: input.organizationId, executionId: runtimeExecutionId, failureClass: "runtime_error", reason: err instanceof Error ? err.message.slice(0, 500) : String(err) }).catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes("approval")) return { resolution: "waiting", runtimeExecutionId };
    return { resolution: "failed", failureClassification: "tool_error", message, runtimeExecutionId };
  }
}

async function executeArtifactTransformNode(db: Db, input: { organizationId: string; workspaceId: string | null; node: NodeRow; mappingCtx: Parameters<typeof resolveMapping>[1]; actorUserId: string }): Promise<NodeResolution & { runtimeExecutionId?: string; artifactId?: string }> {
  const config = input.node.configuration as { agentId: string; title: string; sourceOutputKeys: string[] };
  const agent = await resolveAgentById(db, config.agentId);
  if (!agent || agent.organizationId !== input.organizationId || agent.lifecycleStage === "retired") {
    return { resolution: "failed", failureClassification: "permission_revoked", message: "referenced agent is retired or no longer eligible" };
  }

  // Deterministic, bounded manifest of the SOURCE artifacts this transform draws from — never their full content, and never mutating them.
  const sources = config.sourceOutputKeys.map((key) => {
    const value = input.mappingCtx.nodeOutputs[key] as Record<string, unknown> | undefined;
    return { sourceOutputKey: key, artifactId: value?.artifactId ?? null, toolOutput: value?.toolOutput ?? null };
  });
  const content = JSON.stringify({ title: config.title, sources }).slice(0, 20000);

  const runtimeExecutionId = await driveShellExecutionToExecuting(db, { organizationId: input.organizationId, workspaceId: input.workspaceId, agentId: agent.id, goal: `Workflow artifact transform: ${input.node.name}`, actorUserId: input.actorUserId });

  const artifact = await createArtifact(db, { organizationId: input.organizationId, executionId: runtimeExecutionId, artifactType: "structured_data", title: config.title, content, actorAgentId: agent.id });
  await finishShellExecution(db, input.organizationId, runtimeExecutionId, agent.id);

  return { resolution: "succeeded", output: { artifactId: artifact.id }, runtimeExecutionId, artifactId: artifact.id };
}

async function executeApprovalNode(db: Db, input: { organizationId: string; workspaceId: string | null; node: NodeRow; actorUserId: string }): Promise<NodeResolution & { runtimeExecutionId?: string; approvalRequestId?: string }> {
  const config = input.node.configuration as { agentId: string; requestedAction: string; summary: string; riskLevel: "low" | "medium" | "high" | "critical"; expiresInHours?: number };
  const agent = await resolveAgentById(db, config.agentId);
  if (!agent || agent.organizationId !== input.organizationId || agent.lifecycleStage === "retired") {
    return { resolution: "failed", failureClassification: "permission_revoked", message: "referenced agent is retired or no longer eligible" };
  }

  const runtimeExecutionId = await driveShellExecutionToExecuting(db, { organizationId: input.organizationId, workspaceId: input.workspaceId, agentId: agent.id, goal: `Workflow approval: ${input.node.name}`, actorUserId: input.actorUserId });

  const { request } = await requestApproval(db, {
    organizationId: input.organizationId,
    executionId: runtimeExecutionId,
    requestedAction: config.requestedAction,
    summary: config.summary,
    riskLevel: config.riskLevel,
    expiresInHours: config.expiresInHours,
    actorAgentId: agent.id,
  });

  return { resolution: "waiting", runtimeExecutionId, approvalRequestId: request.id };
}

/**
 * Resolves one `agent_execution` node's configuration into a task type and
 * bounded task input — genericized in Module 14. A historically-published
 * node with no `agentTaskType` (the pre-Module-14 shape:
 * `{agentId, topic, allowedDomains, maxResults?}`) is never rewritten in
 * place; it is detected here and resolved to `company_knowledge_report`,
 * preserving the exact same mapped-input-overrides-static-config behavior
 * the original hardcoded executor had.
 */
function resolveAgentExecutionNodeTask(node: NodeRow, mappedInput: Record<string, unknown>): { agentTaskType: AgentTaskType; taskInput: Record<string, unknown>; expectedOutputKey?: string } {
  const rawConfig = node.configuration as Record<string, unknown>;
  if (typeof rawConfig.agentTaskType === "string") {
    return { agentTaskType: rawConfig.agentTaskType as AgentTaskType, taskInput: mappedInput, expectedOutputKey: typeof rawConfig.expectedOutputKey === "string" ? rawConfig.expectedOutputKey : undefined };
  }
  const legacy = rawConfig as { topic: string; allowedDomains: string[]; maxResults?: number };
  const topic = typeof mappedInput.topic === "string" && mappedInput.topic.length > 0 ? mappedInput.topic : legacy.topic;
  const allowedDomains = Array.isArray(mappedInput.allowedDomains) && mappedInput.allowedDomains.length > 0 ? mappedInput.allowedDomains : legacy.allowedDomains;
  return { agentTaskType: "company_knowledge_report", taskInput: { topic, allowedDomains, maxResults: legacy.maxResults } };
}

/** Builds this node's own output from a completed task's bounded evidence — preserves the original `{runtimeExecutionId, reportArtifactId}` shape every existing template/mapping consumer already reads, plus the rest of the task's structured output. Returns `null` if the node declared `expectedOutputKey` and the task's output doesn't contain it — a deterministic node failure, never a silent gap. */
function buildAgentTaskNodeOutput(evidence: AgentTaskCompletionEvidence, expectedOutputKey?: string): Record<string, unknown> | null {
  if (expectedOutputKey && evidence.structuredOutput[expectedOutputKey] === undefined) return null;
  return { runtimeExecutionId: evidence.runtimeExecutionId, reportArtifactId: evidence.primaryArtifactId, ...evidence.structuredOutput };
}

async function executeAgentExecutionNode(db: Db, input: { organizationId: string; workspaceId: string | null; node: NodeRow; mappedInput: Record<string, unknown>; actorUserId: string; nodeExecutionId: string }): Promise<NodeResolution & { runtimeExecutionId?: string }> {
  const { agentTaskType, taskInput, expectedOutputKey } = resolveAgentExecutionNodeTask(input.node, input.mappedInput);

  const handler = resolveAgentTaskHandler(agentTaskType);
  if (!handler) throw new UnsupportedAgentDriverError();

  const config = input.node.configuration as { agentId: string };
  const agent = await resolveAgentById(db, config.agentId);
  if (!agent || agent.organizationId !== input.organizationId || agent.lifecycleStage === "retired") {
    return { resolution: "failed", failureClassification: "permission_revoked", message: "referenced agent is retired or no longer eligible" };
  }
  if (!handler.isAgentEligible(agent)) {
    return { resolution: "failed", failureClassification: "agent_task_ineligible", message: `agent ${agent.id} is not eligible for agent task type "${agentTaskType}"` };
  }

  await recordAuditEvent(db, { eventType: "agent_task_handler_resolved", organizationId: input.organizationId, actorUserId: input.actorUserId, targetType: "workflow_node_execution", targetId: input.nodeExecutionId, metadata: { agentTaskType, agentId: agent.id } });

  const { runtimeExecutionId } = await handler.launch(db, { organizationId: input.organizationId, workspaceId: input.workspaceId, agentId: agent.id, actorUserId: input.actorUserId, taskInput });
  await recordAuditEvent(db, { eventType: "workflow_agent_task_started", organizationId: input.organizationId, actorUserId: input.actorUserId, targetType: "workflow_node_execution", targetId: input.nodeExecutionId, metadata: { agentTaskType, runtimeExecutionId } });

  // Some handlers (the synchronous Sales agents) complete before `launch`
  // even returns — check immediately so the node resolves inline rather
  // than waiting for a poll it will never need, mirroring how
  // tool_invocation/artifact_transform already resolve synchronously.
  const state = await handler.resolveState(db, { organizationId: input.organizationId, runtimeExecutionId });
  if (state.status === "succeeded") {
    const output = buildAgentTaskNodeOutput(state.evidence, expectedOutputKey);
    if (output === null) {
      return { resolution: "failed", failureClassification: "invalid_agent_task_output", message: `expected output key "${expectedOutputKey}" was not present in the task result`, runtimeExecutionId };
    }
    await recordAuditEvent(db, { eventType: "workflow_agent_task_completed", organizationId: input.organizationId, actorUserId: input.actorUserId, targetType: "workflow_node_execution", targetId: input.nodeExecutionId, metadata: { agentTaskType, runtimeExecutionId } });
    return { resolution: "succeeded", output, runtimeExecutionId };
  }
  if (state.status === "failed") {
    await recordAuditEvent(db, { eventType: "workflow_agent_task_failed", organizationId: input.organizationId, actorUserId: input.actorUserId, targetType: "workflow_node_execution", targetId: input.nodeExecutionId, metadata: { agentTaskType, runtimeExecutionId, failureClassification: state.failureClassification } });
    return { resolution: "failed", failureClassification: state.failureClassification, message: state.message, runtimeExecutionId };
  }
  return { resolution: "waiting", runtimeExecutionId };
}

async function executeHumanTaskNode(db: Db, input: { organizationId: string; node: NodeRow; workflowExecutionId: string; workflowNodeExecutionId: string }): Promise<NodeResolution> {
  const config = input.node.configuration as { assignedUserId: string; title: string; instructions?: string; dueInHours?: number };
  const dueDate = config.dueInHours ? new Date(Date.now() + config.dueInHours * 3600 * 1000) : null;

  await createWorkflowHumanTask(db, {
    organizationId: input.organizationId,
    workflowExecutionId: input.workflowExecutionId,
    workflowNodeExecutionId: input.workflowNodeExecutionId,
    title: config.title,
    instructions: config.instructions ?? null,
    assignedUserId: config.assignedUserId,
    dueDate,
  });

  return { resolution: "waiting" };
}

async function executeWaitNode(node: NodeRow): Promise<{ resolution: "waiting"; availableAt: Date }> {
  const config = node.configuration as { untilTimestamp?: string; durationSeconds?: number };
  const availableAt = config.untilTimestamp ? new Date(config.untilTimestamp) : new Date(Date.now() + (config.durationSeconds ?? 0) * 1000);
  return { resolution: "waiting", availableAt };
}

async function executeProjectTaskNode(db: Db, input: { organizationId: string; node: NodeRow; execution: WorkflowExecution }): Promise<NodeResolution & { projectTaskId?: string }> {
  const config = input.node.configuration as { createNew: boolean; title?: string; description?: string; phaseId?: string; milestoneId?: string };
  if (!input.execution.projectId) {
    return { resolution: "failed", failureClassification: "missing_project", message: "this workflow execution has no linked project — a project_task node requires one" };
  }
  if (!input.execution.initiatorUserId) {
    return { resolution: "failed", failureClassification: "missing_actor", message: "this workflow execution has no initiating user" };
  }

  if (config.createNew) {
    const task = await createTask(db, {
      organizationId: input.organizationId,
      projectId: input.execution.projectId,
      phaseId: config.phaseId ?? null,
      milestoneId: config.milestoneId ?? null,
      title: config.title!,
      description: config.description ?? null,
      actorUserId: input.execution.initiatorUserId,
    });
    return { resolution: "waiting", projectTaskId: task.id };
  }

  if (!input.execution.projectTaskId) {
    return { resolution: "failed", failureClassification: "missing_project_task", message: "this workflow execution has no linked project task to link to" };
  }
  return { resolution: "waiting", projectTaskId: input.execution.projectTaskId };
}

// ---------------------------------------------------------------------------
// The driver — advances an execution as far as it can go synchronously,
// stopping at the first node that must wait on something external.
// ---------------------------------------------------------------------------

export async function driveWorkflowForward(db: Db, rawSql: RawSql, input: { organizationId: string; workflowExecutionId: string }): Promise<void> {
  let execution = await resolveWorkflowExecutionById(db, input.organizationId, input.workflowExecutionId);
  if (["completed", "failed", "cancelled", "paused"].includes(execution.status)) return;

  for (let step = 0; step < MAX_SYNCHRONOUS_STEPS_PER_CALL; step++) {
    if (!execution.currentNodeId) {
      const startNode = await getStartNode(db, input.organizationId, execution.workflowVersionId);
      execution = (await transitionWorkflowExecutionStatus(db, execution.id, input.organizationId, execution.revision, ["queued"], "running", { currentNodeId: startNode.id, startedAt: new Date() })) ?? execution;
      await recordAuditEvent(db, { eventType: "workflow_execution_started", organizationId: input.organizationId, targetType: "workflow_execution", targetId: execution.id, metadata: { startNodeId: startNode.id } });
      await recordWorkflowEvent(db, { organizationId: input.organizationId, workflowExecutionId: execution.id, eventType: "workflow_execution_started", workflowNodeId: startNode.id });
    }

    const node = await getNode(db, input.organizationId, execution.currentNodeId!);
    let nodeExecution = await getActiveNodeExecution(db, execution.id, node.id);
    if (!nodeExecution) {
      nodeExecution = await createNodeExecution(db, { organizationId: input.organizationId, workflowExecutionId: execution.id, workflowNodeId: node.id, attemptNumber: 1 });
    }

    const resolvedHere = await runSynchronousNodeTypes(db, execution, node);
    if (resolvedHere === null) {
      // Async node type — its own dispatch is a separately claimable,
      // crash-safe unit of work (`workflow_node_execute`), not run inline
      // here. If the worker process dies mid-dispatch, Module 9's own
      // lease-expiry/reclaim mechanism recovers this job exactly like any
      // other — never a special case.
      await enqueueJob(db, {
        organizationId: input.organizationId,
        workspaceId: execution.workspaceId,
        jobType: "workflow_node_execute",
        workflowExecutionId: execution.id,
        idempotencyKey: `wf-node:${execution.id}:${node.id}:${nodeExecution.attemptNumber}`,
      });
      return;
    }

    if (resolvedHere.resolution !== "succeeded") {
      // Synchronous node types (start/end/condition) never resolve to "waiting" — this is a defensive fallback, not a reachable path in practice.
      await handleNodeFailure(db, execution, node, nodeExecution, resolvedHere.resolution === "failed" ? resolvedHere : { failureClassification: "unexpected_wait", message: "a synchronous node type unexpectedly returned a waiting resolution" });
      return;
    }

    await requireTransitionNodeExecution(db, { organizationId: input.organizationId, nodeExecutionId: nodeExecution.id, expectedRevision: nodeExecution.revision, fromStatuses: ["pending", "ready", "running"], toStatus: "succeeded", extra: { output: resolvedHere.output, completedAt: new Date() } });
    await recordWorkflowEvent(db, { organizationId: input.organizationId, workflowExecutionId: execution.id, workflowNodeId: node.id, workflowNodeExecutionId: nodeExecution.id, eventType: "workflow_node_completed" });

    const advanced = await advanceAfterNodeSuccess(db, execution, node, nodeExecution, resolvedHere.output);
    if (!advanced) return;
    execution = advanced;
  }
}

/**
 * The one place `currentNodeId` ever moves forward after a node succeeds
 * — used identically whether the success was synchronous (this loop),
 * async-but-resolved-immediately (`dispatchAsyncNode`), or async-resolved-
 * later (`checkAndContinueWorkflow`). Completes the workflow itself when
 * the succeeded node was an `end` node. Returns the updated execution to
 * keep advancing, or `null` when the caller should stop (workflow
 * completed, or the graph itself was invalid).
 */
async function advanceAfterNodeSuccess(db: Db, execution: WorkflowExecution, node: NodeRow, nodeExecution: WorkflowNodeExecution, output: Record<string, unknown>): Promise<WorkflowExecution | null> {
  if (node.nodeType === "end") {
    const completed = await transitionWorkflowExecutionStatus(db, execution.id, execution.organizationId, execution.revision, ["running", "waiting", "waiting_for_approval"], "completed", { completedAt: new Date() });
    if (completed) {
      await recordAuditEvent(db, { eventType: "workflow_execution_completed", organizationId: execution.organizationId, targetType: "workflow_execution", targetId: execution.id, metadata: {} });
      await recordWorkflowEvent(db, { organizationId: execution.organizationId, workflowExecutionId: execution.id, eventType: "workflow_execution_completed" });
    }
    return null;
  }

  const nextNode = await determineNextNode(db, execution.organizationId, node, output);
  if (!nextNode) {
    await handleNodeFailure(db, execution, node, nodeExecution, { failureClassification: "invalid_graph", message: "no outgoing edge could be resolved for this node" });
    return null;
  }

  return (await transitionWorkflowExecutionStatus(db, execution.id, execution.organizationId, execution.revision, ["running", "waiting", "waiting_for_approval"], "running", { currentNodeId: nextNode.id })) ?? execution;
}

async function runSynchronousNodeTypes(db: Db, execution: WorkflowExecution, node: NodeRow): Promise<NodeResolution | null> {
  const mappingCtx = await buildMappingContext(db, execution.organizationId, execution);
  const mappedInput = resolveMapping(node.inputMapping as Record<string, MappingSource>, mappingCtx);

  switch (node.nodeType) {
    case "start":
      return executeStartNode(execution);
    case "end":
      return executeEndNode(node, mappedInput);
    case "condition":
      return executeConditionNode(node, mappingCtx);
    default:
      return null;
  }
}

/**
 * The `workflow_node_execute` job handler — launches/initiates exactly one
 * async node's underlying work (a Runtime execution, an approval request,
 * a human task, a wait schedule, a project task). Idempotent by
 * construction: the idempotency key is scoped to
 * `(workflowExecutionId, nodeId, attemptNumber)`, and the active-node
 * partial unique index on `workflow_node_executions` guarantees this
 * attempt's row exists exactly once regardless of how many times this job
 * is (re)claimed.
 */
export async function executeWorkflowNodeJob(db: Db, rawSql: RawSql, input: { organizationId: string; workflowExecutionId: string }): Promise<void> {
  const execution = await resolveWorkflowExecutionById(db, input.organizationId, input.workflowExecutionId);
  if (!execution.currentNodeId) return;
  const node = await getNode(db, input.organizationId, execution.currentNodeId);
  const nodeExecution = await getActiveNodeExecution(db, execution.id, node.id);
  if (!nodeExecution || nodeExecution.status !== "pending") return;

  await dispatchAsyncNode(db, rawSql, execution, node, nodeExecution);
}

/**
 * `nodeExecution` is intentionally reassignable within this function:
 * `agent_execution` claims its attempt (CAS "pending" → "running") before
 * launching a real Runtime execution, closing the race where two workers
 * could otherwise both launch one (Module 14) — every reference to
 * `nodeExecution` below this point must see that claimed row (correct
 * revision), not the stale one the caller fetched. On a failed resolution
 * this function calls `handleNodeFailure` itself, using its own
 * (possibly-claimed) `nodeExecution` reference, rather than handing the
 * stale caller reference back up — a caller-side CAS against a stale
 * revision would silently no-op and leave the row stuck.
 */
async function dispatchAsyncNode(db: Db, rawSql: RawSql, execution: WorkflowExecution, node: NodeRow, nodeExecution: WorkflowNodeExecution): Promise<NodeResolution> {
  const mappingCtx = await buildMappingContext(db, execution.organizationId, execution);
  const mappedInput = resolveMapping(node.inputMapping as Record<string, MappingSource>, mappingCtx);

  let result: NodeResolution & { runtimeExecutionId?: string; toolInvocationId?: string; approvalRequestId?: string; projectTaskId?: string; artifactId?: string; availableAt?: Date };

  switch (node.nodeType) {
    case "tool_invocation":
      result = await executeToolInvocationNode(db, rawSql, { organizationId: execution.organizationId, workspaceId: execution.workspaceId, node, mappedInput, actorUserId: execution.initiatorUserId ?? "", idempotencyKey: `wf-node:${nodeExecution.id}:${nodeExecution.attemptNumber}` });
      break;
    case "artifact_transform":
      result = await executeArtifactTransformNode(db, { organizationId: execution.organizationId, workspaceId: execution.workspaceId, node, mappingCtx, actorUserId: execution.initiatorUserId ?? "" });
      break;
    case "approval":
      result = await executeApprovalNode(db, { organizationId: execution.organizationId, workspaceId: execution.workspaceId, node, actorUserId: execution.initiatorUserId ?? "" });
      break;
    case "agent_execution": {
      const claimed = await transitionNodeExecution(db, { organizationId: execution.organizationId, nodeExecutionId: nodeExecution.id, expectedRevision: nodeExecution.revision, fromStatuses: ["pending"], toStatus: "running" });
      if (!claimed) return { resolution: "waiting" }; // already claimed by another dispatch attempt — safe no-op, that attempt owns this node.
      nodeExecution = claimed;
      result = await executeAgentExecutionNode(db, { organizationId: execution.organizationId, workspaceId: execution.workspaceId, node, mappedInput, actorUserId: execution.initiatorUserId ?? "", nodeExecutionId: nodeExecution.id });
      break;
    }
    case "human_task":
      result = await executeHumanTaskNode(db, { organizationId: execution.organizationId, node, workflowExecutionId: execution.id, workflowNodeExecutionId: nodeExecution.id });
      break;
    case "wait":
      result = await executeWaitNode(node);
      break;
    case "project_task":
      result = await executeProjectTaskNode(db, { organizationId: execution.organizationId, node, execution });
      break;
    default:
      result = { resolution: "failed", failureClassification: "unknown_node_type", message: `unhandled node type "${node.nodeType}"` };
  }

  if (result.resolution === "failed") {
    await handleNodeFailure(db, execution, node, nodeExecution, result);
    return result;
  }

  const extra: Record<string, unknown> = { runtimeExecutionId: result.runtimeExecutionId ?? null, toolInvocationId: result.toolInvocationId ?? null, approvalRequestId: result.approvalRequestId ?? null, projectTaskId: result.projectTaskId ?? null, artifactId: result.artifactId ?? null };
  if (result.resolution === "succeeded") {
    // The common case for `tool_invocation`/`artifact_transform` — both complete within this same call, never actually waiting on anything external. Advances `currentNodeId` through the identical shared step the synchronous loop uses, then re-enters `driveWorkflowForward` to continue from there — never re-executes this already-succeeded node.
    await requireTransitionNodeExecution(db, { organizationId: execution.organizationId, nodeExecutionId: nodeExecution.id, expectedRevision: nodeExecution.revision, fromStatuses: ["pending", "ready", "running"], toStatus: "succeeded", extra: { ...extra, output: result.output, completedAt: new Date() } });
    await recordWorkflowEvent(db, { organizationId: execution.organizationId, workflowExecutionId: execution.id, workflowNodeId: node.id, workflowNodeExecutionId: nodeExecution.id, eventType: "workflow_node_completed" });
    const advanced = await advanceAfterNodeSuccess(db, execution, node, nodeExecution, result.output);
    if (advanced) await driveWorkflowForward(db, rawSql, { organizationId: execution.organizationId, workflowExecutionId: execution.id });
    return result;
  }

  await requireTransitionNodeExecution(db, { organizationId: execution.organizationId, nodeExecutionId: nodeExecution.id, expectedRevision: nodeExecution.revision, fromStatuses: ["pending", "ready", "running"], toStatus: "waiting", extra });
  const newStatus = node.nodeType === "approval" ? "waiting_for_approval" : "waiting";
  await transitionWorkflowExecutionStatus(db, execution.id, execution.organizationId, execution.revision, ["running"], newStatus);
  await recordWorkflowEvent(db, { organizationId: execution.organizationId, workflowExecutionId: execution.id, workflowNodeId: node.id, workflowNodeExecutionId: nodeExecution.id, eventType: "workflow_node_started", metadata: { nodeType: node.nodeType } });
  await recordAuditEvent(db, { eventType: "workflow_node_started", organizationId: execution.organizationId, targetType: "workflow_node_execution", targetId: nodeExecution.id, metadata: { nodeType: node.nodeType } });

  if (node.nodeType === "wait" && result.availableAt) {
    await enqueueJob(db, { organizationId: execution.organizationId, workspaceId: execution.workspaceId, jobType: "workflow_continue", workflowExecutionId: execution.id, availableAt: result.availableAt, idempotencyKey: `wf-continue:${execution.id}` });
  }
  if (result.runtimeExecutionId && node.nodeType === "tool_invocation") {
    await recordAuditEvent(db, { eventType: "workflow_agent_execution_linked", organizationId: execution.organizationId, targetType: "workflow_node_execution", targetId: nodeExecution.id, metadata: { runtimeExecutionId: result.runtimeExecutionId } });
  }
  if (result.approvalRequestId) {
    await recordAuditEvent(db, { eventType: "workflow_approval_linked", organizationId: execution.organizationId, targetType: "workflow_node_execution", targetId: nodeExecution.id, metadata: { approvalRequestId: result.approvalRequestId } });
  }

  return result;
}

async function handleNodeFailure(db: Db, execution: WorkflowExecution, node: NodeRow, nodeExecution: WorkflowNodeExecution, failure: { failureClassification: string; message: string }): Promise<void> {
  const retryPolicy = node.retryPolicy as { maxAttempts: number; retryableFailureClasses: string[]; onFailure: "fail_workflow" | "pause_for_human" | "retry" | "continue_to_failure_branch"; failureBranchKey?: string };

  await transitionNodeExecution(db, { organizationId: execution.organizationId, nodeExecutionId: nodeExecution.id, expectedRevision: nodeExecution.revision, fromStatuses: ["pending", "ready", "running", "waiting"], toStatus: "failed", extra: { failureClassification: failure.failureClassification, completedAt: new Date() } });
  await recordWorkflowEvent(db, { organizationId: execution.organizationId, workflowExecutionId: execution.id, workflowNodeId: node.id, workflowNodeExecutionId: nodeExecution.id, eventType: "workflow_node_failed", metadata: { failureClassification: failure.failureClassification } });
  await recordAuditEvent(db, { eventType: "workflow_node_failed", organizationId: execution.organizationId, targetType: "workflow_node_execution", targetId: nodeExecution.id, metadata: { failureClassification: failure.failureClassification } });

  const canRetry = retryPolicy.retryableFailureClasses.includes(failure.failureClassification) && nodeExecution.attemptNumber < retryPolicy.maxAttempts;
  if (canRetry && retryPolicy.onFailure === "retry") {
    await createNodeExecution(db, { organizationId: execution.organizationId, workflowExecutionId: execution.id, workflowNodeId: node.id, attemptNumber: nodeExecution.attemptNumber + 1 });
    await enqueueJob(db, { organizationId: execution.organizationId, workspaceId: execution.workspaceId, jobType: "workflow_continue", workflowExecutionId: execution.id, idempotencyKey: `wf-continue:${execution.id}:retry:${nodeExecution.attemptNumber + 1}` });
    return;
  }

  if (retryPolicy.onFailure === "continue_to_failure_branch" && retryPolicy.failureBranchKey) {
    const edges = await getOutgoingEdges(db, execution.organizationId, node.id);
    const failureEdge = edges.find((e) => e.conditionKey === retryPolicy.failureBranchKey);
    if (failureEdge) {
      await transitionWorkflowExecutionStatus(db, execution.id, execution.organizationId, execution.revision, ["running", "waiting", "waiting_for_approval"], "running", { currentNodeId: failureEdge.targetNodeId });
      return;
    }
  }

  if (retryPolicy.onFailure === "pause_for_human") {
    await transitionWorkflowExecutionStatus(db, execution.id, execution.organizationId, execution.revision, ["running", "waiting", "waiting_for_approval"], "paused", { failureClassification: failure.failureClassification });
    await recordAuditEvent(db, { eventType: "workflow_execution_paused", organizationId: execution.organizationId, targetType: "workflow_execution", targetId: execution.id, metadata: { reason: "node_failure_pause_for_human", nodeId: node.id } });
    return;
  }

  const failed = await transitionWorkflowExecutionStatus(db, execution.id, execution.organizationId, execution.revision, ["running", "waiting", "waiting_for_approval"], "failed", { completedAt: new Date(), failureClassification: failure.failureClassification });
  if (failed) {
    await recordAuditEvent(db, { eventType: "workflow_execution_failed", organizationId: execution.organizationId, targetType: "workflow_execution", targetId: execution.id, metadata: { failureClassification: failure.failureClassification, nodeId: node.id, message: failure.message.slice(0, 300) } });
    await recordWorkflowEvent(db, { organizationId: execution.organizationId, workflowExecutionId: execution.id, eventType: "workflow_execution_failed", metadata: { failureClassification: failure.failureClassification } });
  }
}

async function determineNextNode(db: Db, organizationId: string, node: NodeRow, output: Record<string, unknown>): Promise<NodeRow | null> {
  const edges = await getOutgoingEdges(db, organizationId, node.id);
  if (edges.length === 0) return null;

  if (node.nodeType === "condition") {
    const selectedBranch = output.selectedBranch as string;
    const edge = edges.find((e) => e.conditionKey === selectedBranch);
    if (!edge) return null;
    return getNode(db, organizationId, edge.targetNodeId);
  }

  return getNode(db, organizationId, edges[0].targetNodeId);
}

// ---------------------------------------------------------------------------
// Re-entry after an async node resolves elsewhere (approval decided, human
// task completed, project task completed, agent execution finished, wait
// timestamp passed) — the `workflow_continue` job handler.
// ---------------------------------------------------------------------------

/**
 * The single entry point for `workflow_continue` jobs. Routes to whichever
 * of the two re-entry shapes actually applies: a fresh (`pending`) node
 * execution — created by a retry, or by `resumeWorkflowExecution` reopening
 * a paused workflow whose current node was never actually dispatched yet —
 * is re-driven from scratch via `driveWorkflowForward`; an already-`waiting`
 * node execution is checked for live resolution via `checkAndContinueWorkflow`.
 * This split is what makes a scheduled node-level retry safe: enqueuing
 * `workflow_continue` after creating a new attempt row always resumes
 * correctly, whether that attempt is synchronous or async.
 */
export async function continueWorkflowExecution(db: Db, rawSql: RawSql, input: { organizationId: string; workflowExecutionId: string }): Promise<void> {
  const execution = await resolveWorkflowExecutionById(db, input.organizationId, input.workflowExecutionId);
  if (["completed", "failed", "cancelled", "paused"].includes(execution.status)) return;

  if (!execution.currentNodeId) {
    await driveWorkflowForward(db, rawSql, input);
    return;
  }

  const node = await getNode(db, input.organizationId, execution.currentNodeId);
  const nodeExecution = await getActiveNodeExecution(db, execution.id, node.id);
  if (!nodeExecution || nodeExecution.status === "pending" || nodeExecution.status === "ready") {
    await driveWorkflowForward(db, rawSql, input);
    return;
  }

  await checkAndContinueWorkflow(db, rawSql, input);
}

async function checkAndContinueWorkflow(db: Db, rawSql: RawSql, input: { organizationId: string; workflowExecutionId: string }): Promise<{ progressed: boolean }> {
  const execution = await resolveWorkflowExecutionById(db, input.organizationId, input.workflowExecutionId);
  if (!["waiting", "waiting_for_approval", "running"].includes(execution.status)) return { progressed: false };
  if (!execution.currentNodeId) return { progressed: false };

  const node = await getNode(db, input.organizationId, execution.currentNodeId);
  const nodeExecution = await getActiveNodeExecution(db, execution.id, node.id);
  if (!nodeExecution || nodeExecution.status !== "waiting") return { progressed: false };

  const resolution = await resolveAsyncNodeState(db, input.organizationId, node, nodeExecution);
  if (!resolution) return { progressed: false };

  if (resolution.resolution !== "succeeded") {
    await handleNodeFailure(db, execution, node, nodeExecution, resolution.resolution === "failed" ? resolution : { failureClassification: "unexpected_wait", message: "an async node's resolution check unexpectedly returned a waiting state" });
    return { progressed: true };
  }

  await requireTransitionNodeExecution(db, { organizationId: input.organizationId, nodeExecutionId: nodeExecution.id, expectedRevision: nodeExecution.revision, fromStatuses: ["waiting"], toStatus: "succeeded", extra: { output: resolution.output, completedAt: new Date() } });
  await recordWorkflowEvent(db, { organizationId: input.organizationId, workflowExecutionId: execution.id, workflowNodeId: node.id, workflowNodeExecutionId: nodeExecution.id, eventType: "workflow_node_completed" });

  const advanced = await advanceAfterNodeSuccess(db, execution, node, nodeExecution, resolution.output);
  if (advanced) await driveWorkflowForward(db, rawSql, { organizationId: input.organizationId, workflowExecutionId: execution.id });
  return { progressed: true };
}

/** Checks whatever live resource this node's async work handed off to — never trusts a cached/local status; always the live source of truth. */
async function resolveAsyncNodeState(db: Db, organizationId: string, node: NodeRow, nodeExecution: WorkflowNodeExecution): Promise<NodeResolution | null> {
  switch (node.nodeType) {
    case "agent_execution": {
      if (!nodeExecution.runtimeExecutionId) return null;
      const rawConfig = node.configuration as Record<string, unknown>;
      const agentTaskType: AgentTaskType = typeof rawConfig.agentTaskType === "string" ? (rawConfig.agentTaskType as AgentTaskType) : "company_knowledge_report";
      const handler = resolveAgentTaskHandler(agentTaskType);
      if (!handler) return { resolution: "failed", failureClassification: "unsupported_agent_task_type", message: `no handler registered for agent task type "${agentTaskType}"` };

      const state = await handler.resolveState(db, { organizationId, runtimeExecutionId: nodeExecution.runtimeExecutionId });
      if (state.status === "pending") return null;
      if (state.status === "failed") return { resolution: "failed", failureClassification: state.failureClassification, message: state.message };

      const expectedOutputKey = typeof rawConfig.expectedOutputKey === "string" ? rawConfig.expectedOutputKey : undefined;
      const output = buildAgentTaskNodeOutput(state.evidence, expectedOutputKey);
      if (output === null) return { resolution: "failed", failureClassification: "invalid_agent_task_output", message: `expected output key "${expectedOutputKey}" was not present in the task result` };
      return { resolution: "succeeded", output };
    }
    case "approval": {
      if (!nodeExecution.approvalRequestId) return null;
      const { agentApprovalRequests } = await import("@/db/schema");
      const [row] = await db.select().from(agentApprovalRequests).where(and(eq(agentApprovalRequests.id, nodeExecution.approvalRequestId), eq(agentApprovalRequests.organizationId, organizationId)));
      if (!row) return null;
      if (row.status === "approved") return { resolution: "succeeded", output: { approvalStatus: row.status } };
      if (row.status === "rejected" || row.status === "expired" || row.status === "cancelled") return { resolution: "failed", failureClassification: `approval_${row.status}`, message: `approval ${row.status}` };
      return null; // pending or revision_requested — still waiting.
    }
    case "human_task": {
      const { workflowHumanTasks } = await import("@/db/schema");
      const [row] = await db.select().from(workflowHumanTasks).where(and(eq(workflowHumanTasks.workflowNodeExecutionId, nodeExecution.id), eq(workflowHumanTasks.organizationId, organizationId)));
      if (!row) return null;
      if (row.status === "completed") return { resolution: "succeeded", output: { outputData: row.outputData ?? {} } };
      if (row.status === "cancelled") return { resolution: "failed", failureClassification: "human_task_cancelled", message: "human task cancelled" };
      return null;
    }
    case "wait": {
      const config = node.configuration as { untilTimestamp?: string; durationSeconds?: number };
      const target = config.untilTimestamp ? new Date(config.untilTimestamp) : new Date(nodeExecution.createdAt.getTime() + (config.durationSeconds ?? 0) * 1000);
      if (Date.now() >= target.getTime()) return { resolution: "succeeded", output: { waitedUntil: target.toISOString() } };
      return null;
    }
    case "project_task": {
      if (!nodeExecution.projectTaskId) return null;
      const task = await resolveTaskById(db, organizationId, nodeExecution.projectTaskId).catch(() => null);
      if (!task) return null;
      if (task.status === "completed") return { resolution: "succeeded", output: { projectTaskId: task.id } };
      if (task.status === "cancelled") return { resolution: "failed", failureClassification: "project_task_cancelled", message: "linked project task was cancelled" };
      return null;
    }
    default:
      return null;
  }
}
