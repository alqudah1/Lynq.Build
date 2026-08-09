import { describe, it, expect, afterEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
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

import { PATCH, DELETE } from "./route";

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `org-member-id-route-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}
async function authenticateAs(userId: string): Promise<void> {
  const { rawToken } = await createSession(db, { userId });
  cookieStore.set(SESSION_COOKIE_NAME, rawToken);
}
function params(organizationId: string, userId: string) {
  return { params: Promise.resolve({ organizationId, userId }) };
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

describe("PATCH /api/organizations/{organizationId}/members/{userId}", () => {
  it("returns 409 self_role_change when the actor targets themselves", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    await authenticateAs(ownerId);

    const res = await PATCH(
      new Request("https://platform.example.com/x", { method: "PATCH", body: JSON.stringify({ role: "admin" }) }),
      params(created.organization.id, ownerId)
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.code).toBe("self_role_change");
  });

  it("returns 409 admin_cannot_act_on_owner", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    const adminId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId: created.organization.id, userId: adminId, role: "admin" });
    await authenticateAs(adminId);

    const res = await PATCH(
      new Request("https://platform.example.com/x", { method: "PATCH", body: JSON.stringify({ role: "member" }) }),
      params(created.organization.id, ownerId)
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.code).toBe("admin_cannot_act_on_owner");
  });

  it("returns 200 with the changed role for a legitimate promotion", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    const memberId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId: created.organization.id, userId: memberId, role: "member" });
    await authenticateAs(ownerId);

    const res = await PATCH(
      new Request("https://platform.example.com/x", { method: "PATCH", body: JSON.stringify({ role: "admin" }) }),
      params(created.organization.id, memberId)
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.role).toBe("admin");
  });
});

describe("DELETE /api/organizations/{organizationId}/members/{userId}", () => {
  it("returns 409 last_owner when removing the final owner", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    await authenticateAs(ownerId);

    const res = await DELETE(new Request("https://platform.example.com/x", { method: "DELETE" }), params(created.organization.id, ownerId));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.code).toBe("last_owner");
  });

  it("returns 204 when an owner removes a plain member", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    const memberId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId: created.organization.id, userId: memberId, role: "member" });
    await authenticateAs(ownerId);

    const res = await DELETE(new Request("https://platform.example.com/x", { method: "DELETE" }), params(created.organization.id, memberId));
    expect(res.status).toBe(204);
  });
});
