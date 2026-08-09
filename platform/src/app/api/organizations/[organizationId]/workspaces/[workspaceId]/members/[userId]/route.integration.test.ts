import { describe, it, expect, afterEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, auditLogs } from "@/db/schema";
import { createOrganization } from "@/lib/organizations/organizations";
import { createWorkspace } from "@/lib/workspaces/workspaces";
import { addWorkspaceMember } from "@/lib/workspaces/memberships";
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
  const [user] = await db.insert(users).values({ email: `ws-member-id-route-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}
async function authenticateAs(userId: string): Promise<void> {
  const { rawToken } = await createSession(db, { userId });
  cookieStore.set(SESSION_COOKIE_NAME, rawToken);
}
function params(organizationId: string, workspaceId: string, userId: string) {
  return { params: Promise.resolve({ organizationId, workspaceId, userId }) };
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

describe("PATCH /api/organizations/{organizationId}/workspaces/{workspaceId}/members/{userId}", () => {
  it("returns 409 self_role_change", async () => {
    const { organizationId, workspaceId, ownerId } = await makeOrgWithWorkspace();
    await authenticateAs(ownerId);

    const res = await PATCH(
      new Request("https://platform.example.com/x", { method: "PATCH", body: JSON.stringify({ role: "member" }) }),
      params(organizationId, workspaceId, ownerId)
    );
    expect(res.status).toBe(409);
  });

  it("returns 200 for a legitimate role change", async () => {
    const { organizationId, workspaceId, ownerId } = await makeOrgWithWorkspace();
    await authenticateAs(ownerId);
    const targetId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: targetId, role: "member" });
    await addWorkspaceMember(db, rawSql, { workspaceId, organizationId, actorUserId: ownerId, targetUserId: targetId, role: "viewer" });

    const res = await PATCH(
      new Request("https://platform.example.com/x", { method: "PATCH", body: JSON.stringify({ role: "member" }) }),
      params(organizationId, workspaceId, targetId)
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.role).toBe("member");
  });
});

describe("DELETE /api/organizations/{organizationId}/workspaces/{workspaceId}/members/{userId}", () => {
  it("returns 204 for a valid removal by the manager", async () => {
    const { organizationId, workspaceId, ownerId } = await makeOrgWithWorkspace();
    await authenticateAs(ownerId);
    const targetId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: targetId, role: "member" });
    await addWorkspaceMember(db, rawSql, { workspaceId, organizationId, actorUserId: ownerId, targetUserId: targetId, role: "viewer" });

    const res = await DELETE(new Request("https://platform.example.com/x", { method: "DELETE" }), params(organizationId, workspaceId, targetId));
    expect(res.status).toBe(204);
  });

  it("returns 401 when unauthenticated", async () => {
    const { organizationId, workspaceId } = await makeOrgWithWorkspace();
    const targetId = await makeUser();

    const res = await DELETE(new Request("https://platform.example.com/x", { method: "DELETE" }), params(organizationId, workspaceId, targetId));
    expect(res.status).toBe(401);
  });
});
