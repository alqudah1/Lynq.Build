import { describe, it, expect, afterEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, auditLogs, invitations as invitationsTable, rateLimitCounters } from "@/db/schema";
import { createOrganization } from "@/lib/organizations/organizations";
import { createSession } from "@/lib/auth/session";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";
import { InMemoryEmailTransport } from "@/lib/email/test-transport";

const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (cookieStore.has(name) ? { name, value: cookieStore.get(name) } : undefined),
      set: (name: string, value: string) => cookieStore.set(name, value),
      delete: (name: string) => cookieStore.delete(name),
    }),
}));

const testTransport = new InMemoryEmailTransport();
vi.mock("@/lib/email/resend-transport", () => ({
  resolveConfiguredEmailTransport: () => testTransport,
}));

import { GET, POST } from "./route";

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `invitation-route-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}
async function authenticateAs(userId: string): Promise<void> {
  const { rawToken } = await createSession(db, { userId });
  cookieStore.set(SESSION_COOKIE_NAME, rawToken);
}
function params(organizationId: string) {
  return { params: Promise.resolve({ organizationId }) };
}

afterEach(async () => {
  cookieStore.clear();
  testTransport.sentMessages.length = 0;
  // Scoped to this route's own key prefix — a blanket `invitation:%`
  // wildcard would also delete OTHER concurrently-running integration test
  // files' in-progress rate-limit counters, since vitest runs files in
  // parallel against the same shared database.
  await db.delete(rateLimitCounters).where(sql`${rateLimitCounters.key} LIKE 'invitation:create:%'`);
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

describe("POST /api/organizations/{organizationId}/invitations", () => {
  it("returns 201 for the owner, and never includes the raw token in the response", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    await authenticateAs(ownerId);

    const res = await POST(
      new Request("https://platform.example.com/x", {
        method: "POST",
        body: JSON.stringify({ email: "invitee@example.com", role: "member" }),
      }),
      params(created.organization.id)
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.invitation.email).toBe("invitee@example.com");
    expect(JSON.stringify(body)).not.toMatch(/rawToken|tokenHash/);

    // The email transport actually received a rendered message, containing an accept URL — but the HTTP response itself never did.
    expect(testTransport.sentMessages).toHaveLength(1);
    expect(testTransport.sentMessages[0].to).toBe("invitee@example.com");
    expect(testTransport.sentMessages[0].html).toContain("/invite/");
  });

  it("returns 403 for a member", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    const memberId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId: created.organization.id, userId: memberId, role: "member" });
    await authenticateAs(memberId);

    const res = await POST(
      new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ email: "x@example.com", role: "viewer" }) }),
      params(created.organization.id)
    );
    expect(res.status).toBe(403);
  });

  it("returns 409 unauthorized_role when an admin tries to invite an owner", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    const adminId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId: created.organization.id, userId: adminId, role: "admin" });
    await authenticateAs(adminId);

    const res = await POST(
      new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ email: "x@example.com", role: "owner" }) }),
      params(created.organization.id)
    );
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.error.code).toBe("unauthorized_role");
  });

  it("returns 400 when workspaceRole is provided without workspaceId", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    await authenticateAs(ownerId);

    const res = await POST(
      new Request("https://platform.example.com/x", {
        method: "POST",
        body: JSON.stringify({ email: "x@example.com", role: "member", workspaceRole: "viewer" }),
      }),
      params(created.organization.id)
    );
    expect(res.status).toBe(400);
  });

  it("returns 429 once the per-organization-and-actor rate limit is exceeded", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    await authenticateAs(ownerId);

    let sawRateLimited = false;
    for (let i = 0; i < 30; i++) {
      const res = await POST(
        new Request("https://platform.example.com/x", {
          method: "POST",
          body: JSON.stringify({ email: `bulk-${i}@example.com`, role: "member" }),
        }),
        params(created.organization.id)
      );
      if (res.status === 429) {
        sawRateLimited = true;
        break;
      }
    }
    expect(sawRateLimited).toBe(true);
  }, 30000);
});

describe("GET /api/organizations/{organizationId}/invitations", () => {
  it("returns 401 when unauthenticated", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);

    const res = await GET(new Request("https://platform.example.com/x"), params(created.organization.id));
    expect(res.status).toBe(401);
  });
});
