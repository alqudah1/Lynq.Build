import "server-only";
import { and, lt, inArray } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { sessions, rateLimitCounters, runtimeJobs } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { RUNTIME_CONFIG } from "./config";
import { startOperationRun, finishOperationRun } from "./operation-runs";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Operational cleanup jobs — Module 9
 * ============================================================================
 * Only two get their own dedicated queue job type (`cleanup_expired_sessions`,
 * `cleanup_rate_limit_counters`) — matching the task's own narrow,
 * approved job-type list exactly. "Expired approval requests" is folded
 * into execution reconciliation (`reconciliation-executions.ts`, already
 * an org-scoped sweep); "expired execution leases" needs no separate
 * cleanup at all — `claimJobs` reclaims them lazily, by design, the
 * moment a worker next polls. `cleanupOldCompletedJobs` (retention for
 * terminal `runtime_jobs` rows) is exposed as a plain function, called
 * from the same internal `/reconcile` sweep rather than its own job
 * type, for the identical "no slot in the approved list" reason.
 *
 * Never deletes: execution events, plans, checkpoints, artifacts, or
 * audit logs — explicitly out of scope (task's own "do not delete"
 * list). Retention windows are named in `config.ts`, never hardcoded
 * inline.
 */

export interface CleanupResult {
  recordsExamined: number;
  recordsAffected: number;
}

async function runCleanup(db: Db, operationType: string, work: () => Promise<CleanupResult>): Promise<CleanupResult> {
  const run = await startOperationRun(db, operationType);
  try {
    const result = await work();
    await finishOperationRun(db, run.id, { recordsExamined: result.recordsExamined, recordsAffected: result.recordsAffected, succeeded: true });
    await recordAuditEvent(db, { eventType: "cleanup_job_completed", targetType: "runtime_operation_run", targetId: run.id, metadata: { operationType, recordsExamined: result.recordsExamined, recordsAffected: result.recordsAffected } });
    return result;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message.slice(0, 1000) : String(err);
    await finishOperationRun(db, run.id, { recordsExamined: 0, recordsAffected: 0, succeeded: false, errorMessage });
    // Never log secrets — session tokens and rate-limit keys never appear
    // in the error message path here since these queries never select
    // `token_hash` or raw keys, only ids/counts.
    throw err;
  }
}

export async function cleanupExpiredSessions(db: Db): Promise<CleanupResult> {
  return runCleanup(db, "cleanup_expired_sessions", async () => {
    const expired = await db.select({ id: sessions.id }).from(sessions).where(lt(sessions.expiresAt, new Date()));
    if (expired.length === 0) return { recordsExamined: 0, recordsAffected: 0 };
    await db.delete(sessions).where(
      inArray(
        sessions.id,
        expired.map((r) => r.id)
      )
    );
    return { recordsExamined: expired.length, recordsAffected: expired.length };
  });
}

/**
 * `rate_limit_counters` has no explicit expiry column — every window in
 * this codebase is bounded to a few minutes at most (the longest is
 * Module 8's 60-second tool budgets), so a counter whose `window_start`
 * is more than an hour old is unambiguously stale under every config
 * this codebase actually uses.
 */
const RATE_LIMIT_STALE_WINDOW_SECONDS = 60 * 60;

export async function cleanupStaleRateLimitCounters(db: Db): Promise<CleanupResult> {
  return runCleanup(db, "cleanup_rate_limit_counters", async () => {
    const staleThreshold = new Date(Date.now() - RATE_LIMIT_STALE_WINDOW_SECONDS * 1000);
    const stale = await db.select({ key: rateLimitCounters.key }).from(rateLimitCounters).where(lt(rateLimitCounters.windowStart, staleThreshold));
    if (stale.length === 0) return { recordsExamined: 0, recordsAffected: 0 };
    await db.delete(rateLimitCounters).where(
      inArray(
        rateLimitCounters.key,
        stale.map((r) => r.key)
      )
    );
    return { recordsExamined: stale.length, recordsAffected: stale.length };
  });
}

const TERMINAL_JOB_STATUSES = ["completed", "failed", "cancelled", "dead_lettered"] as const;

/** Retention for the queue's OWN terminal rows — never the executions, plans, checkpoints, or artifacts they reference. */
export async function cleanupOldCompletedJobs(db: Db): Promise<CleanupResult> {
  return runCleanup(db, "cleanup_old_runtime_jobs", async () => {
    const retentionThreshold = new Date(Date.now() - RUNTIME_CONFIG.completedJobRetentionSeconds * 1000);
    const old = await db
      .select({ id: runtimeJobs.id })
      .from(runtimeJobs)
      .where(and(inArray(runtimeJobs.status, [...TERMINAL_JOB_STATUSES]), lt(runtimeJobs.completedAt, retentionThreshold)));
    if (old.length === 0) return { recordsExamined: 0, recordsAffected: 0 };
    await db.delete(runtimeJobs).where(
      inArray(
        runtimeJobs.id,
        old.map((r) => r.id)
      )
    );
    return { recordsExamined: old.length, recordsAffected: old.length };
  });
}
