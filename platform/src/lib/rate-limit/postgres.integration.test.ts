import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { PostgresRateLimiter, deleteStaleRateLimitCounters } from "./postgres";

const env = loadEnv();
const db = createDbClient(env);
const limiter = new PostgresRateLimiter(db);

function testKey(name: string) {
  return `test:rate-limit-integration:${name}:${crypto.randomUUID()}`;
}

describe("PostgresRateLimiter against a real database", () => {
  const keysToClean: string[] = [];

  afterEach(async () => {
    while (keysToClean.length > 0) {
      const key = keysToClean.pop()!;
      await limiter.resetLimit(key);
    }
  });

  it("recordAttempt is atomic under concurrent calls — no lost updates", async () => {
    const key = testKey("atomicity");
    keysToClean.push(key);
    const config = { limit: 1000, windowSeconds: 900 };

    const results = await Promise.all(
      Array.from({ length: 25 }, () => limiter.recordAttempt(key, config))
    );

    const counts = results.map((r) => config.limit - r.remaining).sort((a, b) => a - b);
    expect(counts).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));

    const finalCheck = await limiter.checkLimit(key, config);
    expect(finalCheck.remaining).toBe(config.limit - 25);
  });

  it("rejects once the configured limit is reached within the window", async () => {
    const key = testKey("limit-enforced");
    keysToClean.push(key);
    const config = { limit: 3, windowSeconds: 900 };

    const r1 = await limiter.recordAttempt(key, config);
    const r2 = await limiter.recordAttempt(key, config);
    const r3 = await limiter.recordAttempt(key, config);
    const r4 = await limiter.recordAttempt(key, config);

    expect([r1.allowed, r2.allowed, r3.allowed]).toEqual([true, true, true]);
    expect(r4.allowed).toBe(false);
  });

  it("resets the count once the window has genuinely expired", async () => {
    const key = testKey("window-reset");
    keysToClean.push(key);
    const config = { limit: 5, windowSeconds: 1 };

    await limiter.recordAttempt(key, config);
    await limiter.recordAttempt(key, config);

    // Force the stored window_start into the past directly, rather than
    // sleeping — proves the reset logic, not just a real wall-clock wait.
    await db.execute(
      sql`UPDATE rate_limit_counters SET window_start = now() - interval '10 seconds' WHERE key = ${key}`
    );

    const result = await limiter.recordAttempt(key, config);
    expect(result.remaining).toBe(config.limit - 1);
  });

  it("resetLimit clears the counter immediately", async () => {
    const key = testKey("manual-reset");
    keysToClean.push(key);
    const config = { limit: 2, windowSeconds: 900 };

    await limiter.recordAttempt(key, config);
    await limiter.recordAttempt(key, config);
    let result = await limiter.checkLimit(key, config);
    expect(result.allowed).toBe(false);

    await limiter.resetLimit(key);

    result = await limiter.checkLimit(key, config);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(config.limit);
  });

  it("deleteStaleRateLimitCounters removes only rows whose window started more than 7 days ago", async () => {
    const staleKey = testKey("stale");
    const freshKey = testKey("fresh");
    await limiter.recordAttempt(staleKey, { limit: 10, windowSeconds: 900 });
    await limiter.recordAttempt(freshKey, { limit: 10, windowSeconds: 900 });
    await db.execute(
      sql`UPDATE rate_limit_counters SET window_start = now() - interval '8 days' WHERE key = ${staleKey}`
    );

    const deletedCount = await deleteStaleRateLimitCounters(db);

    expect(deletedCount).toBeGreaterThanOrEqual(1);
    const staleRows = await db.execute(sql`SELECT key FROM rate_limit_counters WHERE key = ${staleKey}`);
    const freshRows = await db.execute(sql`SELECT key FROM rate_limit_counters WHERE key = ${freshKey}`);
    expect(staleRows.rows).toHaveLength(0);
    expect(freshRows.rows).toHaveLength(1);

    keysToClean.push(freshKey);
  });
});
