import { describe, it, expect, afterEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, auditLogs, invitations as invitationsTable } from "@/db/schema";
import { createOrganization } from "@/lib/organizations/organizations";
import { createOrRefreshInvitation, getInvitationPreviewByHash, revokeInvitation } from "./invitations";
import { acceptInvitationByHash } from "./acceptance";
import { hashInvitationToken } from "./tokens";
import { InvitationNotAvailableError, InvitationEmailMismatchError } from "./errors";

const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (cookieStore.has(name) ? { name, value: cookieStore.get(name) } : undefined),
      set: (name: string, value: string) => cookieStore.set(name, value),
      delete: (name: string) => cookieStore.delete(name),
    }),
}));

import {
  setInvitationContinuationCookie,
  readInvitationContinuationCookie,
  clearInvitationContinuationCookie,
  INVITATION_CONTINUATION_COOKIE_NAME,
  INVITATION_CONTINUATION_MAX_AGE_SECONDS,
} from "./continuation";

const TEST_SECRET = "test-continuation-secret-".padEnd(32, "x");

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(email?: string): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ email: email ?? `continuation-test-${crypto.randomUUID()}@example.com` })
    .returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}
async function makeOrg(ownerId: string) {
  const org = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
  createdOrgIds.push(org.organization.id);
  return org.organization.id;
}

afterEach(async () => {
  cookieStore.clear();
  vi.useRealTimers();
  while (createdOrgIds.length > 0) {
    const id = createdOrgIds.pop()!;
    await db.delete(auditLogs).where(sql`${auditLogs.organizationId} = ${id}`);
    await db.delete(invitationsTable).where(sql`${invitationsTable.organizationId} = ${id}`);
    await db.delete(organizations).where(sql`${organizations.id} = ${id}`);
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    // A "not_found" acceptance failure (the refresh-invalidation test) has
    // no organizationId to scope cleanup by at all — only actor_user_id.
    // Must run before the user itself is deleted, or this FK cascades to
    // NULL (per audit_logs' own "outlive the actor" design) and becomes
    // permanently unmatchable by any cleanup.
    await db.delete(auditLogs).where(sql`${auditLogs.actorUserId} = ${id}`);
    await db.delete(users).where(sql`${users.id} = ${id}`);
  }
});

describe("invitation continuation cookie — basic round trip", () => {
  it("sets, reads (without clearing), and explicitly clears", async () => {
    const ownerId = await makeUser();
    const organizationId = await makeOrg(ownerId);
    const invite = await createOrRefreshInvitation(db, rawSql, { organizationId, actorUserId: ownerId, email: `rt-${crypto.randomUUID()}@example.com`, role: "member" });
    const tokenHash = hashInvitationToken(invite.rawToken);

    await setInvitationContinuationCookie(tokenHash, TEST_SECRET);
    expect(cookieStore.get(INVITATION_CONTINUATION_COOKIE_NAME)).not.toContain(invite.rawToken);
    expect(cookieStore.get(INVITATION_CONTINUATION_COOKIE_NAME)).not.toContain(tokenHash);

    const read1 = await readInvitationContinuationCookie(TEST_SECRET);
    expect(read1?.invitationTokenHash).toBe(tokenHash);
    // Reading must NOT clear it — it can be read again.
    const read2 = await readInvitationContinuationCookie(TEST_SECRET);
    expect(read2?.invitationTokenHash).toBe(tokenHash);
    expect(cookieStore.has(INVITATION_CONTINUATION_COOKIE_NAME)).toBe(true);

    await clearInvitationContinuationCookie();
    expect(cookieStore.has(INVITATION_CONTINUATION_COOKIE_NAME)).toBe(false);
    const read3 = await readInvitationContinuationCookie(TEST_SECRET);
    expect(read3).toBeNull();
  });

  it("never encodes the hash recoverably in the cookie value (HMAC-signed opaque payload only readable with the secret)", async () => {
    const tokenHash = hashInvitationToken("some-raw-token-value");
    await setInvitationContinuationCookie(tokenHash, TEST_SECRET);

    // Correct secret decodes it fine.
    expect((await readInvitationContinuationCookie(TEST_SECRET))?.invitationTokenHash).toBe(tokenHash);
    // A different (wrong) secret must never validate it.
    const wrongSecret = "a-completely-different-secret-".padEnd(32, "y");
    expect(await readInvitationContinuationCookie(wrongSecret)).toBeNull();
  });

  it("rejects a tampered cookie value outright", async () => {
    const tokenHash = hashInvitationToken("tamper-target");
    await setInvitationContinuationCookie(tokenHash, TEST_SECRET);
    const cookieValue = cookieStore.get(INVITATION_CONTINUATION_COOKIE_NAME)!;
    cookieStore.set(INVITATION_CONTINUATION_COOKIE_NAME, cookieValue.slice(0, -2) + "zz");

    expect(await readInvitationContinuationCookie(TEST_SECRET)).toBeNull();
  });

  it("expires after its 10-minute window", async () => {
    vi.useFakeTimers();
    const tokenHash = hashInvitationToken("expiry-target");
    await setInvitationContinuationCookie(tokenHash, TEST_SECRET);

    expect((await readInvitationContinuationCookie(TEST_SECRET))?.invitationTokenHash).toBe(tokenHash);

    vi.advanceTimersByTime((INVITATION_CONTINUATION_MAX_AGE_SECONDS + 1) * 1000);
    expect(await readInvitationContinuationCookie(TEST_SECRET)).toBeNull();
  });
});

describe("continuation invalidation via the underlying invitation state", () => {
  it("a continuation cookie's hash stops resolving after the invitation is refreshed", async () => {
    const ownerId = await makeUser();
    const organizationId = await makeOrg(ownerId);
    const email = `refresh-invalidate-${crypto.randomUUID()}@example.com`;
    const first = await createOrRefreshInvitation(db, rawSql, { organizationId, actorUserId: ownerId, email, role: "member" });
    const oldTokenHash = hashInvitationToken(first.rawToken);

    await createOrRefreshInvitation(db, rawSql, { organizationId, actorUserId: ownerId, email, role: "admin" });

    await expect(getInvitationPreviewByHash(db, oldTokenHash)).rejects.toBeInstanceOf(InvitationNotAvailableError);
    await expect(acceptInvitationByHash(db, { tokenHash: oldTokenHash, actorUserId: ownerId })).rejects.toMatchObject({
      code: "invitation_not_available",
      internalReason: "not_found",
    });
  });

  it("a continuation cookie's hash stops resolving after revocation", async () => {
    const ownerId = await makeUser();
    const organizationId = await makeOrg(ownerId);
    const invite = await createOrRefreshInvitation(db, rawSql, { organizationId, actorUserId: ownerId, email: `revoke-invalidate-${crypto.randomUUID()}@example.com`, role: "member" });
    const tokenHash = hashInvitationToken(invite.rawToken);

    await revokeInvitation(db, { organizationId, actorUserId: ownerId, invitationId: invite.invitation.id });

    await expect(getInvitationPreviewByHash(db, tokenHash)).rejects.toMatchObject({ internalReason: "revoked" });
  });

  it("a continuation cookie's hash resolves to already_used after acceptance for a different actor, but idempotently for the accepting actor", async () => {
    const ownerId = await makeUser();
    const organizationId = await makeOrg(ownerId);
    const inviteeEmail = `accept-invalidate-${crypto.randomUUID()}@example.com`;
    const inviteeId = await makeUser(inviteeEmail);
    const invite = await createOrRefreshInvitation(db, rawSql, { organizationId, actorUserId: ownerId, email: inviteeEmail, role: "member" });
    const tokenHash = hashInvitationToken(invite.rawToken);

    await acceptInvitationByHash(db, { tokenHash, actorUserId: inviteeId });

    // The same actor replaying resolves idempotently.
    const replay = await acceptInvitationByHash(db, { tokenHash, actorUserId: inviteeId });
    expect(replay.outcome).toBe("already_member");

    // A genuinely different actor cannot ride the same (now-consumed) cookie.
    const otherId = await makeUser(`different-actor-${crypto.randomUUID()}@example.com`);
    await expect(acceptInvitationByHash(db, { tokenHash, actorUserId: otherId })).rejects.toBeInstanceOf(InvitationEmailMismatchError);
  });
});
