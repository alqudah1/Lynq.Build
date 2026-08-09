import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { users, accounts } from "@/db/schema";
import type { ProviderIdentity } from "./callback";
import { IdentityConflictError } from "./errors";
import { buildNewSessionValues, sessionInsertQuery, type SessionRecord } from "./session";
import { auditInsertQuery, type RecordAuditEventInput } from "../audit";

type Db = NeonHttpDatabase<Record<string, unknown>>;
/** The raw neon() tagged-template client — used for every atomic multi-row write in this file (correction pass §5). */
type RawSql = NeonQueryFunction<false, false>;

export interface LoginContext {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface LoginResult {
  outcome: "existing" | "created";
  userId: string;
  session: SessionRecord;
  rawToken: string;
}

const POSTGRES_UNIQUE_VIOLATION = "23505";

function isPostgresUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === POSTGRES_UNIQUE_VIOLATION;
}

/**
 * Account-linking policy AND transaction boundary for the anonymous login
 * entry point (/api/auth/[provider], intent "login" — Step 3 design §6;
 * correction pass §5). Never links or logs in based on an email match
 * alone. Every write path — user creation (if needed), account creation
 * (if needed), session issuance, and the success audit event — is one
 * atomic transaction: if the audit write fails for any reason, the entire
 * transaction rolls back rather than producing an unlogged successful
 * identity mutation (§5's documented default). Racing/duplicate callbacks
 * for the same brand-new identity are resolved deterministically: the
 * losing transaction's unique-constraint violation is caught here and
 * never reaches the caller as a raw database error — it resolves to the
 * winning transaction's existing identity, with its own fresh session,
 * rather than erroring or leaving anything orphaned.
 */
export async function completeLogin(
  db: Db,
  rawSql: RawSql,
  identity: ProviderIdentity,
  context: LoginContext
): Promise<LoginResult> {
  const [existingAccount] = await db
    .select({ userId: accounts.userId })
    .from(accounts)
    .where(and(eq(accounts.provider, identity.provider), eq(accounts.providerAccountId, identity.providerAccountId)));

  if (existingAccount) {
    return issueSessionForExistingUser(rawSql, existingAccount.userId, context);
  }

  const normalizedEmail = identity.email.toLowerCase();

  // Never allow an unverified provider email to take over an existing
  // account — it is never even used to look up one. Straight to signup.
  if (identity.emailVerified) {
    const [matchedUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${normalizedEmail}`);

    if (matchedUser) {
      // Before concluding this is a genuine conflict, re-check whether a
      // concurrent request has, in the meantime, created exactly this
      // (provider, providerAccountId) — closes a narrower race window than
      // the create-time unique-violation alone handles: two identical
      // concurrent signups can interleave such that this request's own
      // email lookup runs *after* the other request has already committed,
      // making a genuine same-identity race look identical to a real
      // cross-provider email conflict unless re-checked here.
      const [wonByAccount] = await db
        .select({ userId: accounts.userId })
        .from(accounts)
        .where(and(eq(accounts.provider, identity.provider), eq(accounts.providerAccountId, identity.providerAccountId)));

      if (wonByAccount) {
        return issueSessionForExistingUser(rawSql, wonByAccount.userId, context);
      }

      // A verified email identified a plausible existing account, but
      // identification from an unauthenticated request is never
      // authorization to act on it — human-safe resolution required.
      throw new IdentityConflictError(matchedUser.id);
    }
  }

  return createUserAndLogin(db, rawSql, identity, normalizedEmail, context);
}

/**
 * Existing-user login: session issuance + the success audit event, atomic
 * together (§5 — even a plain, no-race login must not produce a session
 * without its own logged event, or vice versa).
 */
async function issueSessionForExistingUser(
  rawSql: RawSql,
  userId: string,
  context: LoginContext
): Promise<LoginResult> {
  const sessionValues = buildNewSessionValues(userId, context.ipAddress, context.userAgent);
  const auditEvent: RecordAuditEventInput = {
    eventType: "oauth_login_success",
    actorUserId: userId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  };

  await rawSql.transaction([sessionInsertQuery(rawSql, sessionValues), auditInsertQuery(rawSql, auditEvent)]);

  return {
    outcome: "existing",
    userId,
    session: {
      id: sessionValues.id,
      userId,
      createdAt: sessionValues.createdAt,
      expiresAt: sessionValues.expiresAt,
      lastActiveAt: sessionValues.lastActiveAt,
    },
    rawToken: sessionValues.rawToken,
  };
}

/**
 * Brand-new signup: user + account + session + sign_up event + login
 * success event, all in one atomic transaction. On a genuine race against
 * a concurrent identical signup, the loser's unique-constraint violation
 * is caught and resolved to the winner's identity with a fresh session —
 * never a raw error, never an orphaned row.
 */
async function createUserAndLogin(
  db: Db,
  rawSql: RawSql,
  identity: ProviderIdentity,
  normalizedEmail: string,
  context: LoginContext
): Promise<LoginResult> {
  const userId = randomUUID();
  const accountId = randomUUID();
  const emailVerifiedAt = identity.emailVerified ? new Date() : null;
  const sessionValues = buildNewSessionValues(userId, context.ipAddress, context.userAgent);

  try {
    await rawSql.transaction([
      rawSql`INSERT INTO users (id, email, email_verified_at, name, image)
             VALUES (${userId}, ${normalizedEmail}, ${emailVerifiedAt}, ${identity.name}, ${identity.image})`,
      rawSql`INSERT INTO accounts (id, user_id, provider, provider_account_id)
             VALUES (${accountId}, ${userId}, ${identity.provider}, ${identity.providerAccountId})`,
      sessionInsertQuery(rawSql, sessionValues),
      auditInsertQuery(rawSql, { eventType: "sign_up", actorUserId: userId, ipAddress: context.ipAddress, userAgent: context.userAgent }),
      auditInsertQuery(rawSql, {
        eventType: "oauth_login_success",
        actorUserId: userId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      }),
    ]);
  } catch (err) {
    if (!isPostgresUniqueViolation(err)) {
      throw err;
    }
    return resolveLoginRace(db, rawSql, identity, normalizedEmail, context);
  }

  return {
    outcome: "created",
    userId,
    session: {
      id: sessionValues.id,
      userId,
      createdAt: sessionValues.createdAt,
      expiresAt: sessionValues.expiresAt,
      lastActiveAt: sessionValues.lastActiveAt,
    },
    rawToken: sessionValues.rawToken,
  };
}

/**
 * Deterministic resolution after a losing transaction's unique-violation
 * (§5's "handle duplicate or racing callbacks deterministically"):
 * re-checks whether the (provider, providerAccountId) now exists — if so,
 * a concurrent identical signup won the race, and this request resolves to
 * that existing identity with its own fresh session. If not, the
 * collision was actually on the email constraint against a genuinely
 * different existing account (the unverified-email-collision case) — a
 * real conflict, not a race, so it still throws IdentityConflictError
 * rather than silently resolving to the wrong person.
 */
async function resolveLoginRace(
  db: Db,
  rawSql: RawSql,
  identity: ProviderIdentity,
  normalizedEmail: string,
  context: LoginContext
): Promise<LoginResult> {
  const [wonByAccount] = await db
    .select({ userId: accounts.userId })
    .from(accounts)
    .where(and(eq(accounts.provider, identity.provider), eq(accounts.providerAccountId, identity.providerAccountId)));

  if (wonByAccount) {
    return issueSessionForExistingUser(rawSql, wonByAccount.userId, context);
  }

  const [conflictingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${normalizedEmail}`);

  throw new IdentityConflictError(conflictingUser?.id ?? "unknown");
}

export type LinkProviderOutcome = { outcome: "linked" } | { outcome: "already-linked" };

/**
 * Account-linking policy AND transaction boundary for the authenticated
 * entry point (/api/auth/link/[provider], intent "link" — Step 3 design
 * §6; correction pass §5). The account INSERT and the oauth_account_linked
 * audit event are one atomic transaction. A racing duplicate link request
 * (the same user linking the same identity twice concurrently) resolves to
 * "already-linked" rather than a raw database error; linking to a
 * genuinely different existing user's identity remains a real conflict.
 */
export async function completeLink(
  db: Db,
  rawSql: RawSql,
  identity: ProviderIdentity,
  currentUserId: string,
  context: LoginContext = { ipAddress: null, userAgent: null }
): Promise<LinkProviderOutcome> {
  const [existingAccount] = await db
    .select({ userId: accounts.userId })
    .from(accounts)
    .where(and(eq(accounts.provider, identity.provider), eq(accounts.providerAccountId, identity.providerAccountId)));

  if (existingAccount) {
    if (existingAccount.userId === currentUserId) {
      return { outcome: "already-linked" };
    }
    throw new IdentityConflictError(existingAccount.userId);
  }

  // A verified provider email is an additional conflict signal, but it is
  // never required for this explicit, already-authenticated linking path.
  // Microsoft deliberately has `emailVerified: false` because its Entra ID
  // token carries no Google-equivalent verification claim; the stable,
  // cryptographically verified `{tid}.{oid}` provider identity plus the
  // current LYNQ session is the authorization boundary here. Skipping the
  // email lookup for Microsoft preserves the rule that its UPN/contact email
  // is never used as an identity signal while still allowing the explicit
  // linking flow the route was designed to provide.
  if (identity.emailVerified) {
    const normalizedEmail = identity.email.toLowerCase();
    const [matchedUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${normalizedEmail}`);

    if (matchedUser && matchedUser.id !== currentUserId) {
      throw new IdentityConflictError(matchedUser.id);
    }
  }

  const accountId = randomUUID();
  const auditEvent: RecordAuditEventInput = {
    eventType: "oauth_account_linked",
    actorUserId: currentUserId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  };

  try {
    await rawSql.transaction([
      rawSql`INSERT INTO accounts (id, user_id, provider, provider_account_id)
             VALUES (${accountId}, ${currentUserId}, ${identity.provider}, ${identity.providerAccountId})`,
      auditInsertQuery(rawSql, auditEvent),
    ]);
  } catch (err) {
    if (!isPostgresUniqueViolation(err)) {
      throw err;
    }
    const [winner] = await db
      .select({ userId: accounts.userId })
      .from(accounts)
      .where(and(eq(accounts.provider, identity.provider), eq(accounts.providerAccountId, identity.providerAccountId)));

    if (winner?.userId === currentUserId) {
      return { outcome: "already-linked" };
    }
    throw new IdentityConflictError(winner?.userId ?? "unknown");
  }

  return { outcome: "linked" };
}
