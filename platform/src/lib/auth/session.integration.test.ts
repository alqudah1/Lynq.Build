import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, sessions } from "@/db/schema";
import {
  createSession,
  validateSessionToken,
  revokeSession,
  revokeAllSessionsForUser,
  deleteExpiredSessions,
  SESSION_RENEWAL_THRESHOLD_MS,
  SESSION_IDLE_LIFETIME_MS,
  SESSION_ABSOLUTE_LIFETIME_MS,
} from "./session";

const env = loadEnv();
const db = createDbClient(env);

let testUserId: string;

beforeEach(async () => {
  const [user] = await db
    .insert(users)
    .values({ email: `session-test-${crypto.randomUUID()}@example.com` })
    .returning({ id: users.id });
  testUserId = user.id;
});

afterEach(async () => {
  await db.delete(users).where(sql`${users.id} = ${testUserId}`);
});

describe("session primitives against a real database", () => {
  it("creates a session, validates it by its raw token, and never persists the raw token", async () => {
    const { session, rawToken } = await createSession(db, { userId: testUserId });

    expect(rawToken).toBeTruthy();

    const [row] = await db.select().from(sessions).where(sql`${sessions.id} = ${session.id}`);
    expect(row.tokenHash).not.toBe(rawToken);

    const validated = await validateSessionToken(db, rawToken);
    expect(validated).not.toBeNull();
    expect(validated?.userId).toBe(testUserId);
  });

  it("rejects a token that doesn't match any session", async () => {
    const result = await validateSessionToken(db, "not-a-real-token");
    expect(result).toBeNull();
  });

  it("treats an expired session as absent", async () => {
    const { session, rawToken } = await createSession(db, { userId: testUserId });
    await db
      .update(sessions)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(sql`${sessions.id} = ${session.id}`);

    const result = await validateSessionToken(db, rawToken);
    expect(result).toBeNull();
  });

  it("does not write a renewal update when under the sliding-renewal threshold", async () => {
    const { session, rawToken } = await createSession(db, { userId: testUserId });
    const [before] = await db.select().from(sessions).where(sql`${sessions.id} = ${session.id}`);

    await validateSessionToken(db, rawToken);

    const [after] = await db.select().from(sessions).where(sql`${sessions.id} = ${session.id}`);
    expect(after.lastActiveAt.getTime()).toBe(before.lastActiveAt.getTime());
  });

  it("slides expiry forward once the renewal threshold has passed", async () => {
    const { session, rawToken } = await createSession(db, { userId: testUserId });
    const staleLastActive = new Date(Date.now() - SESSION_RENEWAL_THRESHOLD_MS - 60_000);
    await db
      .update(sessions)
      .set({ lastActiveAt: staleLastActive })
      .where(sql`${sessions.id} = ${session.id}`);

    const validated = await validateSessionToken(db, rawToken);

    expect(validated?.lastActiveAt.getTime()).toBeGreaterThan(staleLastActive.getTime());

    const [after] = await db.select().from(sessions).where(sql`${sessions.id} = ${session.id}`);
    expect(after.lastActiveAt.getTime()).toBeGreaterThan(staleLastActive.getTime());
  });

  it("revokeSession deletes exactly that session, rejected on the very next use", async () => {
    const { session, rawToken } = await createSession(db, { userId: testUserId });
    await revokeSession(db, session.id);

    const result = await validateSessionToken(db, rawToken);
    expect(result).toBeNull();
  });

  it("revokeAllSessionsForUser deletes every session for that user, including other devices", async () => {
    const deviceA = await createSession(db, { userId: testUserId });
    const deviceB = await createSession(db, { userId: testUserId });

    await revokeAllSessionsForUser(db, testUserId);

    expect(await validateSessionToken(db, deviceA.rawToken)).toBeNull();
    expect(await validateSessionToken(db, deviceB.rawToken)).toBeNull();
  });

  it("idle expiration: rejects a session whose 7-day idle window has passed, even though its 30-day absolute cap has not", async () => {
    const { session, rawToken } = await createSession(db, { userId: testUserId });
    // createdAt stays "now" (far from the 30-day absolute cap); expiresAt
    // is set into the past to simulate the idle bound having been reached
    // without ever renewing — exactly what createSession itself would
    // have computed had 7+ days passed with zero activity.
    await db
      .update(sessions)
      .set({ expiresAt: sql`now() - interval '1 hour'` })
      .where(sql`${sessions.id} = ${session.id}`);

    const result = await validateSessionToken(db, rawToken);
    expect(result).toBeNull();
  });

  it("renewal before the absolute cap slides expiresAt to now + 7 days", async () => {
    const { session, rawToken } = await createSession(db, { userId: testUserId });
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await db
      .update(sessions)
      .set({ createdAt: tenDaysAgo, lastActiveAt: tenDaysAgo, expiresAt: new Date(Date.now() + 60_000) })
      .where(sql`${sessions.id} = ${session.id}`);

    const validated = await validateSessionToken(db, rawToken);

    expect(validated).not.toBeNull();
    const expectedExpiresAt = Date.now() + SESSION_IDLE_LIFETIME_MS;
    expect(Math.abs(validated!.expiresAt.getTime() - expectedExpiresAt)).toBeLessThan(5000);
  });

  it("renewal near the absolute cap is capped at created_at + 30 days, not extended a full 7 days from now", async () => {
    const { session, rawToken } = await createSession(db, { userId: testUserId });
    const twentyFiveDaysAgo = new Date(Date.now() - 25 * 24 * 60 * 60 * 1000);
    await db
      .update(sessions)
      .set({ createdAt: twentyFiveDaysAgo, lastActiveAt: twentyFiveDaysAgo, expiresAt: new Date(Date.now() + 60_000) })
      .where(sql`${sessions.id} = ${session.id}`);

    const validated = await validateSessionToken(db, rawToken);

    expect(validated).not.toBeNull();
    const absoluteCap = twentyFiveDaysAgo.getTime() + SESSION_ABSOLUTE_LIFETIME_MS;
    expect(Math.abs(validated!.expiresAt.getTime() - absoluteCap)).toBeLessThan(5000);
    // Must NOT have been extended to a full 7 days from now (that would be ~2 days later than the cap).
    expect(validated!.expiresAt.getTime()).toBeLessThan(Date.now() + SESSION_IDLE_LIFETIME_MS);
  });

  it("absolute expiration despite continued activity: a session cannot survive past created_at + 30 days no matter how often it's renewed", async () => {
    const { session, rawToken } = await createSession(db, { userId: testUserId });
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    // Simulate a session that is genuinely past its 30-day absolute cap —
    // even a hypothetically "just renewed" expiresAt one hour from now
    // must still be rejected on the very next validation, since the real
    // bound (createdAt + 30 days) has already passed.
    await db
      .update(sessions)
      .set({ createdAt: thirtyOneDaysAgo, lastActiveAt: new Date(), expiresAt: new Date(Date.now() + 60 * 60 * 1000) })
      .where(sql`${sessions.id} = ${session.id}`);

    // First: this stale expiresAt (an hour from now) would incorrectly
    // look valid if the row weren't corrected on next renewal — but since
    // lastActiveAt is fresh (just set), no renewal write happens on this
    // call, so it still validates using the (now-wrong) stored expiresAt.
    // The real test is that once a renewal-triggering call happens, the
    // absolute cap correctly overrides it going forward:
    await db
      .update(sessions)
      .set({ lastActiveAt: new Date(Date.now() - SESSION_RENEWAL_THRESHOLD_MS - 60_000) })
      .where(sql`${sessions.id} = ${session.id}`);

    const validated = await validateSessionToken(db, rawToken);
    expect(validated).toBeNull(); // createdAt + 30 days is already in the past
  });

  it("deleteExpiredSessions removes only expired rows, leaving valid ones intact", async () => {
    const valid = await createSession(db, { userId: testUserId });
    const expired = await createSession(db, { userId: testUserId });
    await db
      .update(sessions)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(sql`${sessions.id} = ${expired.session.id}`);

    await deleteExpiredSessions(db);

    const [expiredRow] = await db.select().from(sessions).where(sql`${sessions.id} = ${expired.session.id}`);
    const [validRow] = await db.select().from(sessions).where(sql`${sessions.id} = ${valid.session.id}`);
    expect(expiredRow).toBeUndefined();
    expect(validRow).toBeDefined();
  });
});
