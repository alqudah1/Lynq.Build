import { describe, it, expect, vi } from "vitest";
import { PostgresRateLimiter } from "./postgres";

/**
 * Minimal fake covering exactly the Drizzle chain shapes PostgresRateLimiter
 * calls (select().from().where(), delete().where()). Real atomicity for
 * recordAttempt's ON CONFLICT upsert can only be proven against real
 * Postgres — see postgres.integration.test.ts.
 */
function createFakeDb(selectRows: unknown[]) {
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  return {
    fakeDeleteWhere: deleteWhere,
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(selectRows),
      }),
    }),
    delete: () => ({
      where: deleteWhere,
    }),
  };
}

describe("PostgresRateLimiter.checkLimit", () => {
  it("allows with full remaining when no row exists yet for the key", async () => {
    const fakeDb = createFakeDb([]);
    const limiter = new PostgresRateLimiter(fakeDb as never);

    const result = await limiter.checkLimit("scope:action:id", { limit: 10, windowSeconds: 900 });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(10);
  });

  it("reports remaining attempts correctly when under the limit within the current window", async () => {
    const fakeDb = createFakeDb([{ count: 3, windowStart: new Date() }]);
    const limiter = new PostgresRateLimiter(fakeDb as never);

    const result = await limiter.checkLimit("scope:action:id", { limit: 10, windowSeconds: 900 });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(7);
  });

  it("reports not allowed once the count reaches the limit within the current window", async () => {
    const fakeDb = createFakeDb([{ count: 10, windowStart: new Date() }]);
    const limiter = new PostgresRateLimiter(fakeDb as never);

    const result = await limiter.checkLimit("scope:action:id", { limit: 10, windowSeconds: 900 });

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("treats an expired window as reset, ignoring the stale count", async () => {
    const staleWindowStart = new Date(Date.now() - 1000 * 1000); // older than the 900s window
    const fakeDb = createFakeDb([{ count: 10, windowStart: staleWindowStart }]);
    const limiter = new PostgresRateLimiter(fakeDb as never);

    const result = await limiter.checkLimit("scope:action:id", { limit: 10, windowSeconds: 900 });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(10);
  });
});

describe("PostgresRateLimiter.resetLimit", () => {
  it("deletes the counter row for the given key", async () => {
    const fakeDb = createFakeDb([]);
    const limiter = new PostgresRateLimiter(fakeDb as never);

    await limiter.resetLimit("scope:action:id");

    expect(fakeDb.fakeDeleteWhere).toHaveBeenCalledTimes(1);
  });
});
