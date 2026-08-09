import { describe, it, expect, afterEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, auditLogs } from "@/db/schema";
import { createOrganization } from "@/lib/organizations/organizations";
import { createWorkspace } from "@/lib/workspaces/workspaces";
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
  const [user] = await db.insert(users).values({ email: `ws-members-route-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}
async function authenticateAs(userId: string): Promise<void> {
  const { rawToken } = await createSession(db, { userId });
  cookieStore.set(SESSION_COOKIE_NAME, rawToken);
}
function params(organizationId: string, workspaceId: string) {
  return { params: Promise.resolve({ organizationId, workspaceId }) };
}
async function makeOrgWithWorkspace() {
  const ownerId = await makeUser();
  const org = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
  createdOrgIds.push(org.organization.id);
  const ws = await createWorkspace(db, rawSql, { organizationId: org.organization.id, actorUserId: ownerId, name: "Marketing", slug: "marketing" });
  return { organizationId: org.organization.id, workspaceId: ws.workspace.id, ownerId };
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

describe("POST /api/organizations/{organizationId}/workspaces/{workspaceId}/members", () => {
  it("returns 409 parent_membership_required for a user outside the organization", async () => {
    const { organizationId, workspaceId, ownerId } = await makeOrgWithWorkspace();
    await authenticateAs(ownerId);
    const outsiderId = await makeUser();

    const res = await POST(
      new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ userId: outsiderId, role: "member" }) }),
      params(organizationId, workspaceId)
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.code).toBe("parent_membership_required");
  });

  it("returns 201 for a valid add by the workspace manager", async () => {
    const { organizationId, workspaceId, ownerId } = await makeOrgWithWorkspace();
    await authenticateAs(ownerId);
    const targetId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: targetId, role: "member" });

    const res = await POST(
      new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ userId: targetId, role: "viewer" }) }),
      params(organizationId, workspaceId)
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.role).toBe("viewer");
  });
});

describe("GET /api/organizations/{organizationId}/workspaces/{workspaceId}/members", () => {
  it("returns 200 with the roster for the manager", async () => {
    const { organizationId, workspaceId, ownerId } = await makeOrgWithWorkspace();
    await authenticateAs(ownerId);

    const res = await GET(new Request("https://platform.example.com/x"), params(organizationId, workspaceId));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([{ userId: ownerId, email: expect.any(String), name: null, role: "manager" }]);
  });
});
