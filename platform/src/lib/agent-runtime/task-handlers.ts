import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { agentExecutions } from "@/db/schema";
import type { Agent } from "@/lib/agents/agents";
import { listArtifactsForExecution } from "@/lib/agent-runtime/artifacts";
import { DomainRuleViolationError } from "@/lib/authz/errors";
import { AGENT_TASK_TYPES, isAgentTaskType, type AgentTaskType } from "./task-types";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Generic agent task contract — Module 14
 * ============================================================================
 * The bounded interface every workflow `agent_execution` node launches
 * through, and the in-code typed registry that resolves which handler
 * applies. Deliberately NOT an executable-prompt system: a task type is a
 * fixed string from `AGENT_TASK_TYPES` (`./task-types`), resolved through a
 * static `Map` populated by each handler's own module at import time —
 * never a free-text name, never a dynamic `require`/`import` driven by
 * workflow configuration, never arbitrary JS passed through from a node's
 * config. Adding a new task type means writing a new handler and
 * registering it in code, reviewed like any other change — not a
 * data-driven capability.
 */
export { AGENT_TASK_TYPES, isAgentTaskType, type AgentTaskType };

export class UnsupportedAgentTaskTypeError extends DomainRuleViolationError {
  readonly reason = "unsupported_agent_task_type";
  constructor(taskType: string) {
    super(`No registered handler for agent task type "${taskType}"`);
    this.name = "UnsupportedAgentTaskTypeError";
  }
}

export class AgentTaskEligibilityError extends DomainRuleViolationError {
  readonly reason = "agent_task_ineligible";
  constructor(taskType: string, agentId: string) {
    super(`Agent ${agentId} is not eligible to run agent task type "${taskType}"`);
    this.name = "AgentTaskEligibilityError";
  }
}

export class InvalidAgentTaskInputError extends DomainRuleViolationError {
  readonly reason = "invalid_agent_task_input";
  constructor(taskType: string, detail: string) {
    super(`Invalid input for agent task type "${taskType}": ${detail}`);
    this.name = "InvalidAgentTaskInputError";
  }
}

export interface AgentTaskLaunchInput {
  organizationId: string;
  workspaceId: string | null;
  agentId: string;
  actorUserId: string;
  /** Bounded, mapped input for this task type — resolved through the workflow node's own input mapping, never raw workflow config passed straight through as instructions. */
  taskInput: Record<string, unknown>;
}

export interface AgentTaskCompletionEvidence {
  runtimeExecutionId: string;
  taskType: AgentTaskType;
  status: "succeeded";
  primaryArtifactId: string | null;
  artifactIds: string[];
  /** A small, bounded, schema-shaped summary — references only, never raw reasoning or full artifact content. */
  structuredOutput: Record<string, unknown>;
  completedAt: Date;
}

export type AgentTaskState = { status: "pending" } | { status: "succeeded"; evidence: AgentTaskCompletionEvidence } | { status: "failed"; failureClassification: string; message: string };

export interface AgentTaskHandler {
  taskType: AgentTaskType;
  /** The one agent identity this task type is currently bound to — "prefer static config over a new table" (Module 14 spec); not a general multi-agent-per-task-type marketplace. */
  expectedAgentName: string;
  isAgentEligible(agent: Agent): boolean;
  /** Starts the underlying work through the real Agent Runtime and returns immediately with the linked execution id — never completes the node itself, and never marks completion on its own authority. */
  launch(db: Db, input: AgentTaskLaunchInput): Promise<{ runtimeExecutionId: string }>;
  /** Live-checks the linked Runtime execution's own current state — never a cached/local status. */
  resolveState(db: Db, input: { organizationId: string; runtimeExecutionId: string }): Promise<AgentTaskState>;
}

const registry = new Map<AgentTaskType, AgentTaskHandler>();

export function registerAgentTaskHandler(handler: AgentTaskHandler): void {
  registry.set(handler.taskType, handler);
}

export function resolveAgentTaskHandler(taskType: string): AgentTaskHandler | null {
  if (!isAgentTaskType(taskType)) return null;
  return registry.get(taskType) ?? null;
}

/**
 * The one shared "read the linked execution + its report artifact" live
 * check. Every current handler's completion shape is identical (one
 * `report` artifact per task), so this is reused rather than duplicated
 * across handler files — it is NOT part of the handler contract itself,
 * and a future handler with a different completion shape is free not to
 * use it.
 */
export async function resolveReportArtifactTaskState(db: Db, taskType: AgentTaskType, input: { organizationId: string; runtimeExecutionId: string }): Promise<AgentTaskState> {
  const [row] = await db.select().from(agentExecutions).where(and(eq(agentExecutions.id, input.runtimeExecutionId), eq(agentExecutions.organizationId, input.organizationId)));
  if (!row) return { status: "pending" };

  if (row.status === "completed") {
    const artifacts = await listArtifactsForExecution(db, input.organizationId, row.id);
    const report = artifacts.filter((a) => a.artifactType === "report").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return {
      status: "succeeded",
      evidence: {
        runtimeExecutionId: row.id,
        taskType,
        status: "succeeded",
        primaryArtifactId: report?.id ?? null,
        artifactIds: report ? [report.id] : [],
        structuredOutput: { reportArtifactId: report?.id ?? null },
        completedAt: row.completedAt ?? new Date(),
      },
    };
  }
  if (row.status === "failed" || row.status === "cancelled") {
    return { status: "failed", failureClassification: row.status === "cancelled" ? "cancelled" : "runtime_execution_failed", message: `linked agent execution ${row.status}` };
  }
  return { status: "pending" };
}
