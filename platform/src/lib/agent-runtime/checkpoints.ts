import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, desc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { agentCheckpoints } from "@/db/schema";
import { recordExecutionEvent } from "./events";
import { StaleCheckpointError } from "./errors";
import type { AgentExecutionStatus } from "./executions";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * §8: "every meaningful step is a durable checkpoint, written BEFORE any
 * side-effecting action proceeds." Append-only — no update/delete
 * function exists anywhere in this module, the identical "absence of a
 * mutating code path is the immutability guarantee" already established
 * for `knowledge_item_versions`/`access_log_entries`/`agent_checkpoints`'
 * own schema comment.
 */
export interface AgentCheckpoint {
  id: string;
  executionId: string;
  sequenceNumber: number;
  statusAtCheckpoint: AgentExecutionStatus;
  stepPosition: string | null;
  safeStateSummary: Record<string, unknown>;
  completedSideEffectRefs: string[];
  retryCountAtCheckpoint: number;
  createdAt: Date;
}

function toCheckpoint(row: typeof agentCheckpoints.$inferSelect): AgentCheckpoint {
  return {
    id: row.id,
    executionId: row.executionId,
    sequenceNumber: row.sequenceNumber,
    statusAtCheckpoint: row.statusAtCheckpoint,
    stepPosition: row.stepPosition,
    safeStateSummary: (row.safeStateSummary ?? {}) as Record<string, unknown>,
    completedSideEffectRefs: (row.completedSideEffectRefs ?? []) as string[],
    retryCountAtCheckpoint: row.retryCountAtCheckpoint,
    createdAt: row.createdAt,
  };
}

export interface CreateCheckpointInput {
  organizationId: string;
  executionId: string;
  statusAtCheckpoint: AgentExecutionStatus;
  stepPosition?: string | null;
  /** Bounded operational summary — NEVER raw chain-of-thought or unrestricted hidden reasoning (task's own explicit rule). Callers must keep this to concise, structured facts needed for recovery/audit. */
  safeStateSummary?: Record<string, unknown>;
  completedSideEffectRefs?: string[];
  retryCountAtCheckpoint?: number;
  actorUserId?: string | null;
  actorAgentId?: string | null;
}

/** The next `sequenceNumber` for this execution — a simple `MAX+1`, safe here because checkpoint creation itself is not the concurrency-sensitive path (execution status transitions are, via `transitionExecutionStatus`'s own atomic guard); two checkpoints racing for the same sequence number is caught by the table's own `agent_checkpoints_execution_sequence_unique` constraint as a final backstop. */
async function nextSequenceNumber(db: Db, executionId: string): Promise<number> {
  const [latest] = await db.select({ sequenceNumber: agentCheckpoints.sequenceNumber }).from(agentCheckpoints).where(eq(agentCheckpoints.executionId, executionId)).orderBy(desc(agentCheckpoints.sequenceNumber)).limit(1);
  return (latest?.sequenceNumber ?? 0) + 1;
}

export async function createCheckpoint(db: Db, input: CreateCheckpointInput): Promise<AgentCheckpoint> {
  const sequenceNumber = await nextSequenceNumber(db, input.executionId);
  const id = randomUUID();

  const [row] = await db
    .insert(agentCheckpoints)
    .values({
      id,
      organizationId: input.organizationId,
      executionId: input.executionId,
      sequenceNumber,
      statusAtCheckpoint: input.statusAtCheckpoint,
      stepPosition: input.stepPosition ?? null,
      safeStateSummary: input.safeStateSummary ?? {},
      completedSideEffectRefs: input.completedSideEffectRefs ?? [],
      retryCountAtCheckpoint: input.retryCountAtCheckpoint ?? 0,
    })
    .returning();

  await recordExecutionEvent(db, {
    organizationId: input.organizationId,
    executionId: input.executionId,
    eventType: "agent_checkpoint_created",
    actorUserId: input.actorUserId ?? null,
    actorAgentId: input.actorAgentId ?? null,
    metadata: { sequenceNumber, statusAtCheckpoint: input.statusAtCheckpoint, stepPosition: input.stepPosition ?? null },
  });

  return toCheckpoint(row);
}

export async function getLatestCheckpoint(db: Db, executionId: string): Promise<AgentCheckpoint | null> {
  const [row] = await db.select().from(agentCheckpoints).where(eq(agentCheckpoints.executionId, executionId)).orderBy(desc(agentCheckpoints.sequenceNumber)).limit(1);
  return row ? toCheckpoint(row) : null;
}

/**
 * §8's recovery procedure: load the latest checkpoint, and refuse to
 * resume from anything OLDER than the execution's own already-recorded
 * progress (§12: "stale checkpoint cannot overwrite newer progress") —
 * `minSequenceNumber` is the caller's own last-known checkpoint sequence;
 * a checkpoint numbered lower than that is rejected outright rather than
 * silently rewinding progress.
 */
export async function resolveResumeCheckpoint(db: Db, executionId: string, minSequenceNumber: number): Promise<AgentCheckpoint> {
  const latest = await getLatestCheckpoint(db, executionId);
  if (!latest || latest.sequenceNumber < minSequenceNumber) {
    throw new StaleCheckpointError();
  }
  return latest;
}

export async function listCheckpointsForExecution(db: Db, organizationId: string, executionId: string): Promise<AgentCheckpoint[]> {
  const rows = await db
    .select()
    .from(agentCheckpoints)
    .where(and(eq(agentCheckpoints.organizationId, organizationId), eq(agentCheckpoints.executionId, executionId)))
    .orderBy(desc(agentCheckpoints.sequenceNumber));
  return rows.map(toCheckpoint);
}
