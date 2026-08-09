import { describe, it, expect, afterEach, vi } from "vitest";
import { sql, eq } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import {
  users,
  organizations,
  organizationMemberships,
  workspaceMemberships,
  auditLogs,
  invitations as invitationsTable,
} from "@/db/schema";
import { createOrganization } from "@/lib/organizations/organizations";
import { createWorkspace } from "@/lib/workspaces/workspaces";
import { createOrRefreshInvitation } from "./invitations";
import { acceptInvitation } from "./acceptance";
import { InvitationEmailMismatchError } from "./errors";
import { hashInvitationToken } from "./tokens";

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(email?: string): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ email: email ?? `acceptance-test-${crypto.randomUUID()}@example.com` })
    .returning({ id: users.id });
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

describe("acceptInvitation — existing user", () => {
  it("accepts and creates the organization membership exactly once", async () => {
    const ownerId = await makeUser();
    const organizationId = await makeOrg(ownerId);
    const inviteeEmail = `invitee-${crypto.randomUUID()}@example.com`;
    const inviteeId = await makeUser(inviteeEmail);

    const invite = await createOrRefreshInvitation(db, rawSql, { organizationId, actorUserId: ownerId, email: inviteeEmail, role: "member" });

    const outcome = await acceptInvitation(db, { token: invite.rawToken, actorUserId: inviteeId });

    expect(outcome.outcome).toBe("accepted");
    expect(outcome.organizationMembership).toEqual({ organizationId, userId: inviteeId, role: "member" });
    expect(outcome.workspaceMembership).toBeNull();

    const memberships = await db
      .select()
      .from(organizationMemberships)
      .where(sql`${organizationMemberships.organizationId} = ${organizationId} AND ${organizationMemberships.userId} = ${inviteeId}`);
    expect(memberships).toHaveLength(1);

    const [invitationRow] = await db.select().from(invitationsTable).where(eq(invitationsTable.id, invite.invitation.id));
    expect(invitationRow.status).toBe("accepted");
    expect(invitationRow.acceptedAt).not.toBeNull();
  });

  it("creates the optional workspace membership exactly once, alongside the organization membership", async () => {
    const ownerId = await makeUser();
    const organizationId = await makeOrg(ownerId);
    const ws = await createWorkspace(db, rawSql, { organizationId, actorUserId: ownerId, name: "Marketing", slug: "marketing" });
    const inviteeEmail = `ws-invitee-${crypto.randomUUID()}@example.com`;
    const inviteeId = await makeUser(inviteeEmail);

    const invite = await createOrRefreshInvitation(db, rawSql, {
      organizationId,
      actorUserId: ownerId,
      email: inviteeEmail,
      role: "member",
      workspace: { workspaceId: ws.workspace.id, workspaceRole: "viewer" },
    });

    const outcome = await acceptInvitation(db, { token: invite.rawToken, actorUserId: inviteeId });

    expect(outcome.workspaceMembership).toEqual({ workspaceId: ws.workspace.id, organizationId, userId: inviteeId, role: "viewer" });

    const orgRows = await db
      .select()
      .from(organizationMemberships)
      .where(sql`${organizationMemberships.organizationId} = ${organizationId} AND ${organizationMemberships.userId} = ${inviteeId}`);
    const wsRows = await db
      .select()
      .from(workspaceMemberships)
      .where(sql`${workspaceMemberships.workspaceId} = ${ws.workspace.id} AND ${workspaceMemberships.userId} = ${inviteeId}`);
    expect(orgRows).toHaveLength(1);
    expect(wsRows).toHaveLength(1);
  });

  it("rejects acceptance when the authenticated user's own email doesn't match the invitation", async () => {
    const ownerId = await makeUser();
    const organizationId = await makeOrg(ownerId);
    const wrongUserId = await makeUser(`someone-else-${crypto.randomUUID()}@example.com`);

    const invite = await createOrRefreshInvitation(db, rawSql, {
      organizationId,
      actorUserId: ownerId,
      email: `intended-${crypto.randomUUID()}@example.com`,
      role: "member",
    });

    await expect(acceptInvitation(db, { token: invite.rawToken, actorUserId: wrongUserId })).rejects.toBeInstanceOf(InvitationEmailMismatchError);

    const memberships = await db
      .select()
      .from(organizationMemberships)
      .where(sql`${organizationMemberships.organizationId} = ${organizationId} AND ${organizationMemberships.userId} = ${wrongUserId}`);
    expect(memberships).toHaveLength(0);
  });

  it("never downgrades an existing stronger organization role", async () => {
    const ownerId = await makeUser();
    const organizationId = await makeOrg(ownerId);
    const inviteeEmail = `admin-invitee-${crypto.randomUUID()}@example.com`;
    const inviteeId = await makeUser(inviteeEmail);
    // Already an admin, independent of this invitation.
    await db.insert(organizationMemberships).values({ organizationId, userId: inviteeId, role: "admin" });

    const invite = await createOrRefreshInvitation(db, rawSql, { organizationId, actorUserId: ownerId, email: inviteeEmail, role: "member" });
    const outcome = await acceptInvitation(db, { token: invite.rawToken, actorUserId: inviteeId });

    expect(outcome.organizationMembership.role).toBe("admin"); // NOT downgraded to "member"

    const rows = await db
      .select()
      .from(organizationMemberships)
      .where(sql`${organizationMemberships.organizationId} = ${organizationId} AND ${organizationMemberships.userId} = ${inviteeId}`);
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("admin");
  });

  it("is single-use: a second acceptance attempt after success is idempotent, not a duplicate", async () => {
    const ownerId = await makeUser();
    const organizationId = await makeOrg(ownerId);
    const inviteeEmail = `single-use-${crypto.randomUUID()}@example.com`;
    const inviteeId = await makeUser(inviteeEmail);

    const invite = await createOrRefreshInvitation(db, rawSql, { organizationId, actorUserId: ownerId, email: inviteeEmail, role: "member" });

    const first = await acceptInvitation(db, { token: invite.rawToken, actorUserId: inviteeId });
    const second = await acceptInvitation(db, { token: invite.rawToken, actorUserId: inviteeId });

    expect(first.outcome).toBe("accepted");
    expect(second.outcome).toBe("already_member");
    expect(second.organizationMembership).toEqual(first.organizationMembership);

    const rows = await db
      .select()
      .from(organizationMemberships)
      .where(sql`${organizationMemberships.organizationId} = ${organizationId} AND ${organizationMemberships.userId} = ${inviteeId}`);
    expect(rows).toHaveLength(1); // no duplicate row
  });

  it("a genuinely different user cannot accept an already-consumed invitation", async () => {
    const ownerId = await makeUser();
    const organizationId = await makeOrg(ownerId);
    const inviteeEmail = `consumed-${crypto.randomUUID()}@example.com`;
    const inviteeId = await makeUser(inviteeEmail);

    const invite = await createOrRefreshInvitation(db, rawSql, { organizationId, actorUserId: ownerId, email: inviteeEmail, role: "member" });
    await acceptInvitation(db, { token: invite.rawToken, actorUserId: inviteeId });

    // A second, different user attempting the identical (already-consumed) token — blocked by the email-match check first, since the invitation's email is fixed to `inviteeEmail`.
    const otherUserId = await makeUser(`other-${crypto.randomUUID()}@example.com`);
    await expect(acceptInvitation(db, { token: invite.rawToken, actorUserId: otherUserId })).rejects.toBeInstanceOf(InvitationEmailMismatchError);
  });

  it("rejects an expired invitation and creates no membership (full rollback)", async () => {
    const ownerId = await makeUser();
    const organizationId = await makeOrg(ownerId);
    const inviteeEmail = `expired-${crypto.randomUUID()}@example.com`;
    const inviteeId = await makeUser(inviteeEmail);

    const invite = await createOrRefreshInvitation(db, rawSql, { organizationId, actorUserId: ownerId, email: inviteeEmail, role: "member" });
    await db.update(invitationsTable).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invitationsTable.id, invite.invitation.id));

    await expect(acceptInvitation(db, { token: invite.rawToken, actorUserId: inviteeId })).rejects.toMatchObject({
      code: "invitation_not_available",
      internalReason: "expired",
    });

    const rows = await db
      .select()
      .from(organizationMemberships)
      .where(sql`${organizationMemberships.organizationId} = ${organizationId} AND ${organizationMemberships.userId} = ${inviteeId}`);
    expect(rows).toHaveLength(0);

    const [invitationRow] = await db.select().from(invitationsTable).where(eq(invitationsTable.id, invite.invitation.id));
    expect(invitationRow.status).toBe("expired");
    expect(invitationRow.acceptedAt).toBeNull();
  });

  it("rejects a revoked invitation and creates no membership", async () => {
    const ownerId = await makeUser();
    const organizationId = await makeOrg(ownerId);
    const inviteeEmail = `revoked-accept-${crypto.randomUUID()}@example.com`;
    const inviteeId = await makeUser(inviteeEmail);

    const invite = await createOrRefreshInvitation(db, rawSql, { organizationId, actorUserId: ownerId, email: inviteeEmail, role: "member" });
    await db.update(invitationsTable).set({ status: "revoked" }).where(eq(invitationsTable.id, invite.invitation.id));

    await expect(acceptInvitation(db, { token: invite.rawToken, actorUserId: inviteeId })).rejects.toMatchObject({
      code: "invitation_not_available",
      internalReason: "revoked",
    });

    const rows = await db
      .select()
      .from(organizationMemberships)
      .where(sql`${organizationMemberships.organizationId} = ${organizationId} AND ${organizationMemberships.userId} = ${inviteeId}`);
    expect(rows).toHaveLength(0);
  });

  it("concurrent acceptance attempts by the same user produce exactly one accepted outcome and no duplicate memberships", async () => {
    const ownerId = await makeUser();
    const organizationId = await makeOrg(ownerId);
    const ws = await createWorkspace(db, rawSql, { organizationId, actorUserId: ownerId, name: "Growth", slug: "growth" });
    const inviteeEmail = `concurrent-${crypto.randomUUID()}@example.com`;
    const inviteeId = await makeUser(inviteeEmail);

    const invite = await createOrRefreshInvitation(db, rawSql, {
      organizationId,
      actorUserId: ownerId,
      email: inviteeEmail,
      role: "member",
      workspace: { workspaceId: ws.workspace.id, workspaceRole: "member" },
    });

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => acceptInvitation(db, { token: invite.rawToken, actorUserId: inviteeId }))
    );

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const fulfilled = results as PromiseFulfilledResult<Awaited<ReturnType<typeof acceptInvitation>>>[];
    const acceptedCount = fulfilled.filter((r) => r.value.outcome === "accepted").length;
    const alreadyMemberCount = fulfilled.filter((r) => r.value.outcome === "already_member").length;

    expect(acceptedCount).toBe(1);
    expect(alreadyMemberCount).toBe(7);

    const orgRows = await db
      .select()
      .from(organizationMemberships)
      .where(sql`${organizationMemberships.organizationId} = ${organizationId} AND ${organizationMemberships.userId} = ${inviteeId}`);
    const wsRows = await db
      .select()
      .from(workspaceMemberships)
      .where(sql`${workspaceMemberships.workspaceId} = ${ws.workspace.id} AND ${workspaceMemberships.userId} = ${inviteeId}`);
    expect(orgRows).toHaveLength(1);
    expect(wsRows).toHaveLength(1);
  });

  it("never persists the raw token anywhere, and never logs it or the accept URL", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const ownerId = await makeUser();
      const organizationId = await makeOrg(ownerId);
      const inviteeEmail = `no-secrets-${crypto.randomUUID()}@example.com`;
      const inviteeId = await makeUser(inviteeEmail);

      const invite = await createOrRefreshInvitation(db, rawSql, { organizationId, actorUserId: ownerId, email: inviteeEmail, role: "member" });
      await acceptInvitation(db, { token: invite.rawToken, actorUserId: inviteeId });
      // Also exercise a failure path (already-used, second real attempt after acceptance would be idempotent, so force a genuine failure instead).
      await db.update(invitationsTable).set({ status: "revoked" }).where(eq(invitationsTable.id, invite.invitation.id));
      const otherId = await makeUser();
      await acceptInvitation(db, { token: invite.rawToken, actorUserId: otherId }).catch(() => undefined);

      const loggedText = consoleErrorSpy.mock.calls.map((call) => JSON.stringify(call)).join("\n");
      expect(loggedText).not.toContain(invite.rawToken);

      const [invitationRow] = await db.select().from(invitationsTable).where(eq(invitationsTable.id, invite.invitation.id));
      expect(invitationRow.tokenHash).not.toBe(invite.rawToken);
      expect(invitationRow.tokenHash).toBe(hashInvitationToken(invite.rawToken));

      const auditRows = await db.select().from(auditLogs).where(eq(auditLogs.organizationId, organizationId));
      const auditText = JSON.stringify(auditRows);
      expect(auditText).not.toContain(invite.rawToken);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
