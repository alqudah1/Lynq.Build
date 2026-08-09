import "server-only";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { sessions } from "@/db/schema";

type Db = NeonHttpDatabase<Record<string, unknown>>;
type RawSql = NeonQueryFunction<false, false>;

/**
 * Session expiration model (correction pass §4, superseding Step 3's
 * original "30 days absolute, sliding, no idle timeout"):
 *
 * - Idle lifetime: 7 days — a session untouched for a week expires even
 *   though its 30-day absolute cap hasn't passed.
 * - Absolute lifetime: 30 days from `sessions.created_at` — never
 *   extendable past this, no matter how much activity occurs.
 * - On valid activity: `newExpiresAt = min(now + 7 days, created_at + 30 days)`.
 *
 * Both master design docs' session sections are updated to match this
 * exact model — see MODULE_2_AUTH_AND_TENANCY_DESIGN.md §5/§17 item 4 and
 * MODULE_2_STEP_3_OAUTH_SESSION_DESIGN.md §4.
 */
export const SESSION_IDLE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Sliding renewal is only written when more than this much time has passed
 * since the session's last update — avoids a database write on literally
 * every request (Step 3 design §8).
 */
export const SESSION_RENEWAL_THRESHOLD_MS = 60 * 60 * 1000;

/** `newExpiresAt = min(now + 7 days, createdAt + 30 days)` — never extends past the absolute cap. */
export function computeExpiresAt(createdAt: Date, now: Date): Date {
  const idleBound = now.getTime() + SESSION_IDLE_LIFETIME_MS;
  const absoluteBound = createdAt.getTime() + SESSION_ABSOLUTE_LIFETIME_MS;
  return new Date(Math.min(idleBound, absoluteBound));
}

export interface SessionRecord {
  id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  lastActiveAt: Date;
}

export interface CreateSessionInput {
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface CreatedSession {
  session: SessionRecord;
  /** The raw, unhashed token — the only time it is ever available. Give it to the browser (cookie) and never persist it. */
  rawToken: string;
}

/** 32 random bytes, base64url-encoded — the value that goes in the session cookie. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * sha256 hex of the raw token — the only form ever persisted
 * (sessions.token_hash).
 *
 * Security justification for plain (unsalted, unkeyed) SHA-256, chosen
 * deliberately rather than left over by default (correction pass §6): this
 * is safe specifically *because* the input is 32 bytes (256 bits) of CSPRNG
 * output, not a low-entropy human-chosen secret. SHA-256's speed is a
 * liability for password hashing (attackers can brute-force a small
 * search space of likely passwords at billions of guesses/second) but
 * irrelevant here — inverting a random 256-bit value via brute force
 * requires searching essentially the entire 2^256 space regardless of hash
 * speed, which is computationally infeasible with any hash function, fast
 * or slow. A slow KDF (Argon2id, bcrypt) would add real request latency
 * for zero additional security in this specific case. HMAC-SHA256 with a
 * separate secret would add a second layer, but was deliberately not
 * chosen: it requires introducing a new `SESSION_TOKEN_SECRET` env var,
 * with its own rotation story (rotating it would invalidate every active
 * session at once unless a dual-secret verification window is built), for
 * a benefit that doesn't materialize against a 256-bit-entropy input. If
 * token generation entropy were ever reduced for some reason, HMAC-SHA256
 * with a dedicated pepper would become the right choice at that time — not
 * before.
 */
export function hashSessionToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export interface NewSessionValues {
  id: string;
  userId: string;
  tokenHash: string;
  rawToken: string;
  createdAt: Date;
  lastActiveAt: Date;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Computes every value a new session row needs, without executing any
 * query — used both by the standalone `createSession` below and by the
 * atomic login/link transactions in account-linking.ts, which need to
 * bundle a session INSERT into the same `rawSql.transaction([...])` batch
 * as the user/account/audit inserts (correction pass §5).
 */
export function buildNewSessionValues(
  userId: string,
  ipAddress: string | null = null,
  userAgent: string | null = null
): NewSessionValues {
  const rawToken = generateSessionToken();
  const now = new Date();
  return {
    id: randomUUID(),
    userId,
    tokenHash: hashSessionToken(rawToken),
    rawToken,
    createdAt: now,
    lastActiveAt: now,
    expiresAt: computeExpiresAt(now, now),
    ipAddress,
    userAgent,
  };
}

/** Builds (without executing) the raw INSERT query for a new session row, for use inside a `rawSql.transaction([...])` batch. */
export function sessionInsertQuery(rawSql: RawSql, v: NewSessionValues) {
  return rawSql`INSERT INTO sessions (id, user_id, token_hash, last_active_at, expires_at, ip_address, user_agent, created_at)
                VALUES (${v.id}, ${v.userId}, ${v.tokenHash}, ${v.lastActiveAt}, ${v.expiresAt}, ${v.ipAddress}, ${v.userAgent}, ${v.createdAt})`;
}

/**
 * Standalone session creation (not bundled into any other transaction) —
 * always issues a brand-new session, never promoted or upgraded from a
 * pre-auth state (Module 2 §3, §5).
 */
export async function createSession(db: Db, input: CreateSessionInput): Promise<CreatedSession> {
  const values = buildNewSessionValues(input.userId, input.ipAddress ?? null, input.userAgent ?? null);

  const [row] = await db
    .insert(sessions)
    .values({
      id: values.id,
      userId: values.userId,
      tokenHash: values.tokenHash,
      lastActiveAt: values.lastActiveAt,
      expiresAt: values.expiresAt,
      ipAddress: values.ipAddress,
      userAgent: values.userAgent,
      createdAt: values.createdAt,
    })
    .returning({
      id: sessions.id,
      userId: sessions.userId,
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
      lastActiveAt: sessions.lastActiveAt,
    });

  return { session: row, rawToken: values.rawToken };
}

/**
 * Hashes the incoming raw token and looks up the session by that hash. An
 * expired row is treated identically to a missing one (Module 2 §5). On a
 * valid session, slides `expires_at`/`last_active_at` forward using
 * `computeExpiresAt` — capped at `created_at + 30 days` regardless of how
 * much activity occurs — but only writes when more than
 * SESSION_RENEWAL_THRESHOLD_MS has passed since the last update, per §8's
 * write-throttling design.
 */
export async function validateSessionToken(db: Db, rawToken: string): Promise<SessionRecord | null> {
  const tokenHash = hashSessionToken(rawToken);
  const now = new Date();

  const [row] = await db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
      lastActiveAt: sessions.lastActiveAt,
    })
    .from(sessions)
    .where(eq(sessions.tokenHash, tokenHash));

  if (!row || row.expiresAt.getTime() <= now.getTime()) {
    return null;
  }

  const sinceLastUpdate = now.getTime() - row.lastActiveAt.getTime();
  if (sinceLastUpdate <= SESSION_RENEWAL_THRESHOLD_MS) {
    return row;
  }

  const newExpiresAt = computeExpiresAt(row.createdAt, now);
  if (newExpiresAt.getTime() <= now.getTime()) {
    // The absolute cap (created_at + 30 days) has already passed by the
    // time this renewal-eligible request arrived — never "renew" to an
    // already-past timestamp. Treat as expired despite the continued
    // activity that triggered this check (correction pass §4).
    return null;
  }

  await db.update(sessions).set({ lastActiveAt: now, expiresAt: newExpiresAt }).where(eq(sessions.id, row.id));

  return { ...row, lastActiveAt: now, expiresAt: newExpiresAt };
}

/** Single sign-out — deletes one session row. Takes effect immediately; the very next lookup finds nothing. */
export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/** "Sign out everywhere" — deletes every session row for a user. */
export async function revokeAllSessionsForUser(db: Db, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/**
 * Operational cleanup: deletes every expired session row (correction pass
 * §7). Cadence, ownership, and failure-alerting policy are documented in
 * MODULE_2_STEP_3_OAUTH_SESSION_DESIGN.md §7 — this function is the query
 * that policy schedules; scheduling itself is deferred to the operational-
 * jobs step, per the explicit instruction that implementation may be
 * deferred as long as the query itself exists and is documented now.
 */
export async function deleteExpiredSessions(db: Db): Promise<number> {
  const deleted = await db.delete(sessions).where(lt(sessions.expiresAt, new Date())).returning({ id: sessions.id });
  return deleted.length;
}
