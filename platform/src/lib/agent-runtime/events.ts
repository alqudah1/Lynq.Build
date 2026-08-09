import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, lt, desc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { agentExecutionEvents } from "@/db/schema";
import { recordAuditEvent, type AuditEventType } from "@/lib/audit";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * §10: "every view below is a projection over one underlying append-only
 * Events stream." `agentExecutionEvents` IS that stream — the single
 * source `getExecutionTimeline` (this file) and Status/Progress
 * (`executions.ts`) project from. `audit_logs` (Module 2's platform-wide
 * mutation log) additionally receives the SAME event, for the specific
 * named types `MODULE_7_AGENT_RUNTIME_CORE.md` lists — the identical
 * "two distinct logs by design" split Brain Module 15 already established
 * (Lifecycle Events vs. Access Log): this table is the rich,
 * execution-scoped detail stream; `audit_logs` is the cross-module
 * security/activity log. Both are written together, from one call site,
 * so they can never drift apart from each other.
 */
export interface RecordExecutionEventInput {
  organizationId: string;
  executionId: string;
  eventType: AuditEventType;
  fromStatus?: string | null;
  toStatus?: string | null;
  actorUserId?: string | null;
  actorAgentId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function recordExecutionEvent(db: Db, input: RecordExecutionEventInput): Promise<void> {
  await db.insert(agentExecutionEvents).values({
    id: randomUUID(),
    organizationId: input.organizationId,
    executionId: input.executionId,
    eventType: input.eventType,
    fromStatus: (input.fromStatus ?? null) as never,
    toStatus: (input.toStatus ?? null) as never,
    actorUserId: input.actorUserId ?? null,
    actorAgentId: input.actorAgentId ?? null,
    metadata: input.metadata ?? null,
  });

  await recordAuditEvent(db, {
    eventType: input.eventType,
    organizationId: input.organizationId,
    actorUserId: input.actorUserId ?? null,
    actorAgentId: input.actorAgentId ?? null,
    targetType: "agent_execution",
    targetId: input.executionId,
    metadata: input.metadata ?? null,
  });
}

export interface ExecutionEvent {
  id: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorUserId: string | null;
  actorAgentId: string | null;
  metadata: unknown;
  createdAt: Date;
}

interface EventCursor {
  createdAt: string;
  id: string;
}

function encodeCursor(row: Pick<ExecutionEvent, "createdAt" | "id">): string {
  const payload: EventCursor = { createdAt: row.createdAt.toISOString(), id: row.id };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): EventCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof parsed?.createdAt === "string" && typeof parsed?.id === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

/** §10's "Execution Timeline — one task's ordered sequence of everything, from Assigned to Archived." Bounded, cursor-paginated, newest first. Tenant-safety and visibility are the caller's responsibility (`getExecution`'s own gate must already have resolved the execution before this is called). */
export async function getExecutionTimeline(
  db: Db,
  input: { organizationId: string; executionId: string; cursor?: string | null; limit?: number }
): Promise<{ events: ExecutionEvent[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const conditions = [eq(agentExecutionEvents.organizationId, input.organizationId), eq(agentExecutionEvents.executionId, input.executionId)];

  if (input.cursor) {
    const decoded = decodeCursor(input.cursor);
    if (decoded) {
      const cursorDate = new Date(decoded.createdAt);
      conditions.push(lt(agentExecutionEvents.createdAt, cursorDate));
    }
  }

  const rows = await db
    .select()
    .from(agentExecutionEvents)
    .where(and(...conditions))
    .orderBy(desc(agentExecutionEvents.createdAt), desc(agentExecutionEvents.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const nextCursor = hasMore ? encodeCursor(page[page.length - 1]) : null;

  return { events: page, nextCursor };
}
