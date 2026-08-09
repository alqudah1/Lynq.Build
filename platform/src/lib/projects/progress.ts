import "server-only";
import { and, eq, ne } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { projectTasks } from "@/db/schema";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * Deterministic, never user-entered — this module provides no field for
 * a human to type a fake completion percentage. `percentage` is `null`
 * (not `0`) when there are no eligible tasks yet, so "nothing to do" is
 * never visually indistinguishable from "0% done with real work
 * pending." Cancelled tasks are excluded from BOTH the numerator and the
 * denominator — they never count as completed work, and they never drag
 * the denominator down either (a cancelled task was never "eligible"
 * work to begin with).
 */
export interface ProgressResult {
  completedCount: number;
  eligibleCount: number;
  percentage: number | null;
}

function computeProgress(completedCount: number, eligibleCount: number): ProgressResult {
  return { completedCount, eligibleCount, percentage: eligibleCount === 0 ? null : Math.round((completedCount / eligibleCount) * 100) };
}

/** Project progress = completed non-cancelled tasks (at every depth, including subtasks) / eligible (non-cancelled) tasks in the project. */
export async function calculateProjectProgress(db: Db, organizationId: string, projectId: string): Promise<ProgressResult> {
  const rows = await db
    .select({ status: projectTasks.status })
    .from(projectTasks)
    .where(and(eq(projectTasks.organizationId, organizationId), eq(projectTasks.projectId, projectId), ne(projectTasks.status, "cancelled")));

  const completedCount = rows.filter((r) => r.status === "completed").length;
  return computeProgress(completedCount, rows.length);
}

/** Milestone progress = completed non-cancelled tasks linked to this milestone / eligible tasks linked to this milestone. */
export async function calculateMilestoneProgress(db: Db, organizationId: string, milestoneId: string): Promise<ProgressResult> {
  const rows = await db
    .select({ status: projectTasks.status })
    .from(projectTasks)
    .where(and(eq(projectTasks.organizationId, organizationId), eq(projectTasks.milestoneId, milestoneId), ne(projectTasks.status, "cancelled")));

  const completedCount = rows.filter((r) => r.status === "completed").length;
  return computeProgress(completedCount, rows.length);
}
