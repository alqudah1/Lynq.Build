import "server-only";
import { sql, eq, lt } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { rateLimitCounters } from "@/db/schema";
import type { RateLimiter, RateLimitConfig, RateLimitResult } from "./types";

/**
 * Retention threshold for the operational cleanup job (correction pass §7):
 * a counter whose window_start is older than this is guaranteed to be
 * outside every configured rate-limit window in this codebase (the longest
 * configured window, §11's 900-second OAuth sign-in limit, ends in
 * minutes, not days) — 7 days is a deliberately generous safety margin,
 * not a precise per-key window calculation, since the table itself doesn't
 * persist which windowSeconds value was used for a given key.
 */
export const RATE_LIMIT_COUNTER_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * Postgres-backed implementation of the provider-agnostic RateLimiter
 * interface (Module 2 §11), reusing the already-provisioned Neon database
 * rather than a separate service. A future move to Upstash Redis or another
 * backend is a swap of this file, not a change to any calling code.
 */
export class PostgresRateLimiter implements RateLimiter {
  constructor(private readonly db: Db) {}

  async checkLimit(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
    const rows = await this.db
      .select({ count: rateLimitCounters.count, windowStart: rateLimitCounters.windowStart })
      .from(rateLimitCounters)
      .where(eq(rateLimitCounters.key, key));

    const row = rows[0];
    if (!row) {
      return {
        allowed: true,
        remaining: config.limit,
        resetAt: new Date(Date.now() + config.windowSeconds * 1000),
      };
    }

    const windowEnd = row.windowStart.getTime() + config.windowSeconds * 1000;
    const windowExpired = windowEnd < Date.now();
    const currentCount = windowExpired ? 0 : row.count;

    return {
      allowed: currentCount < config.limit,
      remaining: Math.max(0, config.limit - currentCount),
      resetAt: windowExpired ? new Date(Date.now() + config.windowSeconds * 1000) : new Date(windowEnd),
    };
  }

  /**
   * A single atomic statement — increment-and-read, or reset-to-1 if the
   * existing row's window has expired — never a separate SELECT followed by
   * an UPDATE, which would race under concurrent requests (§11). Verified
   * directly against Postgres under real concurrency; see
   * test/lib/rate-limit/postgres.test.ts.
   */
  async recordAttempt(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
    const windowInterval = sql`(${config.windowSeconds} || ' seconds')::interval`;

    const result = await this.db.execute<{ count: number; window_start: string }>(sql`
      INSERT INTO rate_limit_counters (key, count, window_start)
      VALUES (${key}, 1, now())
      ON CONFLICT (key) DO UPDATE SET
        count = CASE
          WHEN rate_limit_counters.window_start + ${windowInterval} < now() THEN 1
          ELSE rate_limit_counters.count + 1
        END,
        window_start = CASE
          WHEN rate_limit_counters.window_start + ${windowInterval} < now() THEN now()
          ELSE rate_limit_counters.window_start
        END
      RETURNING count, window_start
    `);

    const row = result.rows[0];
    if (!row) {
      throw new Error("rate_limit_counters upsert returned no row");
    }

    const count = Number(row.count);
    const windowStart = new Date(row.window_start);

    return {
      allowed: count <= config.limit,
      remaining: Math.max(0, config.limit - count),
      resetAt: new Date(windowStart.getTime() + config.windowSeconds * 1000),
    };
  }

  async resetLimit(key: string): Promise<void> {
    await this.db.delete(rateLimitCounters).where(eq(rateLimitCounters.key, key));
  }
}

/**
 * Operational cleanup: deletes rate_limit_counters rows whose window
 * started more than RATE_LIMIT_COUNTER_RETENTION_MS ago (correction pass
 * §7). Cadence, ownership, and failure-alerting policy are documented in
 * MODULE_2_STEP_3_OAUTH_SESSION_DESIGN.md §7 — this function is the query
 * that policy schedules; scheduling itself is deferred to the operational-
 * jobs step.
 */
export async function deleteStaleRateLimitCounters(db: NeonHttpDatabase<Record<string, unknown>>): Promise<number> {
  const cutoff = new Date(Date.now() - RATE_LIMIT_COUNTER_RETENTION_MS);
  const deleted = await db
    .delete(rateLimitCounters)
    .where(lt(rateLimitCounters.windowStart, cutoff))
    .returning({ key: rateLimitCounters.key });
  return deleted.length;
}
