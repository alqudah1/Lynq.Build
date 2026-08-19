import "server-only";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { sessions } from "@/db/schema";

// Copied verbatim from platform/src/lib/auth/session.ts, per
// LYNQ_ENGINEERING_STANDARD.md Part F ("copy, don't import"). Session
// mechanics are product-agnostic — nothing here references BYOOT-specific
// concepts, so nothing needed adapting.

type Db = NeonHttpDatabase<Record<string, unknown>>;
type RawSql = NeonQueryFunction<false, false>;

export const SESSION_IDLE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_RENEWAL_THRESHOLD_MS = 60 * 60 * 1000;

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

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

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

/** Builds (without executing) the raw INSERT query for a new session row, for use inside a rawSql.transaction([...]) batch. */
export function sessionInsertQuery(rawSql: RawSql, v: NewSessionValues) {
  return rawSql`INSERT INTO sessions (id, user_id, token_hash, last_active_at, expires_at, ip_address, user_agent, created_at)
                VALUES (${v.id}, ${v.userId}, ${v.tokenHash}, ${v.lastActiveAt}, ${v.expiresAt}, ${v.ipAddress}, ${v.userAgent}, ${v.createdAt})`;
}

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
    return null;
  }

  await db.update(sessions).set({ lastActiveAt: now, expiresAt: newExpiresAt }).where(eq(sessions.id, row.id));

  return { ...row, lastActiveAt: now, expiresAt: newExpiresAt };
}

export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function revokeAllSessionsForUser(db: Db, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function deleteExpiredSessions(db: Db): Promise<number> {
  const deleted = await db.delete(sessions).where(lt(sessions.expiresAt, new Date())).returning({ id: sessions.id });
  return deleted.length;
}
