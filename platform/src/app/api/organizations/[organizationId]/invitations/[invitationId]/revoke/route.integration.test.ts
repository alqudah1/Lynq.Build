import { describe, it, expect, afterEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, invitations as invitationsTable, auditLogs } from "@/db/schema";
import { createOrganization } from "@/lib/organizations/organizations";
import { createOrRefreshInvitation } from "@/lib/invitations/invitations";
import { createSession } from "@/lib/auth/session";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";

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

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `revoke-route-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}
async function authenticateAs(userId: string): Promise<void> {
  const { rawToken } = await createSession(db, { userId });
  cookieStore.set(SESSION_COOKIE_NAME, rawToken);
}
function params(organizationId: string, invitationId: string) {
  return { params: Promise.resolve({ organizationId, invitationId }) };
}

afterEach(async () => {
  cookieStore.clear();
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

describe("POST /api/organizations/{organizationId}/invitations/{invitationId}/revoke", () => {
  it("returns 200 for the owner and marks the invitation revoked", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    const invite = await createOrRefreshInvitation(db, rawSql, {
      organizationId: created.organization.id,
      actorUserId: ownerId,
      email: "revoke-me@example.com",
      role: "member",
    });
    await authenticateAs(ownerId);

    const res = await POST(new Request("https://platform.example.com/x", { method: "POST" }), params(created.organization.id, invite.invitation.id));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.revoked).toBe(true);
  });

  it("returns 409 already_used when revoking a second time", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    const invite = await createOrRefreshInvitation(db, rawSql, {
      organizationId: created.organization.id,
      actorUserId: ownerId,
      email: "revoke-twice@example.com",
      role: "member",
    });
    await authenticateAs(ownerId);

    await POST(new Request("https://platform.example.com/x", { method: "POST" }), params(created.organization.id, invite.invitation.id));
    const res = await POST(new Request("https://platform.example.com/x", { method: "POST" }), params(created.organization.id, invite.invitation.id));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.code).toBe("already_used");
  });

  it("returns 401 when unauthenticated", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    const invite = await createOrRefreshInvitation(db, rawSql, {
      organizationId: created.organization.id,
      actorUserId: ownerId,
      email: "unauth@example.com",
      role: "member",
    });

    const res = await POST(new Request("https://platform.example.com/x", { method: "POST" }), params(created.organization.id, invite.invitation.id));
    expect(res.status).toBe(401);
  });
});
