import { describe, it, expect, afterEach } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import {
  users,
  organizations,
  organizationMemberships,
  workspaces,
  workspaceMemberships,
  brainPermissionGrants,
  auditLogs,
} from "@/db/schema";
import { TenantResourceNotFoundError, InsufficientRoleError } from "@/lib/authz/errors";
import {
  DuplicateBrainPermissionGrantError,
  BrainPermissionGrantAlreadyRevokedError,
  BrainPermissionGrantConflictError,
  CannotGrantUnauthorizedCapabilityError,
  BrainPermissionBootstrapAlreadyCompletedError,
  GranteeNotOrganizationMemberError,
  GranteeNotWorkspaceMemberError,
} from "./errors";
import { resolveEffectiveBrainCapabilities, requireBrainReadAccess } from "./authz";
import {
  createBrainPermissionGrant,
  listBrainPermissionGrants,
  getEffectiveBrainPermissions,
  updateBrainPermissionGrant,
  revokeBrainPermissionGrant,
  bootstrapBrainPermissions,
} from "./permissions";

const env = loadEnv();
const db = createDbClient(env);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `brain-permissions-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Permissions Test Org", slug: `brain-perm-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: ownerId, role: "owner" });
  createdOrgIds.push(org.id);
  return org.id;
}

async function addOrgMember(orgId: string, userId: string, role: "owner" | "admin" | "member" | "viewer"): Promise<void> {
  await db.insert(organizationMemberships).values({ organizationId: orgId, userId, role });
}

async function makeWorkspace(orgId: string): Promise<string> {
  const [ws] = await db.insert(workspaces).values({ organizationId: orgId, name: "WS", slug: `ws-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: workspaces.id });
  return ws.id;
}

async function addWorkspaceMember(workspaceId: string, userId: string, role: "manager" | "member" | "viewer"): Promise<void> {
  await db.insert(workspaceMemberships).values({ workspaceId, userId, role });
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

describe("createBrainPermissionGrant — management authority", () => {
  it("default deny: a plain member with no management authority cannot create any grant", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const granteeId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, memberId, "member");
    await addOrgMember(orgId, granteeId, "member");
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: memberId, capability: "read" });

    await expect(
      createBrainPermissionGrant(db, { organizationId: orgId, domain: "identity", grantee: { type: "human", userId: granteeId }, capability: "read", actorUserId: memberId })
    ).rejects.toBeInstanceOf(InsufficientRoleError);
  });

  it("organization membership alone (no role check passed) is insufficient — a non-member is rejected identically to a nonexistent organization", async () => {
    const ownerId = await makeUser();
    const strangerId = await makeUser();
    const granteeId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, granteeId, "member");

    await expect(
      createBrainPermissionGrant(db, { organizationId: orgId, domain: "identity", grantee: { type: "human", userId: granteeId }, capability: "read", actorUserId: strangerId })
    ).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });

  it("organization admin (not owner) cannot create an organization-scoped grant — only owner manages org-scoped grants", async () => {
    const ownerId = await makeUser();
    const adminId = await makeUser();
    const granteeId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, adminId, "admin");
    await addOrgMember(orgId, granteeId, "member");
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: adminId, capability: "read" });

    await expect(
      createBrainPermissionGrant(db, { organizationId: orgId, domain: "identity", grantee: { type: "human", userId: granteeId }, capability: "read", actorUserId: adminId })
    ).rejects.toBeInstanceOf(InsufficientRoleError);
  });

  it("organization owner can create an organization-scoped grant once they hold the capability themselves", async () => {
    const ownerId = await makeUser();
    const granteeId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, granteeId, "member");
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, capability: "read" });

    const grant = await createBrainPermissionGrant(db, { organizationId: orgId, domain: "identity", grantee: { type: "human", userId: granteeId }, capability: "read", actorUserId: ownerId });
    expect(grant.workspaceId).toBeNull();
    expect(grant.capability).toBe("read");
    expect(grant.granteeUserId).toBe(granteeId);
    expect(grant.revokedAt).toBeNull();
  });

  it("organization admin CAN create a workspace-scoped grant — workspace-scoped grants allow owner or admin", async () => {
    const ownerId = await makeUser();
    const adminId = await makeUser();
    const granteeId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, adminId, "admin");
    await addOrgMember(orgId, granteeId, "member");
    const workspaceId = await makeWorkspace(orgId);
    await addWorkspaceMember(workspaceId, granteeId, "member");
    // Admin must themselves hold the capability at the ORGANIZATION level for this domain (see this file's own reasoning on the bootstrap-compatible exception).
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "execution", workspaceId: null, granteeUserId: adminId, capability: "draft_write" });

    const grant = await createBrainPermissionGrant(db, {
      organizationId: orgId,
      domain: "execution",
      workspaceId,
      grantee: { type: "human", userId: granteeId },
      capability: "draft_write",
      actorUserId: adminId,
    });
    expect(grant.workspaceId).toBe(workspaceId);
  });

  it("a workspace manager (not org owner/admin) cannot create a workspace-scoped grant — grant management is never delegated to workspace role", async () => {
    const ownerId = await makeUser();
    const managerId = await makeUser();
    const granteeId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, managerId, "member");
    await addOrgMember(orgId, granteeId, "member");
    const workspaceId = await makeWorkspace(orgId);
    await addWorkspaceMember(workspaceId, managerId, "manager");
    await addWorkspaceMember(workspaceId, granteeId, "member");

    await expect(
      createBrainPermissionGrant(db, { organizationId: orgId, workspaceId, domain: "execution", grantee: { type: "human", userId: granteeId }, capability: "draft_write", actorUserId: managerId })
    ).rejects.toBeInstanceOf(InsufficientRoleError);
  });

  it("cannot grant a capability the actor does not themselves hold at the organization level for that domain — grant-management authority alone is not enough", async () => {
    const ownerId = await makeUser();
    const granteeId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, granteeId, "member");
    // ownerId holds grant-management authority (they're the owner) but no "approve" grant of their own.

    await expect(
      createBrainPermissionGrant(db, { organizationId: orgId, domain: "identity", grantee: { type: "human", userId: granteeId }, capability: "approve", actorUserId: ownerId })
    ).rejects.toBeInstanceOf(CannotGrantUnauthorizedCapabilityError);
  });

  it("the grantee must already be an organization member", async () => {
    const ownerId = await makeUser();
    const strangerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, capability: "read" });

    await expect(
      createBrainPermissionGrant(db, { organizationId: orgId, domain: "identity", grantee: { type: "human", userId: strangerId }, capability: "read", actorUserId: ownerId })
    ).rejects.toBeInstanceOf(GranteeNotOrganizationMemberError);
  });

  it("the grantee must already be a member of the exact workspace for a workspace-scoped grant", async () => {
    const ownerId = await makeUser();
    const granteeId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, granteeId, "member");
    const workspaceId = await makeWorkspace(orgId);
    // granteeId is an organization member but NOT an explicit member of this workspace.
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "execution", workspaceId: null, granteeUserId: ownerId, capability: "draft_write" });

    await expect(
      createBrainPermissionGrant(db, { organizationId: orgId, workspaceId, domain: "execution", grantee: { type: "human", userId: granteeId }, capability: "draft_write", actorUserId: ownerId })
    ).rejects.toBeInstanceOf(GranteeNotWorkspaceMemberError);
  });

  it("rejects a workspaceId belonging to a different organization — cross-tenant, application-layer", async () => {
    const ownerId = await makeUser();
    const otherOwnerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const otherOrgId = await makeOrgWithOwner(otherOwnerId);
    const foreignWorkspaceId = await makeWorkspace(otherOrgId);
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "execution", workspaceId: null, granteeUserId: ownerId, capability: "draft_write" });

    await expect(
      createBrainPermissionGrant(db, { organizationId: orgId, workspaceId: foreignWorkspaceId, domain: "execution", grantee: { type: "human", userId: ownerId }, capability: "draft_write", actorUserId: ownerId })
    ).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });

  it("rejects a duplicate active grant at the identical exact scope", async () => {
    const ownerId = await makeUser();
    const granteeId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, granteeId, "member");
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, capability: "read" });

    await createBrainPermissionGrant(db, { organizationId: orgId, domain: "identity", grantee: { type: "human", userId: granteeId }, capability: "read", actorUserId: ownerId });
    await expect(
      createBrainPermissionGrant(db, { organizationId: orgId, domain: "identity", grantee: { type: "human", userId: granteeId }, capability: "read", actorUserId: ownerId })
    ).rejects.toBeInstanceOf(DuplicateBrainPermissionGrantError);
  });

  it("allows re-granting the identical scope after the original was revoked", async () => {
    const ownerId = await makeUser();
    const granteeId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, granteeId, "member");
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, capability: "read" });

    const first = await createBrainPermissionGrant(db, { organizationId: orgId, domain: "identity", grantee: { type: "human", userId: granteeId }, capability: "read", actorUserId: ownerId });
    await revokeBrainPermissionGrant(db, { organizationId: orgId, grantId: first.id, actorUserId: ownerId });

    const second = await createBrainPermissionGrant(db, { organizationId: orgId, domain: "identity", grantee: { type: "human", userId: granteeId }, capability: "read", actorUserId: ownerId });
    expect(second.id).not.toBe(first.id);
    expect(second.revokedAt).toBeNull();
  });

  it("of two concurrent attempts to create the identical grant, exactly one succeeds and one is rejected as a duplicate", async () => {
    const ownerId = await makeUser();
    const granteeId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, granteeId, "member");
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, capability: "read" });

    const results = await Promise.allSettled([
      createBrainPermissionGrant(db, { organizationId: orgId, domain: "identity", grantee: { type: "human", userId: granteeId }, capability: "read", actorUserId: ownerId }),
      createBrainPermissionGrant(db, { organizationId: orgId, domain: "identity", grantee: { type: "human", userId: granteeId }, capability: "read", actorUserId: ownerId }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(DuplicateBrainPermissionGrantError);

    const rows = await db.select().from(brainPermissionGrants).where(and(eq(brainPermissionGrants.organizationId, orgId), eq(brainPermissionGrants.granteeUserId, granteeId)));
    expect(rows).toHaveLength(1);
  });

  it("records brain_permission_granted with the grantee, domain, workspace scope, and capability — never knowledge content (there is none here)", async () => {
    const ownerId = await makeUser();
    const granteeId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, granteeId, "member");
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, capability: "read" });

    await createBrainPermissionGrant(db, { organizationId: orgId, domain: "identity", grantee: { type: "human", userId: granteeId }, capability: "read", actorUserId: ownerId, reason: "onboarding" });

    const rows = await db.select().from(auditLogs).where(sql`${auditLogs.organizationId} = ${orgId} and ${auditLogs.eventType} = 'brain_permission_granted'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toMatchObject({ granteeUserId: granteeId, domain: "identity", workspaceScoped: false, capability: "read" });
  });

  it("records brain_permission_denied (not knowledge_access_denied) when a grant-management-authority check fails", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const granteeId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, memberId, "member");
    await addOrgMember(orgId, granteeId, "member");

    await expect(
      createBrainPermissionGrant(db, { organizationId: orgId, domain: "identity", grantee: { type: "human", userId: granteeId }, capability: "read", actorUserId: memberId })
    ).rejects.toBeInstanceOf(InsufficientRoleError);

    const rows = await db.select().from(auditLogs).where(sql`${auditLogs.organizationId} = ${orgId} and ${auditLogs.eventType} = 'brain_permission_denied'`);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("exact-scope-match — no crossing between organization- and workspace-scoped grants", () => {
  it("an organization-scoped grant does NOT extend into a workspace-scoped item's read gate", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const workspaceId = await makeWorkspace(orgId);
    await addWorkspaceMember(workspaceId, ownerId, "member");
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "execution", workspaceId: null, granteeUserId: ownerId, capability: "read" });

    await expect(
      requireBrainReadAccess(db, { organizationId: orgId, workspaceId, domain: "execution" }, ownerId)
    ).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });

  it("a workspace-scoped grant does NOT extend into organization-scoped content", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const workspaceId = await makeWorkspace(orgId);
    await addWorkspaceMember(workspaceId, ownerId, "member");
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "execution", workspaceId, granteeUserId: ownerId, capability: "read" });

    await expect(
      requireBrainReadAccess(db, { organizationId: orgId, workspaceId: null, domain: "execution" }, ownerId)
    ).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });

  it("multiple active grants at the same exact scope combine by union", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, capability: "read" });
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, capability: "draft_write" });

    const capabilities = await resolveEffectiveBrainCapabilities(db, { organizationId: orgId, domain: "identity", workspaceId: null }, ownerId);
    expect(capabilities.has("read")).toBe(true);
    expect(capabilities.has("draft_write")).toBe(true);
    expect(capabilities.has("approve")).toBe(false);
  });
});

describe("listBrainPermissionGrants", () => {
  it("requires organization owner or admin — a plain member is rejected", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, memberId, "member");

    await expect(listBrainPermissionGrants(db, { organizationId: orgId, actorUserId: memberId })).rejects.toBeInstanceOf(InsufficientRoleError);
  });

  it("filters by granteeUserId, domain, and workspaceId (null meaning organization-scoped only)", async () => {
    const ownerId = await makeUser();
    const granteeAId = await makeUser();
    const granteeBId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, granteeAId, "member");
    await addOrgMember(orgId, granteeBId, "member");
    const workspaceId = await makeWorkspace(orgId);
    await addWorkspaceMember(workspaceId, granteeAId, "member");
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: granteeAId, capability: "read" });
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "execution", workspaceId, granteeUserId: granteeAId, capability: "draft_write" });
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: granteeBId, capability: "read" });

    const forGranteeA = await listBrainPermissionGrants(db, { organizationId: orgId, actorUserId: ownerId, granteeUserId: granteeAId });
    expect(forGranteeA).toHaveLength(2);

    const orgScopedOnly = await listBrainPermissionGrants(db, { organizationId: orgId, actorUserId: ownerId, workspaceId: null });
    expect(orgScopedOnly.map((g) => g.granteeUserId).sort()).toEqual([granteeAId, granteeBId].sort());

    const workspaceScopedOnly = await listBrainPermissionGrants(db, { organizationId: orgId, actorUserId: ownerId, workspaceId });
    expect(workspaceScopedOnly).toHaveLength(1);
    expect(workspaceScopedOnly[0].granteeUserId).toBe(granteeAId);
  });

  it("excludes revoked grants by default, includes them with includeRevoked", async () => {
    const ownerId = await makeUser();
    const granteeId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, granteeId, "member");
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, capability: "read" });
    const grant = await createBrainPermissionGrant(db, { organizationId: orgId, domain: "identity", grantee: { type: "human", userId: granteeId }, capability: "read", actorUserId: ownerId });
    await revokeBrainPermissionGrant(db, { organizationId: orgId, grantId: grant.id, actorUserId: ownerId });

    const activeOnly = await listBrainPermissionGrants(db, { organizationId: orgId, actorUserId: ownerId, granteeUserId: granteeId });
    expect(activeOnly).toHaveLength(0);

    const withRevoked = await listBrainPermissionGrants(db, { organizationId: orgId, actorUserId: ownerId, granteeUserId: granteeId, includeRevoked: true });
    expect(withRevoked).toHaveLength(1);
    expect(withRevoked[0].revokedAt).not.toBeNull();
  });

  it("grant-manager (admin) does NOT automatically receive content access merely from viewing/managing grants", async () => {
    const ownerId = await makeUser();
    const adminId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, adminId, "admin");
    // adminId can list grants (owner/admin authority)...
    const grants = await listBrainPermissionGrants(db, { organizationId: orgId, actorUserId: adminId });
    expect(grants).toEqual([]);
    // ...but holds no capability of their own, so ordinary content access is still denied.
    await expect(requireBrainReadAccess(db, { organizationId: orgId, workspaceId: null, domain: "identity" }, adminId)).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });
});

describe("getEffectiveBrainPermissions", () => {
  it("requires only organization membership — always resolves the caller's own grants", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, memberId, "member");
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: memberId, capability: "read" });
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: memberId, capability: "draft_write" });

    const result = await getEffectiveBrainPermissions(db, orgId, memberId);
    expect(result.scopes).toHaveLength(1);
    expect(result.scopes[0]).toMatchObject({ domain: "identity", workspaceId: null });
    expect(result.scopes[0].capabilities.sort()).toEqual(["draft_write", "read"]);
  });

  it("a non-member is rejected", async () => {
    const ownerId = await makeUser();
    const strangerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);

    await expect(getEffectiveBrainPermissions(db, orgId, strangerId)).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });

  it("revocation takes effect immediately — a revoked grant disappears from the effective set right away", async () => {
    const ownerId = await makeUser();
    const granteeId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, granteeId, "member");
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, capability: "read" });
    const grant = await createBrainPermissionGrant(db, { organizationId: orgId, domain: "identity", grantee: { type: "human", userId: granteeId }, capability: "read", actorUserId: ownerId });

    const before = await getEffectiveBrainPermissions(db, orgId, granteeId);
    expect(before.scopes).toHaveLength(1);

    await revokeBrainPermissionGrant(db, { organizationId: orgId, grantId: grant.id, actorUserId: ownerId });

    const after = await getEffectiveBrainPermissions(db, orgId, granteeId);
    expect(after.scopes).toHaveLength(0);
    await expect(requireBrainReadAccess(db, { organizationId: orgId, workspaceId: null, domain: "identity" }, granteeId)).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });
});

describe("updateBrainPermissionGrant", () => {
  it("updates only the reason field, bumping the revision", async () => {
    const ownerId = await makeUser();
    const granteeId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, granteeId, "member");
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, capability: "read" });
    const grant = await createBrainPermissionGrant(db, { organizationId: orgId, domain: "identity", grantee: { type: "human", userId: granteeId }, capability: "read", actorUserId: ownerId });
    expect(grant.revision).toBe(1);

    const updated = await updateBrainPermissionGrant(db, { organizationId: orgId, grantId: grant.id, reason: "quarterly review", expectedRevision: 1, actorUserId: ownerId });
    expect(updated.reason).toBe("quarterly review");
    expect(updated.revision).toBe(2);
    expect(updated.capability).toBe("read");
  });

  it("rejects a stale expectedRevision, never silently overwriting", async () => {
    const ownerId = await makeUser();
    const granteeId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, granteeId, "member");
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, capability: "read" });
    const grant = await createBrainPermissionGrant(db, { organizationId: orgId, domain: "identity", grantee: { type: "human", userId: granteeId }, capability: "read", actorUserId: ownerId });
    await updateBrainPermissionGrant(db, { organizationId: orgId, grantId: grant.id, reason: "first", expectedRevision: 1, actorUserId: ownerId });

    await expect(
      updateBrainPermissionGrant(db, { organizationId: orgId, grantId: grant.id, reason: "stale", expectedRevision: 1, actorUserId: ownerId })
    ).rejects.toBeInstanceOf(BrainPermissionGrantConflictError);
  });

  it("cannot update an already-revoked grant", async () => {
    const ownerId = await makeUser();
    const granteeId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, granteeId, "member");
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, capability: "read" });
    const grant = await createBrainPermissionGrant(db, { organizationId: orgId, domain: "identity", grantee: { type: "human", userId: granteeId }, capability: "read", actorUserId: ownerId });
    await revokeBrainPermissionGrant(db, { organizationId: orgId, grantId: grant.id, actorUserId: ownerId });

    await expect(
      updateBrainPermissionGrant(db, { organizationId: orgId, grantId: grant.id, reason: "too late", expectedRevision: 1, actorUserId: ownerId })
    ).rejects.toBeInstanceOf(BrainPermissionGrantAlreadyRevokedError);
  });

  it("requires the identical grant-management authority as creating a grant at this scope", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const granteeId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, memberId, "member");
    await addOrgMember(orgId, granteeId, "member");
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, capability: "read" });
    const grant = await createBrainPermissionGrant(db, { organizationId: orgId, domain: "identity", grantee: { type: "human", userId: granteeId }, capability: "read", actorUserId: ownerId });

    await expect(
      updateBrainPermissionGrant(db, { organizationId: orgId, grantId: grant.id, reason: "hijack", expectedRevision: 1, actorUserId: memberId })
    ).rejects.toBeInstanceOf(InsufficientRoleError);
  });
});

describe("revokeBrainPermissionGrant", () => {
  it("revoking an already-revoked grant fails safely, never silently", async () => {
    const ownerId = await makeUser();
    const granteeId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, granteeId, "member");
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, capability: "read" });
    const grant = await createBrainPermissionGrant(db, { organizationId: orgId, domain: "identity", grantee: { type: "human", userId: granteeId }, capability: "read", actorUserId: ownerId });
    await revokeBrainPermissionGrant(db, { organizationId: orgId, grantId: grant.id, actorUserId: ownerId });

    await expect(revokeBrainPermissionGrant(db, { organizationId: orgId, grantId: grant.id, actorUserId: ownerId })).rejects.toBeInstanceOf(
      BrainPermissionGrantAlreadyRevokedError
    );
  });

  it("of two concurrent revoke attempts on the same grant, exactly one succeeds and one is rejected — no double revoke", async () => {
    const ownerId = await makeUser();
    const granteeId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, granteeId, "member");
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, capability: "read" });
    const grant = await createBrainPermissionGrant(db, { organizationId: orgId, domain: "identity", grantee: { type: "human", userId: granteeId }, capability: "read", actorUserId: ownerId });

    const results = await Promise.allSettled([
      revokeBrainPermissionGrant(db, { organizationId: orgId, grantId: grant.id, actorUserId: ownerId }),
      revokeBrainPermissionGrant(db, { organizationId: orgId, grantId: grant.id, actorUserId: ownerId }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(BrainPermissionGrantAlreadyRevokedError);
  });

  it("records brain_permission_revoked with the grant's scope and capability", async () => {
    const ownerId = await makeUser();
    const granteeId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, granteeId, "member");
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, capability: "read" });
    const grant = await createBrainPermissionGrant(db, { organizationId: orgId, domain: "identity", grantee: { type: "human", userId: granteeId }, capability: "read", actorUserId: ownerId });
    await revokeBrainPermissionGrant(db, { organizationId: orgId, grantId: grant.id, actorUserId: ownerId });

    const rows = await db.select().from(auditLogs).where(sql`${auditLogs.organizationId} = ${orgId} and ${auditLogs.eventType} = 'brain_permission_revoked'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toMatchObject({ granteeUserId: granteeId, domain: "identity", capability: "read" });
  });
});

describe("bootstrapBrainPermissions", () => {
  it("requires organization owner — an admin cannot bootstrap", async () => {
    const ownerId = await makeUser();
    const adminId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, adminId, "admin");

    await expect(bootstrapBrainPermissions(db, { organizationId: orgId, actorUserId: adminId })).rejects.toBeInstanceOf(InsufficientRoleError);
  });

  it("grants the owner all 8 capabilities across all 8 domains, organization-scoped", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);

    const grants = await bootstrapBrainPermissions(db, { organizationId: orgId, actorUserId: ownerId });
    expect(grants).toHaveLength(64);
    expect(grants.every((g) => g.workspaceId === null)).toBe(true);
    expect(grants.every((g) => g.granteeUserId === ownerId)).toBe(true);
    expect(new Set(grants.map((g) => g.domain)).size).toBe(8);
    expect(new Set(grants.map((g) => g.capability)).size).toBe(8);

    const capabilities = await resolveEffectiveBrainCapabilities(db, { organizationId: orgId, domain: "governance", workspaceId: null }, ownerId);
    expect(capabilities.has("purge")).toBe(true);
    expect(capabilities.has("manage_permissions")).toBe(true);
  });

  it("is strictly one-time — a second bootstrap attempt is refused once any grant exists", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await bootstrapBrainPermissions(db, { organizationId: orgId, actorUserId: ownerId });

    await expect(bootstrapBrainPermissions(db, { organizationId: orgId, actorUserId: ownerId })).rejects.toBeInstanceOf(BrainPermissionBootstrapAlreadyCompletedError);
  });

  it("is refused even if a single, unrelated grant already exists (not just after a prior bootstrap)", async () => {
    const ownerId = await makeUser();
    const granteeId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, granteeId, "member");
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: granteeId, capability: "read" });

    await expect(bootstrapBrainPermissions(db, { organizationId: orgId, actorUserId: ownerId })).rejects.toBeInstanceOf(BrainPermissionBootstrapAlreadyCompletedError);
  });

  it("records exactly one brain_permission_bootstrapped event, listing every grant id created", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const grants = await bootstrapBrainPermissions(db, { organizationId: orgId, actorUserId: ownerId });

    const rows = await db.select().from(auditLogs).where(sql`${auditLogs.organizationId} = ${orgId} and ${auditLogs.eventType} = 'brain_permission_bootstrapped'`);
    expect(rows).toHaveLength(1);
    const metadata = rows[0].metadata as { grantIds: string[]; grantCount: number };
    expect(metadata.grantCount).toBe(64);
    expect(metadata.grantIds.sort()).toEqual(grants.map((g) => g.id).sort());
  });

  it("bootstrapped grants are ordinary, individually-revocable rows — never a standing implicit override", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const grants = await bootstrapBrainPermissions(db, { organizationId: orgId, actorUserId: ownerId });
    const readGrant = grants.find((g) => g.domain === "identity" && g.capability === "read")!;

    await revokeBrainPermissionGrant(db, { organizationId: orgId, grantId: readGrant.id, actorUserId: ownerId });
    await expect(requireBrainReadAccess(db, { organizationId: orgId, workspaceId: null, domain: "identity" }, ownerId)).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });
});

describe("database-level enforcement", () => {
  it("rejects an invalid capability value at the database level, bypassing application validation", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);

    await expect(
      db.execute(sql`INSERT INTO brain_permission_grants (id, organization_id, domain, grantee_user_id, capability)
                      VALUES (gen_random_uuid(), ${orgId}, 'identity', ${ownerId}, 'not-a-real-capability')`)
    ).rejects.toThrow();
  });

  it("rejects a grantee with no organization membership at the database level (composite FK)", async () => {
    const ownerId = await makeUser();
    const strangerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);

    await expect(
      db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: strangerId, capability: "read" })
    ).rejects.toThrow();
  });

  it("rejects a workspace-scoped grant whose grantee has no membership in that exact workspace at the database level", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, memberId, "member");
    const workspaceId = await makeWorkspace(orgId);

    await expect(
      db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "execution", workspaceId, granteeUserId: memberId, capability: "draft_write" })
    ).rejects.toThrow();
  });

  it("rejects a workspace/organization mismatch at the database level (composite FK)", async () => {
    const ownerId = await makeUser();
    const otherOwnerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const otherOrgId = await makeOrgWithOwner(otherOwnerId);
    const foreignWorkspaceId = await makeWorkspace(otherOrgId);

    await expect(
      db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "execution", workspaceId: foreignWorkspaceId, granteeUserId: ownerId, capability: "draft_write" })
    ).rejects.toThrow();
  });

  it("rejects a duplicate active organization-scoped grant at the database level, bypassing the service layer", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, capability: "read" });

    await expect(
      db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, capability: "read" })
    ).rejects.toThrow();
  });

  it("rejects a duplicate active workspace-scoped grant at the database level, bypassing the service layer", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const workspaceId = await makeWorkspace(orgId);
    await addWorkspaceMember(workspaceId, ownerId, "member");
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "execution", workspaceId, granteeUserId: ownerId, capability: "draft_write" });

    await expect(
      db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "execution", workspaceId, granteeUserId: ownerId, capability: "draft_write" })
    ).rejects.toThrow();
  });

  it("allows the identical (org, domain, grantee, capability) once workspace-scoped AND once organization-scoped — the two partial indexes are independent", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const workspaceId = await makeWorkspace(orgId);
    await addWorkspaceMember(workspaceId, ownerId, "member");

    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "execution", workspaceId: null, granteeUserId: ownerId, capability: "draft_write" });
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "execution", workspaceId, granteeUserId: ownerId, capability: "draft_write" });

    const rows = await db.select().from(brainPermissionGrants).where(and(eq(brainPermissionGrants.organizationId, orgId), eq(brainPermissionGrants.granteeUserId, ownerId)));
    expect(rows).toHaveLength(2);
  });
});
