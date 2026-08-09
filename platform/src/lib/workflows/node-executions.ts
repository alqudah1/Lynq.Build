import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, asc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { workflowNodeExecutions } from "@/db/schema";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { InvalidNodeExecutionTransitionError } from "./errors";
import type { WorkflowNodeExecutionStatus } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface WorkflowNodeExecution {
  id: string;
  organizationId: string;
  workflowExecutionId: string;
  workflowNodeId: string;
  status: WorkflowNodeExecutionStatus;
  attemptNumber: number;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  runtimeExecutionId: string | null;
  toolInvocationId: string | null;
  approvalRequestId: string | null;
  projectTaskId: string | null;
  artifactId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  failureClassification: string | null;
  revision: number;
  createdAt: Date;
}

function toNodeExecution(row: typeof workflowNodeExecutions.$inferSelect): WorkflowNodeExecution {
  return {
    id: row.id,
    organizationId: row.organizationId,
    workflowExecutionId: row.workflowExecutionId,
    workflowNodeId: row.workflowNodeId,
    status: row.status,
    attemptNumber: row.attemptNumber,
    input: row.input as Record<string, unknown> | null,
    output: row.output as Record<string, unknown> | null,
    runtimeExecutionId: row.runtimeExecutionId,
    toolInvocationId: row.toolInvocationId,
    approvalRequestId: row.approvalRequestId,
    projectTaskId: row.projectTaskId,
    artifactId: row.artifactId,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    failureClassification: row.failureClassification,
    revision: row.revision,
    createdAt: row.createdAt,
  };
}

export class NodeAlreadyActiveError extends Error {
  constructor() {
    super("This node already has an active (non-terminal) execution attempt");
    this.name = "NodeAlreadyActiveError";
  }
}

/** One row per attempt — "one logical node execution must not run twice" is enforced by the partial `workflow_node_executions_active_unique` index (at most one non-terminal attempt per node per execution), never merely an application check. */
export async function createNodeExecution(db: Db, input: { organizationId: string; workflowExecutionId: string; workflowNodeId: string; attemptNumber: number; input?: Record<string, unknown> | null }): Promise<WorkflowNodeExecution> {
  try {
    const [row] = await db
      .insert(workflowNodeExecutions)
      .values({
        id: randomUUID(),
        organizationId: input.organizationId,
        workflowExecutionId: input.workflowExecutionId,
        workflowNodeId: input.workflowNodeId,
        attemptNumber: input.attemptNumber,
        input: (input.input ?? null) as object | null,
      })
      .returning();
    return toNodeExecution(row);
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new NodeAlreadyActiveError();
    throw err;
  }
}

export async function getNodeExecutionById(db: Db, organizationId: string, id: string): Promise<WorkflowNodeExecution | null> {
  const [row] = await db.select().from(workflowNodeExecutions).where(and(eq(workflowNodeExecutions.id, id), eq(workflowNodeExecutions.organizationId, organizationId)));
  return row ? toNodeExecution(row) : null;
}

const ACTIVE_NODE_STATUSES: WorkflowNodeExecutionStatus[] = ["pending", "ready", "running", "waiting"];

export async function getActiveNodeExecution(db: Db, workflowExecutionId: string, workflowNodeId: string): Promise<WorkflowNodeExecution | null> {
  const [row] = await db
    .select()
    .from(workflowNodeExecutions)
    .where(and(eq(workflowNodeExecutions.workflowExecutionId, workflowExecutionId), eq(workflowNodeExecutions.workflowNodeId, workflowNodeId), inArray(workflowNodeExecutions.status, ACTIVE_NODE_STATUSES)));
  return row ? toNodeExecution(row) : null;
}

export async function listNodeExecutionsForExecution(db: Db, workflowExecutionId: string): Promise<WorkflowNodeExecution[]> {
  const rows = await db.select().from(workflowNodeExecutions).where(eq(workflowNodeExecutions.workflowExecutionId, workflowExecutionId)).orderBy(asc(workflowNodeExecutions.createdAt));
  return rows.map(toNodeExecution);
}

export interface TransitionNodeExecutionInput {
  organizationId: string;
  nodeExecutionId: string;
  expectedRevision: number;
  fromStatuses: WorkflowNodeExecutionStatus[];
  toStatus: WorkflowNodeExecutionStatus;
  extra?: Record<string, unknown>;
}

/** The shared atomic engine behind every node-execution transition — one `UPDATE ... WHERE status IN (fromStatuses) AND revision = expected`, mirroring Agent Runtime Core's own `transitionExecutionStatus`. Returns `null` (never throws) on zero rows — a stale revision and an illegal transition are indistinguishable, exactly like that precedent. */
export async function transitionNodeExecution(db: Db, input: TransitionNodeExecutionInput): Promise<WorkflowNodeExecution | null> {
  const [row] = await db
    .update(workflowNodeExecutions)
    .set({ status: input.toStatus, revision: input.expectedRevision + 1, updatedAt: new Date(), ...(input.extra ?? {}) })
    .where(and(eq(workflowNodeExecutions.id, input.nodeExecutionId), eq(workflowNodeExecutions.organizationId, input.organizationId), eq(workflowNodeExecutions.revision, input.expectedRevision), inArray(workflowNodeExecutions.status, input.fromStatuses)))
    .returning();
  return row ? toNodeExecution(row) : null;
}

export async function requireTransitionNodeExecution(db: Db, input: TransitionNodeExecutionInput): Promise<WorkflowNodeExecution> {
  const updated = await transitionNodeExecution(db, input);
  if (!updated) throw new InvalidNodeExecutionTransitionError(input.fromStatuses.join("|"), input.toStatus);
  return updated;
}
