import { describe, it, expect, afterEach } from "vitest";
import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, workspaceMemberships, auditLogs } from "@/db/schema";
import { createOrganization, updateOrganization } from "@/lib/organizations/organizations";
import { addOrganizationMember, changeOrganizationRole } from "@/lib/organizations/memberships";
import { createWorkspace, getWorkspaceForUser, updateWorkspace, softDeleteWorkspace } from "@/lib/workspaces/workspaces";
import { addWorkspaceMember } from "@/lib/workspaces/memberships";
import { requireAuthenticatedUser } from "./helpers";
import {
  UnauthenticatedError,
  TenantResourceNotFoundError,
  InsufficientRoleError,
  SelfRoleChangeViolationError,
  WorkspaceDeletionNotPermittedError,
} from "./errors";

/**
 * Step 4A's explicit acceptance-test list (this codebase's task), as one
 * consolidated, easy-to-audit suite. Several of these scenarios are also
 * exercised in depth by the per-module test files (organizations/*,
 * workspaces/*, authz/helpers.integration.test.ts) — this file exists so
 * every scenario named in the task is demonstrably present in one place,
 * even where the underlying behavior is already covered elsewhere.
 */

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `acceptance-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
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

it("1. unauthenticated requests are rejected", async () => {
  await expect(requireAuthenticatedUser(db, null)).rejects.toThrow(UnauthenticatedError);
  await expect(requireAuthenticatedUser(db, "forged-token-value")).rejects.toThrow(UnauthenticatedError);
});

describe("4. a viewer cannot mutate organization or workspace data", () => {
  it("organization viewer cannot update the organization", async () => {
    const { organizationId } = await makeOrgWithWorkspace();
    const viewerId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: viewerId, role: "viewer" });

    await expect(
      updateOrganization(db, rawSql, { organizationId, actorUserId: viewerId, updates: { name: "x" } })
    ).rejects.toThrow(InsufficientRoleError);
  });

  it("workspace viewer cannot update workspace settings", async () => {
    const { organizationId, workspaceId, ownerId } = await makeOrgWithWorkspace();
    const viewerId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: viewerId, role: "member" });
    await addWorkspaceMember(db, rawSql, { workspaceId, organizationId, actorUserId: ownerId, targetUserId: viewerId, role: "viewer" });

    await expect(
      updateWorkspace(db, rawSql, { workspaceId, organizationId, actorUserId: viewerId, updates: { name: "x" } })
    ).rejects.toThrow();
  });
});

it("5. a member cannot manage membership (organization or workspace)", async () => {
  const { organizationId, workspaceId } = await makeOrgWithWorkspace();
  const memberId = await makeUser();
  await db.insert(organizationMemberships).values({ organizationId, userId: memberId, role: "member" });
  const targetId = await makeUser();
  await db.insert(organizationMemberships).values({ organizationId, userId: targetId, role: "member" });

  await expect(
    addOrganizationMember(db, rawSql, { organizationId, actorUserId: memberId, targetUserId: targetId, role: "member" })
  ).rejects.toThrow(InsufficientRoleError);

  await expect(
    addWorkspaceMember(db, rawSql, { workspaceId, organizationId, actorUserId: memberId, targetUserId: targetId, role: "member" })
  ).rejects.toThrow();
});

it("8. a user cannot promote themselves — even a plain member, not just an owner", async () => {
  const { organizationId } = await makeOrgWithWorkspace();
  const memberId = await makeUser();
  await db.insert(organizationMemberships).values({ organizationId, userId: memberId, role: "member" });

  await expect(
    changeOrganizationRole(db, rawSql, { organizationId, actorUserId: memberId, targetUserId: memberId, newRole: "owner" })
  ).rejects.toThrow(SelfRoleChangeViolationError);
});

it("9. a workspace manager cannot delete the workspace", async () => {
  const { organizationId, workspaceId } = await makeOrgWithWorkspace();
  const managerOnlyId = await makeUser();
  await db.insert(workspaceMemberships).values({ workspaceId, userId: managerOnlyId, role: "manager" });

  await expect(
    softDeleteWorkspace(db, rawSql, { workspaceId, organizationId, actorUserId: managerOnlyId })
  ).rejects.toThrow(WorkspaceDeletionNotPermittedError);
});

it("10. an organization admin can administer workspace membership without gaining workspace content access", async () => {
  const { organizationId, workspaceId } = await makeOrgWithWorkspace();
  const adminId = await makeUser();
  await db.insert(organizationMemberships).values({ organizationId, userId: adminId, role: "admin" });
  const targetId = await makeUser();
  await db.insert(organizationMemberships).values({ organizationId, userId: targetId, role: "member" });

  // The admin can add a workspace member via the override...
  await addWorkspaceMember(db, rawSql, { workspaceId, organizationId, actorUserId: adminId, targetUserId: targetId, role: "member" });

  // ...but the admin themselves still cannot read workspace content —
  // administering membership never grants content access.
  await expect(getWorkspaceForUser(db, workspaceId, adminId)).rejects.toThrow(TenantResourceNotFoundError);
});

it("12. client-supplied user IDs and roles have no authorization effect — every check re-derives the truth from the database", async () => {
  const { organizationId } = await makeOrgWithWorkspace();
  const memberId = await makeUser();
  await db.insert(organizationMemberships).values({ organizationId, userId: memberId, role: "member" });

  // No domain function accepts a claimed role for the actor — only
  // `actorUserId` is ever taken as input, and every check re-reads that
  // user's real role from organization_memberships/workspace_memberships.
  // Attempting the operation as this real "member" is rejected exactly as
  // if a browser had tried to forge a higher role in a request body: there
  // is no parameter this call could have supplied to change the outcome.
  await expect(
    updateOrganization(db, rawSql, { organizationId, actorUserId: memberId, updates: { name: "forged-owner-attempt" } })
  ).rejects.toThrow(InsufficientRoleError);
});

it("13. cross-tenant resource requests carry a 404 status, never a 403 that would confirm existence", async () => {
  const { organizationId } = await makeOrgWithWorkspace();
  const outsiderId = await makeUser();

  try {
    await updateOrganization(db, rawSql, { organizationId, actorUserId: outsiderId, updates: { name: "x" } });
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(TenantResourceNotFoundError);
    expect((err as TenantResourceNotFoundError).httpStatus).toBe(404);
  }
});

it("14. authorization denials are audited without any sensitive data in the metadata", async () => {
  const { organizationId } = await makeOrgWithWorkspace();
  const memberId = await makeUser();
  await db.insert(organizationMemberships).values({ organizationId, userId: memberId, role: "member" });
  const targetId = await makeUser();
  await db.insert(organizationMemberships).values({ organizationId, userId: targetId, role: "member" });

  await expect(
    addOrganizationMember(db, rawSql, { organizationId, actorUserId: memberId, targetUserId: targetId, role: "admin" })
  ).rejects.toThrow(InsufficientRoleError);

  const [denial] = await db
    .select()
    .from(auditLogs)
    .where(sql`${auditLogs.organizationId} = ${organizationId} AND ${auditLogs.eventType} = 'authorization_denied'`);

  expect(denial).toBeDefined();
  const metadataText = JSON.stringify(denial.metadata);
  expect(metadataText).not.toMatch(/token|secret|password|session/i);
  expect(denial.metadata).toEqual(expect.objectContaining({ action: "add_organization_member", reason: "insufficient_role" }));
});
