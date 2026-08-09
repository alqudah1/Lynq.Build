import { describe, it, expect, afterEach } from "vitest";
import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, workspaces, workspaceMemberships, auditLogs } from "@/db/schema";
import { createOrganization } from "@/lib/organizations/organizations";
import {
  createWorkspace,
  getWorkspaceForUser,
  getWorkspaceBySlugForUser,
  updateWorkspace,
  softDeleteWorkspace,
  listWorkspacesForUser,
} from "./workspaces";
import { TenantResourceNotFoundError, InsufficientRoleError, WorkspaceDeletionNotPermittedError } from "@/lib/authz/errors";

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `ws-svc-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(): Promise<{ organizationId: string; ownerId: string }> {
  const ownerId = await makeUser();
  const created = await createOrganization(rawSql, { name: "Test Org", slug: `org-${crypto.randomUUID()}`, ownerUserId: ownerId });
  createdOrgIds.push(created.organization.id);
  return { organizationId: created.organization.id, ownerId };
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

describe("createWorkspace against a real database", () => {
  it("only an organization owner/admin may create a workspace; the creator becomes an explicit manager", async () => {
    const { organizationId, ownerId } = await makeOrgWithOwner();

    const result = await createWorkspace(db, rawSql, { organizationId, actorUserId: ownerId, name: "Marketing", slug: "marketing" });

    expect(result.creatorMembership.role).toBe("manager");
    const [row] = await db.select().from(workspaceMemberships).where(sql`${workspaceMemberships.workspaceId} = ${result.workspace.id}`);
    expect(row.role).toBe("manager");
    expect(row.userId).toBe(ownerId);
  });

  it("rejects a plain member trying to create a workspace", async () => {
    const { organizationId } = await makeOrgWithOwner();
    const memberId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: memberId, role: "member" });

    await expect(
      createWorkspace(db, rawSql, { organizationId, actorUserId: memberId, name: "x", slug: "x" })
    ).rejects.toThrow(InsufficientRoleError);
  });
});

describe("getWorkspaceForUser against a real database", () => {
  it("resolves for an explicit workspace member", async () => {
    const { organizationId, ownerId } = await makeOrgWithOwner();
    const created = await createWorkspace(db, rawSql, { organizationId, actorUserId: ownerId, name: "Marketing", slug: "marketing" });

    const result = await getWorkspaceForUser(db, created.workspace.id, ownerId);
    expect(result.workspace.id).toBe(created.workspace.id);
  });

  it("rejects an organization member with no explicit workspace membership — organization membership never implies access", async () => {
    const { organizationId, ownerId } = await makeOrgWithOwner();
    const created = await createWorkspace(db, rawSql, { organizationId, actorUserId: ownerId, name: "Marketing", slug: "marketing" });
    const orgMemberId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: orgMemberId, role: "admin" });

    // Even an org admin, without an explicit workspace membership, cannot
    // read workspace content this way.
    await expect(getWorkspaceForUser(db, created.workspace.id, orgMemberId)).rejects.toThrow(TenantResourceNotFoundError);
  });
});

describe("updateWorkspace against a real database", () => {
  it("allows the workspace manager to update settings", async () => {
    const { organizationId, ownerId } = await makeOrgWithOwner();
    const created = await createWorkspace(db, rawSql, { organizationId, actorUserId: ownerId, name: "Marketing", slug: "marketing" });

    const updated = await updateWorkspace(db, rawSql, {
      workspaceId: created.workspace.id,
      organizationId,
      actorUserId: ownerId,
      updates: { name: "Growth" },
    });

    expect(updated.name).toBe("Growth");
  });

  it("allows an organization admin to update settings via the admin-override, without an explicit workspace membership", async () => {
    const { organizationId, ownerId } = await makeOrgWithOwner();
    const created = await createWorkspace(db, rawSql, { organizationId, actorUserId: ownerId, name: "Marketing", slug: "marketing" });
    const adminId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: adminId, role: "admin" });

    const updated = await updateWorkspace(db, rawSql, {
      workspaceId: created.workspace.id,
      organizationId,
      actorUserId: adminId,
      updates: { name: "Growth (via override)" },
    });

    expect(updated.name).toBe("Growth (via override)");
    // Confirm the admin still has no explicit workspace membership — the
    // override granted management access, not content access.
    const [membershipRow] = await db
      .select()
      .from(workspaceMemberships)
      .where(sql`${workspaceMemberships.workspaceId} = ${created.workspace.id} AND ${workspaceMemberships.userId} = ${adminId}`);
    expect(membershipRow).toBeUndefined();
  });

  it("rejects a workspace member (not manager) from updating settings", async () => {
    const { organizationId, ownerId } = await makeOrgWithOwner();
    const created = await createWorkspace(db, rawSql, { organizationId, actorUserId: ownerId, name: "Marketing", slug: "marketing" });
    const memberId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: memberId, role: "member" });
    await db.insert(workspaceMemberships).values({ workspaceId: created.workspace.id, userId: memberId, role: "member" });

    await expect(
      updateWorkspace(db, rawSql, { workspaceId: created.workspace.id, organizationId, actorUserId: memberId, updates: { name: "x" } })
    ).rejects.toThrow();
  });

  it("throws TenantResourceNotFoundError for a nonexistent workspace, even for a real organization owner", async () => {
    const { organizationId, ownerId } = await makeOrgWithOwner();

    await expect(
      updateWorkspace(db, rawSql, { workspaceId: crypto.randomUUID(), organizationId, actorUserId: ownerId, updates: { name: "x" } })
    ).rejects.toThrow(TenantResourceNotFoundError);
  });
});

describe("softDeleteWorkspace against a real database", () => {
  it("rejects a workspace manager — no workspace role may delete the workspace", async () => {
    const { organizationId, ownerId } = await makeOrgWithOwner();
    const created = await createWorkspace(db, rawSql, { organizationId, actorUserId: ownerId, name: "Marketing", slug: "marketing" });

    // ownerId is the workspace's own manager (creator) here, but must still
    // be rejected acting purely as a workspace manager — only the org
    // admin-override path is valid for deletion. Since ownerId is also the
    // org owner, use a separate pure-manager actor instead to isolate the rule.
    const managerOnlyId = await makeUser();
    await db.insert(workspaceMemberships).values({ workspaceId: created.workspace.id, userId: managerOnlyId, role: "manager" });

    await expect(
      softDeleteWorkspace(db, rawSql, { workspaceId: created.workspace.id, organizationId, actorUserId: managerOnlyId })
    ).rejects.toThrow(WorkspaceDeletionNotPermittedError);
  });

  it("allows an organization owner to delete the workspace via the admin-override", async () => {
    const { organizationId, ownerId } = await makeOrgWithOwner();
    const created = await createWorkspace(db, rawSql, { organizationId, actorUserId: ownerId, name: "Marketing", slug: "marketing" });

    await softDeleteWorkspace(db, rawSql, { workspaceId: created.workspace.id, organizationId, actorUserId: ownerId });

    const [row] = await db.select().from(workspaces).where(sql`${workspaces.id} = ${created.workspace.id}`);
    expect(row.deletedAt).not.toBeNull();
  });

  it("throws TenantResourceNotFoundError for a nonexistent workspace rather than silently no-op'ing", async () => {
    const { organizationId, ownerId } = await makeOrgWithOwner();

    await expect(
      softDeleteWorkspace(db, rawSql, { workspaceId: crypto.randomUUID(), organizationId, actorUserId: ownerId })
    ).rejects.toThrow(TenantResourceNotFoundError);
  });
});

describe("listWorkspacesForUser against a real database", () => {
  it("lists only workspaces with an explicit membership, excluding soft-deleted ones", async () => {
    const { organizationId, ownerId } = await makeOrgWithOwner();
    const wsA = await createWorkspace(db, rawSql, { organizationId, actorUserId: ownerId, name: "A", slug: "a" });
    const wsB = await createWorkspace(db, rawSql, { organizationId, actorUserId: ownerId, name: "B", slug: "b" });
    await softDeleteWorkspace(db, rawSql, { workspaceId: wsB.workspace.id, organizationId, actorUserId: ownerId });

    const list = await listWorkspacesForUser(db, ownerId);

    expect(list.find((w) => w.id === wsA.workspace.id)).toBeDefined();
    expect(list.find((w) => w.id === wsB.workspace.id)).toBeUndefined();
  });
});

describe("getWorkspaceBySlugForUser (Step 5A dashboard route resolution)", () => {
  it("resolves the workspace for an explicit member using its slug", async () => {
    const { organizationId, ownerId } = await makeOrgWithOwner();
    const created = await createWorkspace(db, rawSql, { organizationId, actorUserId: ownerId, name: "Marketing", slug: "marketing" });

    const result = await getWorkspaceBySlugForUser(db, organizationId, "marketing", ownerId);
    expect(result.workspace.id).toBe(created.workspace.id);
    expect(result.membership.role).toBe("manager");
  });

  it("an organization admin with NO workspace membership cannot view workspace content by slug", async () => {
    const { organizationId, ownerId } = await makeOrgWithOwner();
    await createWorkspace(db, rawSql, { organizationId, actorUserId: ownerId, name: "Marketing", slug: "marketing" });

    const adminId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: adminId, role: "admin" });

    await expect(getWorkspaceBySlugForUser(db, organizationId, "marketing", adminId)).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });

  it("returns not-found for an invalid workspace slug", async () => {
    const { organizationId, ownerId } = await makeOrgWithOwner();
    await expect(getWorkspaceBySlugForUser(db, organizationId, "does-not-exist", ownerId)).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });

  it("a workspace slug belonging to a different organization is not found", async () => {
    const orgA = await makeOrgWithOwner();
    await createWorkspace(db, rawSql, { organizationId: orgA.organizationId, actorUserId: orgA.ownerId, name: "Marketing", slug: "marketing" });

    const orgB = await makeOrgWithOwner();
    await expect(getWorkspaceBySlugForUser(db, orgB.organizationId, "marketing", orgB.ownerId)).rejects.toBeInstanceOf(
      TenantResourceNotFoundError
    );
  });

  it("a soft-deleted workspace's slug resolves to not-found even for its manager", async () => {
    const { organizationId, ownerId } = await makeOrgWithOwner();
    const created = await createWorkspace(db, rawSql, { organizationId, actorUserId: ownerId, name: "Marketing", slug: "marketing" });
    await softDeleteWorkspace(db, rawSql, { workspaceId: created.workspace.id, organizationId, actorUserId: ownerId });

    await expect(getWorkspaceBySlugForUser(db, organizationId, "marketing", ownerId)).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });
});
