import { z } from "zod";
import { JOB_FAILURE_CLASSES } from "@/lib/runtime/validation";
import { AGENT_TASK_TYPES } from "@/lib/agent-runtime/task-types";

export const WORKFLOW_DEFINITION_STATUSES = ["draft", "published", "paused", "archived"] as const;
export const workflowDefinitionStatusSchema = z.enum(WORKFLOW_DEFINITION_STATUSES);
export type WorkflowDefinitionStatus = (typeof WORKFLOW_DEFINITION_STATUSES)[number];

export const WORKFLOW_VERSION_STATUSES = ["draft", "valid", "published", "superseded", "rejected"] as const;
export const workflowVersionStatusSchema = z.enum(WORKFLOW_VERSION_STATUSES);
export type WorkflowVersionStatus = (typeof WORKFLOW_VERSION_STATUSES)[number];

export const WORKFLOW_NODE_TYPES = ["start", "end", "agent_execution", "tool_invocation", "human_task", "approval", "condition", "wait", "project_task", "artifact_transform"] as const;
export const workflowNodeTypeSchema = z.enum(WORKFLOW_NODE_TYPES);
export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number];

export const WORKFLOW_EXECUTION_STATUSES = ["queued", "running", "waiting", "waiting_for_approval", "paused", "completed", "failed", "cancelled"] as const;
export const workflowExecutionStatusSchema = z.enum(WORKFLOW_EXECUTION_STATUSES);
export type WorkflowExecutionStatus = (typeof WORKFLOW_EXECUTION_STATUSES)[number];

export const WORKFLOW_NODE_EXECUTION_STATUSES = ["pending", "ready", "running", "waiting", "succeeded", "failed", "skipped", "cancelled"] as const;
export const workflowNodeExecutionStatusSchema = z.enum(WORKFLOW_NODE_EXECUTION_STATUSES);
export type WorkflowNodeExecutionStatus = (typeof WORKFLOW_NODE_EXECUTION_STATUSES)[number];

export const WORKFLOW_HUMAN_TASK_STATUSES = ["pending", "completed", "cancelled"] as const;
export const workflowHumanTaskStatusSchema = z.enum(WORKFLOW_HUMAN_TASK_STATUSES);
export type WorkflowHumanTaskStatus = (typeof WORKFLOW_HUMAN_TASK_STATUSES)[number];

export const workflowKeySchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[A-Z][A-Z0-9_]*$/, "must be uppercase letters/digits/underscores, starting with a letter (e.g. KNOWLEDGE_REPORT)");
export const workflowNameSchema = z.string().trim().min(1).max(200);
export const workflowDescriptionSchema = z.string().trim().max(5000).optional();
export const nodeKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[a-z][a-z0-9_]*$/, "must be lowercase letters/digits/underscores, starting with a letter (e.g. draft_report)");

// ---------------------------------------------------------------------------
// Data mapping — bounded, safe path lookups only. No arbitrary code, no
// dynamic SQL, no shell expressions, no template evaluation, no secret
// interpolation from user input. See `mapping.ts` for the resolver.
// ---------------------------------------------------------------------------

const jsonPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z_][a-zA-Z0-9_.]*$/, "must be a plain dot-path (e.g. report.title) — no expressions");

export const mappingSourceSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("workflow_input"), path: jsonPathSchema }),
  z.object({ source: z.literal("node_output"), nodeKey: nodeKeySchema, path: jsonPathSchema }),
  z.object({ source: z.literal("literal"), value: z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string()).max(20)]) }),
  z.object({ source: z.literal("context"), field: z.enum(["organizationId", "workspaceId", "initiatorUserId"]) }),
]);
export type MappingSource = z.infer<typeof mappingSourceSchema>;

/** Every key a node reads is bounded to at most this many mapped fields — keeps mapping objects small and reviewable, never a vehicle for smuggling large payloads. */
export const nodeMappingSchema = z.record(z.string().trim().min(1).max(100), mappingSourceSchema).refine((m) => Object.keys(m).length <= 20, "at most 20 mapped fields per node");

// ---------------------------------------------------------------------------
// Retry / timeout policy — bounded on every axis, never unbounded.
// ---------------------------------------------------------------------------

export const WORKFLOW_FAILURE_POLICIES = ["fail_workflow", "pause_for_human", "retry", "continue_to_failure_branch"] as const;
export const workflowFailurePolicySchema = z.enum(WORKFLOW_FAILURE_POLICIES);
export type WorkflowFailurePolicy = (typeof WORKFLOW_FAILURE_POLICIES)[number];

export const retryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(10).default(1),
  backoffSeconds: z.number().int().min(0).max(3600).default(0),
  retryableFailureClasses: z.array(z.enum(JOB_FAILURE_CLASSES)).default([]),
  onFailure: workflowFailurePolicySchema.default("fail_workflow"),
  failureBranchKey: z.string().trim().min(1).max(60).optional(),
});
export type RetryPolicy = z.infer<typeof retryPolicySchema>;

export const timeoutPolicySchema = z.object({
  timeoutSeconds: z.number().int().min(1).max(86400).default(3600),
});
export type TimeoutPolicy = z.infer<typeof timeoutPolicySchema>;

// ---------------------------------------------------------------------------
// Node configuration — one schema per node type, validated at publish time
// and re-validated at execution time. No arbitrary code, no user-supplied
// JavaScript/SQL/shell/expressions anywhere in any of these shapes.
// ---------------------------------------------------------------------------

export const startNodeConfigSchema = z.object({}).strict();

export const endNodeConfigSchema = z.object({ requiredOutputs: z.array(z.string().trim().min(1).max(100)).max(20).default([]) }).strict();

/**
 * Module 14 — generic shape: `agentId` + a registered `agentTaskType`, plus
 * an optional `expectedOutputKey` naming which key of the resolved task's
 * bounded structured output this node's own output must contain (fails the
 * node deterministically if absent). The actual field-level input mapping
 * for the task uses the SAME `node.inputMapping` mechanism every other node
 * type already uses (see `mapping.ts`/`resolveMapping`), never a second,
 * duplicate mapping object inside `configuration`.
 *
 * Historically published nodes may still carry the pre-Module-14 shape
 * (`{agentId, topic, allowedDomains, maxResults?}`, no `agentTaskType`) —
 * this schema is never re-applied to already-published rows (node
 * configuration is validated at draft-create/update and at publish time
 * only, never re-validated at execution time), so those rows remain valid
 * and executable exactly as published. The Workflow Engine's own
 * `agent_execution` executor detects and resolves that legacy shape to
 * `company_knowledge_report` at execution time — see `engine.ts`.
 */
export const agentExecutionNodeConfigSchema = z
  .object({
    agentId: z.string().uuid(),
    agentTaskType: z.enum(AGENT_TASK_TYPES),
    expectedOutputKey: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export const toolInvocationNodeConfigSchema = z
  .object({
    agentId: z.string().uuid(),
    toolKey: z.string().trim().min(1).max(100),
  })
  .strict();

export const humanTaskNodeConfigSchema = z
  .object({
    assignedUserId: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    instructions: z.string().trim().max(2000).optional(),
    dueInHours: z.number().int().min(1).max(24 * 90).optional(),
  })
  .strict();

export const APPROVAL_RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export const approvalNodeConfigSchema = z
  .object({
    agentId: z.string().uuid(),
    requestedAction: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(1000),
    riskLevel: z.enum(APPROVAL_RISK_LEVELS),
    expiresInHours: z.number().int().min(1).max(24 * 30).optional(),
  })
  .strict();

export const CONDITION_OPERATORS = ["equals", "not_equals", "exists", "not_exists", "greater_than", "less_than", "contains", "in", "status_is", "approved", "rejected"] as const;
export const conditionOperatorSchema = z.enum(CONDITION_OPERATORS);
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

const literalValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.union([z.string(), z.number()]))]);

export const conditionBranchSchema = z.object({
  branchKey: z.string().trim().min(1).max(60),
  operator: conditionOperatorSchema,
  left: mappingSourceSchema,
  right: literalValueSchema.optional(),
});

export const conditionNodeConfigSchema = z
  .object({
    branches: z.array(conditionBranchSchema).min(1).max(20),
    defaultBranchKey: z.string().trim().min(1).max(60).optional(),
  })
  .strict();

export const waitNodeConfigSchema = z
  .object({
    untilTimestamp: z.string().datetime().optional(),
    durationSeconds: z.number().int().min(1).max(30 * 24 * 3600).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.untilTimestamp) !== Boolean(v.durationSeconds), "exactly one of untilTimestamp or durationSeconds must be set");

export const projectTaskNodeConfigSchema = z
  .object({
    createNew: z.boolean().default(true),
    title: z.string().trim().min(1).max(300).optional(),
    description: z.string().trim().max(5000).optional(),
    phaseId: z.string().uuid().optional(),
    milestoneId: z.string().uuid().optional(),
  })
  .strict()
  .refine((v) => !v.createNew || Boolean(v.title), "title is required when createNew is true");

export const artifactTransformNodeConfigSchema = z
  .object({
    agentId: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    sourceOutputKeys: z.array(z.string().trim().min(1).max(100)).min(1).max(10),
  })
  .strict();

export function nodeConfigSchemaFor(nodeType: WorkflowNodeType) {
  switch (nodeType) {
    case "start":
      return startNodeConfigSchema;
    case "end":
      return endNodeConfigSchema;
    case "agent_execution":
      return agentExecutionNodeConfigSchema;
    case "tool_invocation":
      return toolInvocationNodeConfigSchema;
    case "human_task":
      return humanTaskNodeConfigSchema;
    case "approval":
      return approvalNodeConfigSchema;
    case "condition":
      return conditionNodeConfigSchema;
    case "wait":
      return waitNodeConfigSchema;
    case "project_task":
      return projectTaskNodeConfigSchema;
    case "artifact_transform":
      return artifactTransformNodeConfigSchema;
  }
}
