import "server-only";
import { and, eq, sql, gt } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { runtimeJobs } from "@/db/schema";
import { requireOrganizationMembership } from "@/lib/authz/helpers";
import { listRecentOperationRuns } from "./operation-runs";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface RuntimeStatusSummary {
  jobCountsByStatus: Record<string, number>;
  expiredLeaseCount: number;
  averageProcessingDurationSeconds: number | null;
  requiresHumanReviewCount: number;
  recentReconciliationRuns: Array<{ operationType: string; startedAt: Date; completedAt: Date | null; recordsExamined: number; recordsAffected: number; succeeded: boolean | null }>;
}

/**
 * Deterministic service/API summary — "bounded operational metrics,"
 * never an external observability provider (task's own instruction).
 * Every number here is a direct, cheap aggregate query against
 * `runtime_jobs`/`runtime_operation_runs`; nothing is sampled or
 * estimated.
 */
export async function getRuntimeStatus(db: Db, input: { organizationId: string; actorUserId: string }): Promise<RuntimeStatusSummary> {
  await requireOrganizationMembership(db, input.organizationId, input.actorUserId);

  const statusRows = await db
    .select({ status: runtimeJobs.status, count: sql<number>`count(*)::int` })
    .from(runtimeJobs)
    .where(eq(runtimeJobs.organizationId, input.organizationId))
    .groupBy(runtimeJobs.status);
  const jobCountsByStatus = Object.fromEntries(statusRows.map((r) => [r.status, r.count]));

  const [{ count: expiredLeaseCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(runtimeJobs)
    .where(and(eq(runtimeJobs.organizationId, input.organizationId), sql`${runtimeJobs.status} IN ('leased','running')`, sql`${runtimeJobs.leaseExpiresAt} < now()`));

  const [{ avgSeconds }] = await db
    .select({ avgSeconds: sql<number | null>`extract(epoch from avg(${runtimeJobs.completedAt} - ${runtimeJobs.createdAt}))` })
    .from(runtimeJobs)
    .where(and(eq(runtimeJobs.organizationId, input.organizationId), eq(runtimeJobs.status, "completed"), gt(runtimeJobs.completedAt, new Date(Date.now() - 24 * 60 * 60 * 1000))));

  const [{ count: requiresHumanReviewCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(runtimeJobs)
    .where(and(eq(runtimeJobs.organizationId, input.organizationId), eq(runtimeJobs.requiresHumanReview, true)));

  const recentRuns = await listRecentOperationRuns(db, { limit: 10 });

  return {
    jobCountsByStatus,
    expiredLeaseCount,
    averageProcessingDurationSeconds: avgSeconds === null || avgSeconds === undefined ? null : Number(avgSeconds),
    requiresHumanReviewCount,
    recentReconciliationRuns: recentRuns.map((r) => ({ operationType: r.operationType, startedAt: r.startedAt, completedAt: r.completedAt, recordsExamined: r.recordsExamined, recordsAffected: r.recordsAffected, succeeded: r.succeeded })),
  };
}
