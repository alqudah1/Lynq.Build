import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lt, or, desc, type SQL } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { agentExecutions } from "@/db/schema";
import { requireTenantScopedResource } from "@/lib/authz/helpers";
import type { KnowledgeDomain } from "@/lib/brain/knowledge-items";
import { requireExecutionVisibility } from "./authz";
import { recordExecutionEvent } from "./events";
import type { ExecutionContextSnapshot } from "./context";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export type AgentExecutionStatus =
  | "queued"
  | "assigned"
  | "gathering_context"
  | "planning"
  | "reasoning"
  | "waiting"
  | "executing"
  | "delegating"
  | "human_approval"
  | "verifying"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "archived";

export interface AgentExecution {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  initiatingUserId: string | null;
  ownerUserId: string;
  assignedAgentId: string | null;
  assignedAgentVersionNumber: number | null;
  parentExecutionId: string | null;
  rootExecutionId: string;
  delegationDepth: number;
  goal: string;
  successCriteria: string;
  failureCriteria: string;
  priority: number;
  deadline: Date | null;
  status: AgentExecutionStatus;
  waitReason: string | null;
  domainsRequested: KnowledgeDomain[];
  contextSnapshot: ExecutionContextSnapshot | null;
  currentPlanId: string | null;
  retryCount: number;
  maxRetries: number;
  revision: number;
  startedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  cancelledAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toExecution(row: typeof agentExecutions.$inferSelect): AgentExecution {
  return {
    id: row.id,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    initiatingUserId: row.initiatingUserId,
    ownerUserId: row.ownerUserId,
    assignedAgentId: row.assignedAgentId,
    assignedAgentVersionNumber: row.assignedAgentVersionNumber,
    parentExecutionId: row.parentExecutionId,
    rootExecutionId: row.rootExecutionId,
    delegationDepth: row.delegationDepth,
    goal: row.goal,
    successCriteria: row.successCriteria,
    failureCriteria: row.failureCriteria,
    priority: row.priority,
    deadline: row.deadline,
    status: row.status,
    waitReason: row.waitReason,
    domainsRequested: (row.domainsRequested ?? []) as KnowledgeDomain[],
    contextSnapshot: row.contextSnapshot as ExecutionContextSnapshot | null,
    currentPlanId: row.currentPlanId,
    retryCount: row.retryCount,
    maxRetries: row.maxRetries,
    revision: row.revision,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    failedAt: row.failedAt,
    cancelledAt: row.cancelledAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface CreateExecutionInput {
  organizationId: string;
  workspaceId?: string | null;
  ownerUserId: string;
  goal: string;
  successCriteria: string;
  failureCriteria: string;
  domainsRequested: KnowledgeDomain[];
  priority?: number;
  deadline?: Date | null;
  maxRetries?: number;
  actorUserId: string;
}

/**
 * §2's Task creation. Always a ROOT execution — `parentExecutionId` null,
 * `rootExecutionId` set to its own freshly-generated id (pre-generated
 * client-side, this codebase's established `randomUUID()`-before-insert
 * pattern, so a self-referencing composite FK is satisfiable in one
 * INSERT), `delegationDepth` 0. Subtasks/delegation children are created
 * by `plans.ts`/`delegation.ts`, never here.
 */
export async function createExecution(db: Db, input: CreateExecutionInput): Promise<AgentExecution> {
  const workspaceId = input.workspaceId ?? null;
  await requireExecutionVisibility(db, { organizationId: input.organizationId, workspaceId, actorUserId: input.actorUserId });

  const id = randomUUID();
  const now = new Date();

  const [row] = await db
    .insert(agentExecutions)
    .values({
      id,
      organizationId: input.organizationId,
      workspaceId,
      initiatingUserId: input.actorUserId,
      ownerUserId: input.ownerUserId,
      parentExecutionId: null,
      rootExecutionId: id,
      delegationDepth: 0,
      goal: input.goal,
      successCriteria: input.successCriteria,
      failureCriteria: input.failureCriteria,
      priority: input.priority ?? 0,
      deadline: input.deadline ?? null,
      status: "queued",
      domainsRequested: input.domainsRequested,
      maxRetries: input.maxRetries ?? 3,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await recordExecutionEvent(db, {
    organizationId: input.organizationId,
    executionId: id,
    eventType: "agent_execution_created",
    toStatus: "queued",
    actorUserId: input.actorUserId,
    metadata: { workspaceScoped: Boolean(workspaceId), domainsRequested: input.domainsRequested },
  });

  return toExecution(row);
}

export interface GetExecutionInput {
  organizationId: string;
  executionId: string;
  actorUserId: string;
}

export async function getExecutionForUser(db: Db, input: GetExecutionInput): Promise<AgentExecution> {
  const row = await requireTenantScopedResource(async () => {
    const [found] = await db.select().from(agentExecutions).where(and(eq(agentExecutions.id, input.executionId), eq(agentExecutions.organizationId, input.organizationId)));
    return found;
  });

  await requireExecutionVisibility(db, { organizationId: input.organizationId, workspaceId: row.workspaceId, actorUserId: input.actorUserId });

  return toExecution(row);
}

/** Internal, unauthorized resolve — for use by other runtime services that have already established their own authority (e.g. `lifecycle.ts` transitions, which gate via `requireExecutionManageAuthority`/`requireAssignedAgent` themselves). */
export async function resolveExecutionById(db: Db, organizationId: string, executionId: string): Promise<AgentExecution> {
  const row = await requireTenantScopedResource(async () => {
    const [found] = await db.select().from(agentExecutions).where(and(eq(agentExecutions.id, executionId), eq(agentExecutions.organizationId, organizationId)));
    return found;
  });
  return toExecution(row);
}

export interface ListExecutionsInput {
  organizationId: string;
  workspaceId?: string | null;
  status?: AgentExecutionStatus;
  assignedAgentId?: string;
  parentExecutionId?: string | null;
  cursor?: string | null;
  limit?: number;
  actorUserId: string;
}

interface ExecutionCursor {
  createdAt: string;
  id: string;
}

function encodeCursor(row: Pick<AgentExecution, "createdAt" | "id">): string {
  const payload: ExecutionCursor = { createdAt: row.createdAt.toISOString(), id: row.id };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): ExecutionCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof parsed?.createdAt === "string" && typeof parsed?.id === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

export async function listExecutionsForUser(db: Db, input: ListExecutionsInput): Promise<{ executions: AgentExecution[]; nextCursor: string | null }> {
  await requireExecutionVisibility(db, { organizationId: input.organizationId, workspaceId: input.workspaceId ?? null, actorUserId: input.actorUserId });

  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const conditions: SQL[] = [eq(agentExecutions.organizationId, input.organizationId)];
  if (input.workspaceId !== undefined) {
    conditions.push(input.workspaceId === null ? isNull(agentExecutions.workspaceId) : eq(agentExecutions.workspaceId, input.workspaceId));
  }
  if (input.status) conditions.push(eq(agentExecutions.status, input.status));
  if (input.assignedAgentId) conditions.push(eq(agentExecutions.assignedAgentId, input.assignedAgentId));
  if (input.parentExecutionId !== undefined) {
    conditions.push(input.parentExecutionId === null ? isNull(agentExecutions.parentExecutionId) : eq(agentExecutions.parentExecutionId, input.parentExecutionId));
  }

  if (input.cursor) {
    const decoded = decodeCursor(input.cursor);
    if (decoded) {
      const cursorDate = new Date(decoded.createdAt);
      const cursorCondition = or(lt(agentExecutions.createdAt, cursorDate), and(eq(agentExecutions.createdAt, cursorDate), lt(agentExecutions.id, decoded.id)));
      if (cursorCondition) conditions.push(cursorCondition);
    }
  }

  const rows = await db
    .select()
    .from(agentExecutions)
    .where(and(...conditions))
    .orderBy(desc(agentExecutions.createdAt), desc(agentExecutions.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).map(toExecution);
  const nextCursor = hasMore ? encodeCursor(page[page.length - 1]) : null;

  return { executions: page, nextCursor };
}

export interface TransitionExecutionInput {
  executionId: string;
  organizationId: string;
  expectedRevision: number;
  fromStatuses: AgentExecutionStatus[];
  toStatus: AgentExecutionStatus;
  extraSet?: Partial<typeof agentExecutions.$inferInsert>;
}

/**
 * The shared atomic engine behind EVERY state transition in this module —
 * one `UPDATE ... WHERE status IN (fromStatuses) AND revision = expected
 * RETURNING *` statement, bumping `revision`. Returns `null` (never
 * throws) on zero rows affected, covering both races this codebase's own
 * established pattern always collapses into one outcome: a stale
 * `expectedRevision` (lost a concurrent race) and an illegal transition
 * (the execution's real current status isn't in `fromStatuses`) are
 * indistinguishable to the caller — both mean "re-fetch and decide,"
 * exactly like `approveKnowledgeItem`'s own atomic conditional UPDATE.
 * This single primitive is what makes "two workers cannot claim one
 * execution" / "no double transition" / "no double completion" true
 * structurally, not by convention — see `lifecycle.ts`'s own concurrency
 * tests.
 */
export async function transitionExecutionStatus(db: Db, input: TransitionExecutionInput): Promise<AgentExecution | null> {
  const [row] = await db
    .update(agentExecutions)
    .set({ status: input.toStatus, revision: input.expectedRevision + 1, updatedAt: new Date(), ...(input.extraSet ?? {}) })
    .where(
      and(
        eq(agentExecutions.id, input.executionId),
        eq(agentExecutions.organizationId, input.organizationId),
        eq(agentExecutions.revision, input.expectedRevision),
        inArray(agentExecutions.status, input.fromStatuses)
      )
    )
    .returning();

  return row ? toExecution(row) : null;
}
