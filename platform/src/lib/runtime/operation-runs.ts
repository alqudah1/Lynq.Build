import "server-only";
import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { runtimeOperationRuns } from "@/db/schema";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export type RuntimeOperationRun = typeof runtimeOperationRuns.$inferSelect;

/** One shared observability record for every reconciliation pass and cleanup run — "records examined, records affected, duration, success/failure" (task's own required shape), never a bespoke table per operation type. */
export async function startOperationRun(db: Db, operationType: string): Promise<RuntimeOperationRun> {
  const [row] = await db.insert(runtimeOperationRuns).values({ id: randomUUID(), operationType, startedAt: new Date() }).returning();
  return row;
}

export async function finishOperationRun(
  db: Db,
  runId: string,
  input: { recordsExamined: number; recordsAffected: number; succeeded: boolean; outcomeSummary?: unknown; errorMessage?: string }
): Promise<RuntimeOperationRun> {
  const [row] = await db
    .update(runtimeOperationRuns)
    .set({
      completedAt: new Date(),
      recordsExamined: input.recordsExamined,
      recordsAffected: input.recordsAffected,
      succeeded: input.succeeded,
      outcomeSummary: (input.outcomeSummary ?? null) as object | null,
      errorMessage: input.errorMessage ? input.errorMessage.slice(0, 1000) : null,
    })
    .where(eq(runtimeOperationRuns.id, runId))
    .returning();

  return row;
}

export async function listRecentOperationRuns(db: Db, input: { operationType?: string; limit?: number } = {}): Promise<RuntimeOperationRun[]> {
  const rows = await db
    .select()
    .from(runtimeOperationRuns)
    .where(input.operationType ? eq(runtimeOperationRuns.operationType, input.operationType) : undefined)
    .orderBy(desc(runtimeOperationRuns.startedAt))
    .limit(input.limit ?? 20);
  return rows;
}
