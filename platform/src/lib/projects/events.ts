import "server-only";
import { desc, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { projectEvents } from "@/db/schema";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * The project timeline — user-facing operational history, deliberately
 * distinct from `audit_logs` (the security/compliance record). Bounded
 * metadata only: never a full task description or artifact content, the
 * same blanket redaction discipline `audit_logs` already follows.
 */
export interface ProjectEvent {
  id: string;
  projectId: string;
  eventType: string;
  actorUserId: string | null;
  actorAgentId: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

function toEvent(row: typeof projectEvents.$inferSelect): ProjectEvent {
  return {
    id: row.id,
    projectId: row.projectId,
    eventType: row.eventType,
    actorUserId: row.actorUserId,
    actorAgentId: row.actorAgentId,
    targetType: row.targetType,
    targetId: row.targetId,
    metadata: (row.metadata ?? null) as Record<string, unknown> | null,
    createdAt: row.createdAt,
  };
}

export interface RecordProjectEventInput {
  organizationId: string;
  projectId: string;
  eventType: string;
  actorUserId?: string | null;
  actorAgentId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function recordProjectEvent(db: Db, input: RecordProjectEventInput): Promise<void> {
  await db.insert(projectEvents).values({
    organizationId: input.organizationId,
    projectId: input.projectId,
    eventType: input.eventType,
    actorUserId: input.actorUserId ?? null,
    actorAgentId: input.actorAgentId ?? null,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    metadata: (input.metadata ?? null) as object | null,
  });
}

export async function listProjectEvents(db: Db, projectId: string, limit = 50): Promise<ProjectEvent[]> {
  const rows = await db.select().from(projectEvents).where(eq(projectEvents.projectId, projectId)).orderBy(desc(projectEvents.createdAt)).limit(limit);
  return rows.map(toEvent);
}
