import { describe, it, expect, afterEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { neon } from "@neondatabase/serverless";
import { users, organizations, organizationMemberships, auditLogs } from "@/db/schema";
import { createOrganization } from "@/lib/organizations/organizations";
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

import { GET, PATCH, DELETE } from "./route";

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `org-id-route-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
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
  while (createdOrgIds.length > 0) {
    const id = createdOrgIds.pop()!;
    await db.delete(auditLogs).where(sql`${auditLogs.organizationId} = ${id}`);
    await db.delete(organizations).where(sql`${organizations.id} = ${id}`);
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await db.delete(users).where(sql`${users.id} = ${id}`);
  }
});

describe("GET /api/organizations/{organizationId}", () => {
  it("returns 400 for a non-UUID path parameter", async () => {
    const userId = await makeUser();
    await authenticateAs(userId);
    const res = await GET(new Request("https://platform.example.com/api/organizations/not-a-uuid"), params("not-a-uuid"));
    expect(res.status).toBe(400);
  });

  it("returns 404 (never 403) for an organization the user doesn't belong to", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    const outsiderId = await makeUser();
    await authenticateAs(outsiderId);

    const res = await GET(new Request("https://platform.example.com/x"), params(created.organization.id));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("not_found");
  });

  it("returns 200 with the organization and membership for a real member", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    await authenticateAs(ownerId);

    const res = await GET(new Request("https://platform.example.com/x"), params(created.organization.id));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.organization.id).toBe(created.organization.id);
    expect(body.data.membership.role).toBe("owner");
  });
});

describe("PATCH /api/organizations/{organizationId}", () => {
  it("returns 400 when no fields are provided", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    await authenticateAs(ownerId);

    const res = await PATCH(
      new Request("https://platform.example.com/x", { method: "PATCH", body: JSON.stringify({}) }),
      params(created.organization.id)
    );
    expect(res.status).toBe(400);
  });

  it("returns 403 for a viewer attempting to update", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    const viewerId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId: created.organization.id, userId: viewerId, role: "viewer" });
    await authenticateAs(viewerId);

    const res = await PATCH(
      new Request("https://platform.example.com/x", { method: "PATCH", body: JSON.stringify({ name: "x" }) }),
      params(created.organization.id)
    );
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("forbidden");
  });

  it("returns 200 with the updated organization for an owner", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    await authenticateAs(ownerId);

    const res = await PATCH(
      new Request("https://platform.example.com/x", { method: "PATCH", body: JSON.stringify({ name: "Acme Corp" }) }),
      params(created.organization.id)
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.name).toBe("Acme Corp");
  });
});

describe("DELETE /api/organizations/{organizationId}", () => {
  it("returns 403 for an admin (not owner) attempting to delete", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    const adminId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId: created.organization.id, userId: adminId, role: "admin" });
    await authenticateAs(adminId);

    const res = await DELETE(new Request("https://platform.example.com/x", { method: "DELETE" }), params(created.organization.id));
    expect(res.status).toBe(403);
  });

  it("returns 204 for an owner, and the organization is then gone from GET", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    await authenticateAs(ownerId);

    const deleteRes = await DELETE(new Request("https://platform.example.com/x", { method: "DELETE" }), params(created.organization.id));
    expect(deleteRes.status).toBe(204);

    const getRes = await GET(new Request("https://platform.example.com/x"), params(created.organization.id));
    expect(getRes.status).toBe(404);
  });
});
