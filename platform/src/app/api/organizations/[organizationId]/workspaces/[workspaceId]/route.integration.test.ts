import { describe, it, expect, afterEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, workspaceMemberships, auditLogs } from "@/db/schema";
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

import { GET, PATCH, DELETE } from "./route";

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `ws-id-route-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
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

describe("GET /api/organizations/{organizationId}/workspaces/{workspaceId}", () => {
  it("returns 404 for an org member with no explicit workspace membership", async () => {
    const { organizationId, workspaceId } = await makeOrgWithWorkspace();
    const orgAdminId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: orgAdminId, role: "admin" });
    await authenticateAs(orgAdminId);

    const res = await GET(new Request("https://platform.example.com/x"), params(organizationId, workspaceId));
    expect(res.status).toBe(404);
  });

  it("returns 404 when the organizationId in the URL doesn't match the workspace's real parent", async () => {
    const { workspaceId, ownerId } = await makeOrgWithWorkspace();
    const otherOrgOwnerId = await makeUser();
    const otherOrg = await createOrganization(rawSql, { name: "Other", slug: `other-${crypto.randomUUID()}`, ownerUserId: otherOrgOwnerId });
    createdOrgIds.push(otherOrg.organization.id);
    await authenticateAs(ownerId);

    const res = await GET(new Request("https://platform.example.com/x"), params(otherOrg.organization.id, workspaceId));
    expect(res.status).toBe(404);
  });

  it("returns 200 for the workspace's own manager", async () => {
    const { organizationId, workspaceId, ownerId } = await makeOrgWithWorkspace();
    await authenticateAs(ownerId);

    const res = await GET(new Request("https://platform.example.com/x"), params(organizationId, workspaceId));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.workspace.id).toBe(workspaceId);
  });
});

describe("PATCH /api/organizations/{organizationId}/workspaces/{workspaceId}", () => {
  it("returns 200 when an organization admin updates via the admin-override", async () => {
    const { organizationId, workspaceId } = await makeOrgWithWorkspace();
    const adminId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: adminId, role: "admin" });
    await authenticateAs(adminId);

    const res = await PATCH(
      new Request("https://platform.example.com/x", { method: "PATCH", body: JSON.stringify({ name: "Growth" }) }),
      params(organizationId, workspaceId)
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.name).toBe("Growth");
  });
});

describe("DELETE /api/organizations/{organizationId}/workspaces/{workspaceId}", () => {
  it("returns 409 workspace_deletion_not_permitted for the workspace's own manager", async () => {
    const { organizationId, workspaceId } = await makeOrgWithWorkspace();
    const managerOnlyId = await makeUser();
    await db.insert(workspaceMemberships).values({ workspaceId, userId: managerOnlyId, role: "manager" });
    await authenticateAs(managerOnlyId);

    const res = await DELETE(new Request("https://platform.example.com/x", { method: "DELETE" }), params(organizationId, workspaceId));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.code).toBe("workspace_deletion_not_permitted");
  });

  it("returns 204 for the organization owner", async () => {
    const { organizationId, workspaceId, ownerId } = await makeOrgWithWorkspace();
    await authenticateAs(ownerId);

    const res = await DELETE(new Request("https://platform.example.com/x", { method: "DELETE" }), params(organizationId, workspaceId));
    expect(res.status).toBe(204);
  });
});
