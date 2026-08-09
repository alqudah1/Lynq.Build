import { describe, it, expect, afterEach } from "vitest";
import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, accounts, sessions, auditLogs } from "@/db/schema";
import { completeLogin, completeLink } from "./account-linking";
import { IdentityConflictError } from "./errors";
import type { ProviderIdentity } from "./callback";

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);
const CONTEXT = { ipAddress: "203.0.113.5", userAgent: "integration-test-agent" };

function identity(overrides: Partial<ProviderIdentity> = {}): ProviderIdentity {
  return {
    provider: "google",
    providerAccountId: `sub-${crypto.randomUUID()}`,
    email: `linking-test-${crypto.randomUUID()}@example.com`,
    emailVerified: true,
    name: "Integration Test User",
    image: null,
    ...overrides,
  };
}

const createdUserIds: string[] = [];

afterEach(async () => {
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    // audit_logs.actor_user_id is ON DELETE SET NULL (audit history must
    // outlive a deleted user, by design) — so deleting the user alone
    // would leave these test rows behind as orphaned, unattributed audit
    // entries. Delete them explicitly first, while still attributable.
    await db.delete(auditLogs).where(sql`${auditLogs.actorUserId} = ${id}`);
    await db.delete(users).where(sql`${users.id} = ${id}`);
  }
});

describe("completeLogin against a real database", () => {
  it("atomically creates user, account, session, and both audit events for a brand-new identity", async () => {
    const providerIdentity = identity();

    const result = await completeLogin(db, rawSql, providerIdentity, CONTEXT);
    expect(result.outcome).toBe("created");
    createdUserIds.push(result.userId);

    const [userRow] = await db.select().from(users).where(sql`${users.id} = ${result.userId}`);
    expect(userRow.email).toBe(providerIdentity.email.toLowerCase());

    const [accountRow] = await db.select().from(accounts).where(sql`${accounts.userId} = ${result.userId}`);
    expect(accountRow.providerAccountId).toBe(providerIdentity.providerAccountId);

    const [sessionRow] = await db.select().from(sessions).where(sql`${sessions.userId} = ${result.userId}`);
    expect(sessionRow.id).toBe(result.session.id);

    const auditRows = await db.select().from(auditLogs).where(sql`${auditLogs.actorUserId} = ${result.userId}`);
    expect(auditRows.map((r) => r.eventType).sort()).toEqual(["oauth_login_success", "sign_up"]);
  });

  it("issues a fresh session atomically with an oauth_login_success event for an existing user, without a duplicate sign_up", async () => {
    const providerIdentity = identity();
    const first = await completeLogin(db, rawSql, providerIdentity, CONTEXT);
    createdUserIds.push(first.userId);

    const second = await completeLogin(db, rawSql, providerIdentity, CONTEXT);

    expect(second.outcome).toBe("existing");
    expect(second.userId).toBe(first.userId);
    expect(second.session.id).not.toBe(first.session.id);

    const auditRows = await db.select().from(auditLogs).where(sql`${auditLogs.actorUserId} = ${first.userId}`);
    expect(auditRows.filter((r) => r.eventType === "sign_up")).toHaveLength(1);
    expect(auditRows.filter((r) => r.eventType === "oauth_login_success")).toHaveLength(2);
  });

  it("stops at a conflict, creating nothing at all, when an unauthenticated login's verified email matches an existing user via a different provider", async () => {
    const email = `conflict-test-${crypto.randomUUID()}@example.com`;
    const first = await completeLogin(db, rawSql, identity({ provider: "google", email }), CONTEXT);
    createdUserIds.push(first.userId);

    await expect(completeLogin(db, rawSql, identity({ provider: "microsoft", email }), CONTEXT)).rejects.toThrow(
      IdentityConflictError
    );

    const rows = await db.select().from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`);
    expect(rows).toHaveLength(1);
    const sessionRows = await db.select().from(sessions).where(sql`${sessions.userId} = ${first.userId}`);
    expect(sessionRows).toHaveLength(1); // only the original login's session — no session for the rejected attempt
  });

  it("resolves concurrent identical signups deterministically: exactly one user/account created, both requests get a valid session, no orphans", async () => {
    const providerIdentity = identity();

    const [resultA, resultB] = await Promise.all([
      completeLogin(db, rawSql, providerIdentity, CONTEXT),
      completeLogin(db, rawSql, providerIdentity, CONTEXT),
    ]);

    expect(resultA.userId).toBe(resultB.userId);
    createdUserIds.push(resultA.userId);

    const outcomes = [resultA.outcome, resultB.outcome].sort();
    expect(outcomes).toEqual(["created", "existing"]);

    // Exactly one user, one account — no duplicates, no orphans from the losing transaction.
    const userRows = await db.select().from(users).where(sql`${users.id} = ${resultA.userId}`);
    expect(userRows).toHaveLength(1);
    const accountRows = await db.select().from(accounts).where(sql`${accounts.userId} = ${resultA.userId}`);
    expect(accountRows).toHaveLength(1);

    // Both requests got their own valid, distinct session.
    expect(resultA.session.id).not.toBe(resultB.session.id);
    const sessionRows = await db.select().from(sessions).where(sql`${sessions.userId} = ${resultA.userId}`);
    expect(sessionRows).toHaveLength(2);

    // Exactly one sign_up event (the winner's), plus one oauth_login_success per request.
    const auditRows = await db.select().from(auditLogs).where(sql`${auditLogs.actorUserId} = ${resultA.userId}`);
    expect(auditRows.filter((r) => r.eventType === "sign_up")).toHaveLength(1);
    expect(auditRows.filter((r) => r.eventType === "oauth_login_success")).toHaveLength(2);
  });
});

describe("completeLink against a real database", () => {
  it("adds a second provider account atomically with the oauth_account_linked audit event", async () => {
    const owner = await completeLogin(db, rawSql, identity({ provider: "google" }), CONTEXT);
    createdUserIds.push(owner.userId);
    const [ownerUser] = await db.select().from(users).where(sql`${users.id} = ${owner.userId}`);

    const result = await completeLink(db, rawSql, identity({ provider: "microsoft", email: ownerUser.email }), owner.userId, CONTEXT);

    expect(result).toEqual({ outcome: "linked" });

    const linkedAccounts = await db.select().from(accounts).where(sql`${accounts.userId} = ${owner.userId}`);
    expect(linkedAccounts).toHaveLength(2);
    const auditRows = await db
      .select()
      .from(auditLogs)
      .where(sql`${auditLogs.actorUserId} = ${owner.userId} AND ${auditLogs.eventType} = 'oauth_account_linked'`);
    expect(auditRows).toHaveLength(1);
  });

  it("rejects linking a provider identity that already belongs to a different real user, writing no audit event", async () => {
    const userA = await completeLogin(db, rawSql, identity({ provider: "google" }), CONTEXT);
    createdUserIds.push(userA.userId);
    const userB = await completeLogin(db, rawSql, identity({ provider: "google" }), CONTEXT);
    createdUserIds.push(userB.userId);
    const [userAAccount] = await db.select().from(accounts).where(sql`${accounts.userId} = ${userA.userId}`);

    await expect(
      completeLink(db, rawSql, identity({ provider: "google", providerAccountId: userAAccount.providerAccountId }), userB.userId, CONTEXT)
    ).rejects.toThrow(IdentityConflictError);

    const userBAccounts = await db.select().from(accounts).where(sql`${accounts.userId} = ${userB.userId}`);
    expect(userBAccounts).toHaveLength(1);
  });

  it("resolves a concurrent duplicate link request from the same user to a single linked account, no duplicate rows", async () => {
    const owner = await completeLogin(db, rawSql, identity({ provider: "google" }), CONTEXT);
    createdUserIds.push(owner.userId);
    const linkIdentity = identity({ provider: "microsoft" });

    const [resultA, resultB] = await Promise.all([
      completeLink(db, rawSql, linkIdentity, owner.userId, CONTEXT),
      completeLink(db, rawSql, linkIdentity, owner.userId, CONTEXT),
    ]);

    const outcomes = [resultA.outcome, resultB.outcome].sort();
    expect(outcomes).toEqual(["already-linked", "linked"]);

    const linkedAccounts = await db
      .select()
      .from(accounts)
      .where(sql`${accounts.userId} = ${owner.userId} AND ${accounts.provider} = 'microsoft'`);
    expect(linkedAccounts).toHaveLength(1); // no duplicate despite the race
  });
});
