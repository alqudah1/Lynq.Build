import { describe, it, expect, afterEach } from "vitest";
import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, workspaceMemberships, auditLogs } from "@/db/schema";
import { createOrganization } from "@/lib/organizations/organizations";
import { createWorkspace } from "./workspaces";
import { addWorkspaceMember, removeWorkspaceMember, changeWorkspaceRole, listWorkspaceMembers } from "./memberships";
import { SelfRoleChangeViolationError, ParentMembershipRequiredViolationError, TenantResourceNotFoundError } from "@/lib/authz/errors";

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `ws-membership-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithWorkspace() {
  const ownerId = await makeUser();
  const org = await createOrganization(rawSql, { name: "Org", slug: `org-${crypto.randomUUID()}`, ownerUserId: ownerId });
  createdOrgIds.push(org.organization.id);
  const ws = await createWorkspace(db, rawSql, { organizationId: org.organization.id, actorUserId: ownerId, name: "WS", slug: "ws" });
  return { organizationId: org.organization.id, workspaceId: ws.workspace.id, ownerId };
}

afterEach(async () => {
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

describe("addWorkspaceMember", () => {
  it("allows the workspace manager to add a member who already belongs to the parent organization", async () => {
    const { organizationId, workspaceId, ownerId } = await makeOrgWithWorkspace();
    const targetId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: targetId, role: "member" });

    const result = await addWorkspaceMember(db, rawSql, { workspaceId, organizationId, actorUserId: ownerId, targetUserId: targetId, role: "member" });

    expect(result.role).toBe("member");
  });

  it("rejects adding someone who has no membership in the parent organization", async () => {
    const { organizationId, workspaceId, ownerId } = await makeOrgWithWorkspace();
    const outsiderId = await makeUser(); // never added to the organization

    await expect(
      addWorkspaceMember(db, rawSql, { workspaceId, organizationId, actorUserId: ownerId, targetUserId: outsiderId, role: "member" })
    ).rejects.toThrow(ParentMembershipRequiredViolationError);
  });

  it("allows an organization admin to add a workspace member via the admin-override, without an explicit workspace membership", async () => {
    const { organizationId, workspaceId } = await makeOrgWithWorkspace();
    const adminId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: adminId, role: "admin" });
    const targetId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: targetId, role: "member" });

    const result = await addWorkspaceMember(db, rawSql, { workspaceId, organizationId, actorUserId: adminId, targetUserId: targetId, role: "viewer" });

    expect(result.role).toBe("viewer");
  });

  it("rejects a plain workspace member (not manager) from adding another member", async () => {
    const { organizationId, workspaceId } = await makeOrgWithWorkspace();
    const memberId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: memberId, role: "member" });
    await db.insert(workspaceMemberships).values({ workspaceId, userId: memberId, role: "member" });
    const targetId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: targetId, role: "member" });

    await expect(
      addWorkspaceMember(db, rawSql, { workspaceId, organizationId, actorUserId: memberId, targetUserId: targetId, role: "member" })
    ).rejects.toThrow();
  });
});

describe("removeWorkspaceMember", () => {
  it("allows the manager to remove a member", async () => {
    const { organizationId, workspaceId, ownerId } = await makeOrgWithWorkspace();
    const targetId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: targetId, role: "member" });
    await addWorkspaceMember(db, rawSql, { workspaceId, organizationId, actorUserId: ownerId, targetUserId: targetId, role: "member" });

    await removeWorkspaceMember(db, rawSql, { workspaceId, organizationId, actorUserId: ownerId, targetUserId: targetId });

    const rows = await db.select().from(workspaceMemberships).where(sql`${workspaceMemberships.workspaceId} = ${workspaceId} AND ${workspaceMemberships.userId} = ${targetId}`);
    expect(rows).toHaveLength(0);
  });
});

describe("changeWorkspaceRole", () => {
  it("rejects a user changing their own workspace role", async () => {
    const { organizationId, workspaceId, ownerId } = await makeOrgWithWorkspace();

    await expect(
      changeWorkspaceRole(db, rawSql, { workspaceId, organizationId, actorUserId: ownerId, targetUserId: ownerId, newRole: "member" })
    ).rejects.toThrow(SelfRoleChangeViolationError);
  });

  it("allows the manager to change another member's role", async () => {
    const { organizationId, workspaceId, ownerId } = await makeOrgWithWorkspace();
    const targetId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: targetId, role: "member" });
    await addWorkspaceMember(db, rawSql, { workspaceId, organizationId, actorUserId: ownerId, targetUserId: targetId, role: "viewer" });

    const result = await changeWorkspaceRole(db, rawSql, { workspaceId, organizationId, actorUserId: ownerId, targetUserId: targetId, newRole: "member" });

    expect(result.role).toBe("member");
  });
});

describe("listWorkspaceMembers", () => {
  it("allows any explicit workspace member, including a viewer, to view the roster", async () => {
    const { organizationId, workspaceId, ownerId } = await makeOrgWithWorkspace();
    const viewerId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: viewerId, role: "member" });
    await addWorkspaceMember(db, rawSql, { workspaceId, organizationId, actorUserId: ownerId, targetUserId: viewerId, role: "viewer" });

    const list = await listWorkspaceMembers(db, workspaceId, organizationId, viewerId);

    expect(list.map((m) => m.userId).sort()).toEqual([ownerId, viewerId].sort());
  });

  it("allows an organization admin to view the roster via the admin-override, without an explicit workspace membership", async () => {
    const { organizationId, workspaceId } = await makeOrgWithWorkspace();
    const adminId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: adminId, role: "admin" });

    const list = await listWorkspaceMembers(db, workspaceId, organizationId, adminId);
    expect(Array.isArray(list)).toBe(true);
  });

  it("rejects a user with no relationship to the workspace or organization at all", async () => {
    const { organizationId, workspaceId } = await makeOrgWithWorkspace();
    const outsiderId = await makeUser();

    await expect(listWorkspaceMembers(db, workspaceId, organizationId, outsiderId)).rejects.toThrow(TenantResourceNotFoundError);
  });
});
