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

import { GET, POST } from "./route";

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `ws-route-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
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

describe("POST /api/organizations/{organizationId}/workspaces", () => {
  it("returns 403 for a member (not owner/admin)", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    const memberId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId: created.organization.id, userId: memberId, role: "member" });
    await authenticateAs(memberId);

    const res = await POST(
      new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ name: "Marketing", slug: "marketing" }) }),
      params(created.organization.id)
    );
    expect(res.status).toBe(403);
  });

  it("returns 201 with the workspace and creator's manager membership", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    await authenticateAs(ownerId);

    const res = await POST(
      new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ name: "Marketing", slug: "marketing" }) }),
      params(created.organization.id)
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.workspace.organizationId).toBe(created.organization.id);
    expect(body.data.creatorMembership.role).toBe("manager");
  });
});

describe("GET /api/organizations/{organizationId}/workspaces", () => {
  it("lists only workspaces with an explicit membership, scoped to this organization", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    await authenticateAs(ownerId);
    await POST(
      new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ name: "Marketing", slug: "marketing" }) }),
      params(created.organization.id)
    );

    const res = await GET(new Request("https://platform.example.com/x"), params(created.organization.id));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].organizationId).toBe(created.organization.id);
  });
});
