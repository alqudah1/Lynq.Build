import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, invitations as invitationsTable, auditLogs, rateLimitCounters } from "@/db/schema";
import { createOrganization } from "@/lib/organizations/organizations";
import { createOrRefreshInvitation } from "@/lib/invitations/invitations";
import { createSession } from "@/lib/auth/session";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";
import { setInvitationContinuationCookie, INVITATION_CONTINUATION_COOKIE_NAME } from "@/lib/invitations/continuation";
import { hashInvitationToken } from "@/lib/invitations/tokens";
import { TEST_AUTH_SECRET as TEST_SECRET } from "../../../../../../test/support/invitation-secret";

const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (cookieStore.has(name) ? { name, value: cookieStore.get(name) } : undefined),
      set: (name: string, value: string) => cookieStore.set(name, value),
      delete: (name: string) => cookieStore.delete(name),
    }),
}));

import { POST } from "./route";

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(email?: string): Promise<string> {
  const [user] = await db.insert(users).values({ email: email ?? `current-accept-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}
async function authenticateAs(userId: string): Promise<void> {
  const { rawToken } = await createSession(db, { userId });
  cookieStore.set(SESSION_COOKIE_NAME, rawToken);
}
function makeRequest() {
  return new Request("https://platform.example.com/api/invitations/current/accept", { method: "POST" });
}

beforeEach(() => {
  process.env.AUTH_SECRET = TEST_SECRET;
});

afterEach(async () => {
  cookieStore.clear();
  // Scoped to this route's own key prefix — see the exchange-route test's
  // identical comment for why a blanket `invitation:%` wildcard is unsafe
  // under vitest's parallel file execution.
  await db.delete(rateLimitCounters).where(sql`${rateLimitCounters.key} LIKE 'invitation:current-accept:%'`);
  while (createdOrgIds.length > 0) {
    const id = createdOrgIds.pop()!;
    await db.delete(auditLogs).where(sql`${auditLogs.organizationId} = ${id}`);
    await db.delete(invitationsTable).where(sql`${invitationsTable.organizationId} = ${id}`);
    await db.delete(organizations).where(sql`${organizations.id} = ${id}`);
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await db.delete(users).where(sql`${users.id} = ${id}`);
  }
});

describe("POST /api/invitations/current/accept", () => {
  it("accepts for an authenticated matching user and clears the continuation cookie", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    const inviteeEmail = `current-accept-invitee-${crypto.randomUUID()}@example.com`;
    const invite = await createOrRefreshInvitation(db, rawSql, { organizationId: created.organization.id, actorUserId: ownerId, email: inviteeEmail, role: "member" });
    const inviteeId = await makeUser(inviteeEmail);
    await authenticateAs(inviteeId);
    await setInvitationContinuationCookie(hashInvitationToken(invite.rawToken), TEST_SECRET);

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.outcome).toBe("accepted");
    expect(cookieStore.has(INVITATION_CONTINUATION_COOKIE_NAME)).toBe(false);

    const [membership] = await db
      .select()
      .from(organizationMemberships)
      .where(sql`${organizationMemberships.organizationId} = ${created.organization.id} AND ${organizationMemberships.userId} = ${inviteeId}`);
    expect(membership.role).toBe("member");
  });

  it("returns 200 oauth_required when unauthenticated, without consuming the cookie", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    const invite = await createOrRefreshInvitation(db, rawSql, { organizationId: created.organization.id, actorUserId: ownerId, email: "new-user@example.com", role: "member" });
    await setInvitationContinuationCookie(hashInvitationToken(invite.rawToken), TEST_SECRET);

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.status).toBe("oauth_required");
    expect(cookieStore.has(INVITATION_CONTINUATION_COOKIE_NAME)).toBe(true);
  });

  it("returns 404 no_active_invitation when no continuation cookie is present", async () => {
    const userId = await makeUser();
    await authenticateAs(userId);

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("no_active_invitation");
  });

  it("clears the cookie on a terminal failure (email mismatch)", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    const invite = await createOrRefreshInvitation(db, rawSql, { organizationId: created.organization.id, actorUserId: ownerId, email: `intended-${crypto.randomUUID()}@example.com`, role: "member" });
    const wrongUserId = await makeUser();
    await authenticateAs(wrongUserId);
    await setInvitationContinuationCookie(hashInvitationToken(invite.rawToken), TEST_SECRET);

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("email_mismatch");
    expect(cookieStore.has(INVITATION_CONTINUATION_COOKIE_NAME)).toBe(false);
  });

  it("replaying accept after success resolves idempotently (already_member), never a duplicate membership", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    const inviteeEmail = `replay-accept-${crypto.randomUUID()}@example.com`;
    const invite = await createOrRefreshInvitation(db, rawSql, { organizationId: created.organization.id, actorUserId: ownerId, email: inviteeEmail, role: "member" });
    const inviteeId = await makeUser(inviteeEmail);
    await authenticateAs(inviteeId);

    await setInvitationContinuationCookie(hashInvitationToken(invite.rawToken), TEST_SECRET);
    const first = await POST(makeRequest());
    expect((await first.json()).data.outcome).toBe("accepted");

    // Re-set the cookie to simulate a replayed request still carrying the original (already-cleared) value.
    await setInvitationContinuationCookie(hashInvitationToken(invite.rawToken), TEST_SECRET);
    const second = await POST(makeRequest());
    const secondBody = await second.json();

    expect(second.status).toBe(200);
    expect(secondBody.data.outcome).toBe("already_member");

    const rows = await db
      .select()
      .from(organizationMemberships)
      .where(sql`${organizationMemberships.organizationId} = ${created.organization.id} AND ${organizationMemberships.userId} = ${inviteeId}`);
    expect(rows).toHaveLength(1);
  });
});
