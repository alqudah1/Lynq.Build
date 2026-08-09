import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, auditLogs, invitations as invitationsTable } from "@/db/schema";
import { createOrganization } from "@/lib/organizations/organizations";
import { createWorkspace } from "@/lib/workspaces/workspaces";
import {
  createOrRefreshInvitation,
  listOrganizationInvitations,
  revokeInvitation,
  getInvitationByToken,
} from "./invitations";
import { InvitationNotAvailableError, AdminCannotInviteOwnerViolationError, InvitationNotPendingViolationError } from "./errors";
import { TenantResourceNotFoundError, InsufficientRoleError } from "@/lib/authz/errors";
import { hashInvitationToken } from "./tokens";

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `invitations-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrg(ownerId: string) {
  const org = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
  createdOrgIds.push(org.organization.id);
  return org.organization.id;
}

afterEach(async () => {
  while (createdOrgIds.length > 0) {
    const id = createdOrgIds.pop()!;
    await db.delete(auditLogs).where(sql`${auditLogs.organizationId} = ${id}`);
    await db.delete(invitationsTable).where(sql`${invitationsTable.organizationId} = ${id}`);
    await db.delete(organizations).where(sql`${organizations.id} = ${id}`);
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await db.delete(users).where(sql`${users.id} = ${id}`);
  }
});

describe("createOrRefreshInvitation", () => {
  it("owner can create a permitted invitation", async () => {
    const ownerId = await makeUser();
    const organizationId = await makeOrg(ownerId);

    const result = await createOrRefreshInvitation(db, rawSql, {
      organizationId,
      actorUserId: ownerId,
      email: "Invitee@Example.com",
      role: "admin",
    });

    expect(result.refreshed).toBe(false);
    expect(result.invitation.email).toBe("invitee@example.com"); // normalized
    expect(result.invitation.status).toBe("pending");
    expect(result.rawToken).toBeTruthy();

    const [row] = await db.select().from(invitationsTable).where(sql`${invitationsTable.id} = ${result.invitation.id}`);
    expect(row.tokenHash).toBe(hashInvitationToken(result.rawToken));
    expect(row.tokenHash).not.toBe(result.rawToken);
  });

  it("admin can create a permitted invitation (non-owner role)", async () => {
    const ownerId = await makeUser();
    const organizationId = await makeOrg(ownerId);
    const adminId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: adminId, role: "admin" });

    const result = await createOrRefreshInvitation(db, rawSql, {
      organizationId,
      actorUserId: adminId,
      email: "member-invite@example.com",
      role: "member",
    });
    expect(result.invitation.role).toBe("member");
  });

  it("admin cannot invite an owner", async () => {
    const ownerId = await makeUser();
    const organizationId = await makeOrg(ownerId);
    const adminId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: adminId, role: "admin" });

    await expect(
      createOrRefreshInvitation(db, rawSql, { organizationId, actorUserId: adminId, email: "x@example.com", role: "owner" })
    ).rejects.toBeInstanceOf(AdminCannotInviteOwnerViolationError);
  });

  it("owner CAN invite another owner", async () => {
    const ownerId = await makeUser();
    const organizationId = await makeOrg(ownerId);

    const result = await createOrRefreshInvitation(db, rawSql, {
      organizationId,
      actorUserId: ownerId,
      email: "new-owner@example.com",
      role: "owner",
    });
    expect(result.invitation.role).toBe("owner");
  });

  it("member cannot create invitations", async () => {
    const ownerId = await makeUser();
    const organizationId = await makeOrg(ownerId);
    const memberId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: memberId, role: "member" });

    await expect(
      createOrRefreshInvitation(db, rawSql, { organizationId, actorUserId: memberId, email: "x@example.com", role: "viewer" })
    ).rejects.toBeInstanceOf(InsufficientRoleError);
  });

  it("viewer cannot create invitations", async () => {
    const ownerId = await makeUser();
    const organizationId = await makeOrg(ownerId);
    const viewerId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: viewerId, role: "viewer" });

    await expect(
      createOrRefreshInvitation(db, rawSql, { organizationId, actorUserId: viewerId, email: "x@example.com", role: "viewer" })
    ).rejects.toBeInstanceOf(InsufficientRoleError);
  });

  it("a workspace belonging to another organization is rejected", async () => {
    const ownerId = await makeUser();
    const organizationId = await makeOrg(ownerId);
    const otherOwnerId = await makeUser();
    const otherOrgId = await makeOrg(otherOwnerId);
    const otherWs = await createWorkspace(db, rawSql, { organizationId: otherOrgId, actorUserId: otherOwnerId, name: "Other", slug: "other" });

    await expect(
      createOrRefreshInvitation(db, rawSql, {
        organizationId,
        actorUserId: ownerId,
        email: "x@example.com",
        role: "member",
        workspace: { workspaceId: otherWs.workspace.id, workspaceRole: "viewer" },
      })
    ).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });

  it("duplicate pending invitation refreshes atomically instead of duplicating, and the old token fails afterward", async () => {
    const ownerId = await makeUser();
    const organizationId = await makeOrg(ownerId);

    const first = await createOrRefreshInvitation(db, rawSql, { organizationId, actorUserId: ownerId, email: "dup@example.com", role: "member" });
    const second = await createOrRefreshInvitation(db, rawSql, { organizationId, actorUserId: ownerId, email: "dup@example.com", role: "admin" });

    expect(first.refreshed).toBe(false);
    expect(second.refreshed).toBe(true);
    expect(second.invitation.id).toBe(first.invitation.id); // same row, refreshed in place
    expect(second.invitation.role).toBe("admin"); // role updated to the refresh request's value

    const rows = await db.select().from(invitationsTable).where(sql`${invitationsTable.organizationId} = ${organizationId}`);
    expect(rows).toHaveLength(1); // never two pending rows

    // The OLD raw token (from `first`) must no longer work.
    await expect(getInvitationByToken(db, first.rawToken)).rejects.toBeInstanceOf(InvitationNotAvailableError);
    // The NEW raw token (from `second`) must work.
    const preview = await getInvitationByToken(db, second.rawToken);
    expect(preview.role).toBe("admin");
  });

  it("simultaneous duplicate invitation requests produce exactly one valid pending invitation", async () => {
    const ownerId = await makeUser();
    const organizationId = await makeOrg(ownerId);

    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        createOrRefreshInvitation(db, rawSql, { organizationId, actorUserId: ownerId, email: "race@example.com", role: "member" })
      )
    );

    // Every attempt succeeds (each is a legitimate create-or-refresh, never a raw unique-violation error).
    expect(attempts.every((a) => a.status === "fulfilled")).toBe(true);

    const rows = await db.select().from(invitationsTable).where(sql`${invitationsTable.organizationId} = ${organizationId}`);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");

    // Exactly one of the 5 raw tokens is the one still valid — the row's current token_hash matches exactly one attempt's rawToken.
    const succeeded = attempts.filter((a): a is PromiseFulfilledResult<Awaited<ReturnType<typeof createOrRefreshInvitation>>> => a.status === "fulfilled");
    const validCount = succeeded.filter((a) => hashInvitationToken(a.value.rawToken) === rows[0].tokenHash).length;
    expect(validCount).toBe(1);
  });
});

describe("getInvitationByToken", () => {
  it("returns a generic not-available error for a nonexistent token", async () => {
    await expect(getInvitationByToken(db, "not-a-real-token")).rejects.toMatchObject({ code: "invitation_not_available" });
  });

  it("returns a generic not-available error for an expired invitation", async () => {
    const ownerId = await makeUser();
    const organizationId = await makeOrg(ownerId);
    const result = await createOrRefreshInvitation(db, rawSql, { organizationId, actorUserId: ownerId, email: "exp@example.com", role: "member" });

    await db.update(invitationsTable).set({ expiresAt: new Date(Date.now() - 1000) }).where(sql`${invitationsTable.id} = ${result.invitation.id}`);

    await expect(getInvitationByToken(db, result.rawToken)).rejects.toMatchObject({ code: "invitation_not_available", internalReason: "expired" });

    const [row] = await db.select({ status: invitationsTable.status }).from(invitationsTable).where(sql`${invitationsTable.id} = ${result.invitation.id}`);
    expect(row.status).toBe("expired"); // lazily persisted
  });

  it("returns a generic not-available error for a revoked invitation", async () => {
    const ownerId = await makeUser();
    const organizationId = await makeOrg(ownerId);
    const result = await createOrRefreshInvitation(db, rawSql, { organizationId, actorUserId: ownerId, email: "rev@example.com", role: "member" });

    await revokeInvitation(db, { organizationId, actorUserId: ownerId, invitationId: result.invitation.id });

    await expect(getInvitationByToken(db, result.rawToken)).rejects.toMatchObject({ code: "invitation_not_available", internalReason: "revoked" });
  });
});

describe("revokeInvitation", () => {
  it("owner/admin can revoke a pending invitation", async () => {
    const ownerId = await makeUser();
    const organizationId = await makeOrg(ownerId);
    const result = await createOrRefreshInvitation(db, rawSql, { organizationId, actorUserId: ownerId, email: "torevoke@example.com", role: "member" });

    await revokeInvitation(db, { organizationId, actorUserId: ownerId, invitationId: result.invitation.id });

    const [row] = await db.select({ status: invitationsTable.status }).from(invitationsTable).where(sql`${invitationsTable.id} = ${result.invitation.id}`);
    expect(row.status).toBe("revoked");
  });

  it("revoking an already-revoked invitation is a domain-rule violation, not a silent no-op", async () => {
    const ownerId = await makeUser();
    const organizationId = await makeOrg(ownerId);
    const result = await createOrRefreshInvitation(db, rawSql, { organizationId, actorUserId: ownerId, email: "double-revoke@example.com", role: "member" });

    await revokeInvitation(db, { organizationId, actorUserId: ownerId, invitationId: result.invitation.id });

    await expect(revokeInvitation(db, { organizationId, actorUserId: ownerId, invitationId: result.invitation.id })).rejects.toBeInstanceOf(
      InvitationNotPendingViolationError
    );
  });

  it("member cannot revoke", async () => {
    const ownerId = await makeUser();
    const organizationId = await makeOrg(ownerId);
    const memberId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: memberId, role: "member" });
    const result = await createOrRefreshInvitation(db, rawSql, { organizationId, actorUserId: ownerId, email: "x@example.com", role: "viewer" });

    await expect(revokeInvitation(db, { organizationId, actorUserId: memberId, invitationId: result.invitation.id })).rejects.toBeInstanceOf(
      InsufficientRoleError
    );
  });
});

describe("listOrganizationInvitations", () => {
  it("owner/admin can list; member/viewer cannot", async () => {
    const ownerId = await makeUser();
    const organizationId = await makeOrg(ownerId);
    await createOrRefreshInvitation(db, rawSql, { organizationId, actorUserId: ownerId, email: "list@example.com", role: "member" });
    const memberId = await makeUser();
    await db.insert(organizationMemberships).values({ organizationId, userId: memberId, role: "member" });

    const list = await listOrganizationInvitations(db, organizationId, ownerId);
    expect(list).toHaveLength(1);

    await expect(listOrganizationInvitations(db, organizationId, memberId)).rejects.toBeInstanceOf(InsufficientRoleError);
  });
});
