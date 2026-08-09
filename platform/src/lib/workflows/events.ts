import "server-only";
import { randomUUID } from "node:crypto";
import { eq, desc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { workflowExecutionEvents } from "@/db/schema";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface WorkflowExecutionEvent {
  id: string;
  workflowExecutionId: string;
  eventType: string;
  workflowNodeId: string | null;
  workflowNodeExecutionId: string | null;
  actorUserId: string | null;
  actorAgentId: string | null;
  metadata: unknown;
  createdAt: Date;
}

function toEvent(row: typeof workflowExecutionEvents.$inferSelect): WorkflowExecutionEvent {
  return {
    id: row.id,
    workflowExecutionId: row.workflowExecutionId,
    eventType: row.eventType,
    workflowNodeId: row.workflowNodeId,
    workflowNodeExecutionId: row.workflowNodeExecutionId,
    actorUserId: row.actorUserId,
    actorAgentId: row.actorAgentId,
    metadata: row.metadata,
    createdAt: row.createdAt,
  };
}

export interface RecordWorkflowEventInput {
  organizationId: string;
  workflowExecutionId: string;
  eventType: string;
  workflowNodeId?: string | null;
  workflowNodeExecutionId?: string | null;
  actorUserId?: string | null;
  actorAgentId?: string | null;
  metadata?: Record<string, unknown>;
}

/** User-facing operational timeline — structurally distinct from `audit_logs`, mirroring Projects Core's own `project_events` split. Bounded metadata only, never full inputs/outputs/artifact content. */
export async function recordWorkflowEvent(db: Db, input: RecordWorkflowEventInput): Promise<void> {
  await db.insert(workflowExecutionEvents).values({
    id: randomUUID(),
    organizationId: input.organizationId,
    workflowExecutionId: input.workflowExecutionId,
    eventType: input.eventType,
    workflowNodeId: input.workflowNodeId ?? null,
    workflowNodeExecutionId: input.workflowNodeExecutionId ?? null,
    actorUserId: input.actorUserId ?? null,
    actorAgentId: input.actorAgentId ?? null,
    metadata: (input.metadata ?? null) as object | null,
  });
}

export async function listWorkflowEvents(db: Db, workflowExecutionId: string, limit = 100): Promise<WorkflowExecutionEvent[]> {
  const rows = await db.select().from(workflowExecutionEvents).where(eq(workflowExecutionEvents.workflowExecutionId, workflowExecutionId)).orderBy(desc(workflowExecutionEvents.createdAt)).limit(limit);
  return rows.map(toEvent);
}
