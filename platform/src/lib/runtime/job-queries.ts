import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { runtimeJobs } from "@/db/schema";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export const ACTIVE_JOB_STATUSES = ["queued", "leased", "running", "retry_scheduled"] as const;

/** Shared by both reconciliation services — "no valid active work" is defined identically for executions and tool invocations: no job in a non-terminal state referencing this execution. */
export async function hasActiveJobForExecution(db: Db, executionId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: runtimeJobs.id })
    .from(runtimeJobs)
    .where(and(eq(runtimeJobs.executionId, executionId), inArray(runtimeJobs.status, [...ACTIVE_JOB_STATUSES])))
    .limit(1);
  return Boolean(row);
}
