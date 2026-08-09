import { describe, it, expect, afterEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, workspaces, invitations, auditLogs } from "@/db/schema";
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

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

import { createOrRefreshInvitationAction, revokeInvitationAction } from "./invitations";

const env = loadEnv();
const db = createDbClient(env);

const createdUserIds: string[] = [];
const createdOrgIds: string[] = [];

async function makeUser(email?: string): Promise<string> {
  const [user] = await db.insert(users).values({ email: email ?? `s5c-inv-action-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function authenticateAs(userId: string): Promise<void> {
  const { rawToken } = await createSession(db, { userId });
  cookieStore.set(SESSION_COOKIE_NAME, rawToken);
}

async function makeOrgWithOwner(ownerId: string): Promise<{ orgId: string; slug: string }> {
  const orgSlug = `s5c-inv-org-${crypto.randomUUID().slice(0, 8)}`;
  const [org] = await db.insert(organizations).values({ name: "Test Org", slug: orgSlug }).returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: ownerId, role: "owner" });
  createdOrgIds.push(org.id);
  return { orgId: org.id, slug: orgSlug };
}

async function addOrgMember(orgId: string, userId: string, role: "admin" | "member" | "viewer"): Promise<void> {
  await db.insert(organizationMemberships).values({ organizationId: orgId, userId, role });
}

async function makeWorkspace(orgId: string): Promise<{ workspaceId: string }> {
  const [ws] = await db.insert(workspaces).values({ organizationId: orgId, name: "Marketing", slug: `mkt-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: workspaces.id });
  return { workspaceId: ws.id };
}

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

afterEach(async () => {
  cookieStore.clear();
  redirectMock.mockClear();
  while (createdOrgIds.length > 0) {
    const id = createdOrgIds.pop()!;
    await db.delete(invitations).where(sql`${invitations.organizationId} = ${id}`);
    await db.delete(auditLogs).where(sql`${auditLogs.organizationId} = ${id}`);
    await db.delete(organizations).where(sql`${organizations.id} = ${id}`);
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await db.delete(users).where(sql`${users.id} = ${id}`);
  }
});

describe("createOrRefreshInvitationAction", () => {
  it("redirects to sign-in when unauthenticated", async () => {
    await expect(createOrRefreshInvitationAction("some-org", formData({ email: "x@example.com", role: "member" }))).rejects.toThrow();
    expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining("/sign-in-required"));
  });

  it("lets an owner create an invitation", async () => {
    const ownerId = await makeUser();
    const { slug } = await makeOrgWithOwner(ownerId);
    await authenticateAs(ownerId);

    const result = await createOrRefreshInvitationAction(slug, formData({ email: "invitee@example.com", role: "member" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.refreshed).toBe(false);
  });

  it("lets an admin create an invitation", async () => {
    const ownerId = await makeUser();
    const adminId = await makeUser();
    const { slug, orgId } = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, adminId, "admin");
    await authenticateAs(adminId);

    const result = await createOrRefreshInvitationAction(slug, formData({ email: "invitee2@example.com", role: "member" }));
    expect(result.ok).toBe(true);
  });

  it("does not let a plain member create an invitation", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const { slug, orgId } = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, memberId, "member");
    await authenticateAs(memberId);

    const result = await createOrRefreshInvitationAction(slug, formData({ email: "nope@example.com", role: "member" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });

  it("does not let a viewer create an invitation", async () => {
    const ownerId = await makeUser();
    const viewerId = await makeUser();
    const { slug, orgId } = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, viewerId, "viewer");
    await authenticateAs(viewerId);

    const result = await createOrRefreshInvitationAction(slug, formData({ email: "nope2@example.com", role: "member" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });

  it("does not let an admin invite someone as owner", async () => {
    const ownerId = await makeUser();
    const adminId = await makeUser();
    const { slug, orgId } = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, adminId, "admin");
    await authenticateAs(adminId);

    const result = await createOrRefreshInvitationAction(slug, formData({ email: "wannabe-owner@example.com", role: "owner" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unauthorized_role");
  });

  it("lets an owner invite someone as owner", async () => {
    const ownerId = await makeUser();
    const { slug } = await makeOrgWithOwner(ownerId);
    await authenticateAs(ownerId);

    const result = await createOrRefreshInvitationAction(slug, formData({ email: "co-owner@example.com", role: "owner" }));
    expect(result.ok).toBe(true);
  });

  it("atomically refreshes a duplicate pending invitation instead of creating a second row", async () => {
    const ownerId = await makeUser();
    const { slug, orgId } = await makeOrgWithOwner(ownerId);
    await authenticateAs(ownerId);
    const email = "duplicate@example.com";

    const first = await createOrRefreshInvitationAction(slug, formData({ email, role: "member" }));
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.refreshed).toBe(false);

    const second = await createOrRefreshInvitationAction(slug, formData({ email, role: "admin" }));
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.refreshed).toBe(true);

    const rows = await db.select().from(invitations).where(sql`${invitations.organizationId} = ${orgId} and ${invitations.email} = ${email}`);
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("admin");
  });

  it("a workspace belonging to a different organization never submits successfully", async () => {
    const ownerId = await makeUser();
    const { slug } = await makeOrgWithOwner(ownerId);
    await authenticateAs(ownerId);

    const strangerOwnerId = await makeUser();
    const { orgId: otherOrgId } = await makeOrgWithOwner(strangerOwnerId);
    const { workspaceId: foreignWorkspaceId } = await makeWorkspace(otherOrgId);

    const result = await createOrRefreshInvitationAction(
      slug,
      formData({ email: "cross-org@example.com", role: "member", workspaceId: foreignWorkspaceId, workspaceRole: "member" })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_found");
  });

  it("succeeds with a workspace that genuinely belongs to this organization", async () => {
    const ownerId = await makeUser();
    const { slug, orgId } = await makeOrgWithOwner(ownerId);
    const { workspaceId } = await makeWorkspace(orgId);
    await authenticateAs(ownerId);

    const result = await createOrRefreshInvitationAction(
      slug,
      formData({ email: "with-workspace@example.com", role: "member", workspaceId, workspaceRole: "manager" })
    );
    expect(result.ok).toBe(true);
  });

  it("rejects an invalid email with a validation error", async () => {
    const ownerId = await makeUser();
    const { slug } = await makeOrgWithOwner(ownerId);
    await authenticateAs(ownerId);

    const result = await createOrRefreshInvitationAction(slug, formData({ email: "not-an-email", role: "member" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_request");
  });

  it("never returns a raw token or hash in the action result", async () => {
    const ownerId = await makeUser();
    const { slug } = await makeOrgWithOwner(ownerId);
    await authenticateAs(ownerId);

    const result = await createOrRefreshInvitationAction(slug, formData({ email: "safe-check@example.com", role: "member" }));
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/token|hash|at Object|node_modules|SELECT |INSERT /i);
  });
});

describe("revokeInvitationAction", () => {
  async function createPendingInvitation(orgId: string, ownerId: string, email: string): Promise<string> {
    const [row] = await db
      .insert(invitations)
      .values({ organizationId: orgId, email, role: "member", tokenHash: `hash-${crypto.randomUUID()}`, invitedByUserId: ownerId, status: "pending", expiresAt: new Date(Date.now() + 60_000) })
      .returning({ id: invitations.id });
    return row.id;
  }

  it("redirects to sign-in when unauthenticated", async () => {
    await expect(revokeInvitationAction("some-org", crypto.randomUUID())).rejects.toThrow();
    expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining("/sign-in-required"));
  });

  it("lets an owner revoke a pending invitation", async () => {
    const ownerId = await makeUser();
    const { slug, orgId } = await makeOrgWithOwner(ownerId);
    const invitationId = await createPendingInvitation(orgId, ownerId, "revoke-me@example.com");
    await authenticateAs(ownerId);

    const result = await revokeInvitationAction(slug, invitationId);
    expect(result.ok).toBe(true);

    const [row] = await db.select({ status: invitations.status }).from(invitations).where(sql`${invitations.id} = ${invitationId}`);
    expect(row.status).toBe("revoked");
  });

  it("lets an admin revoke a pending invitation", async () => {
    const ownerId = await makeUser();
    const adminId = await makeUser();
    const { slug, orgId } = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, adminId, "admin");
    const invitationId = await createPendingInvitation(orgId, ownerId, "revoke-me-2@example.com");
    await authenticateAs(adminId);

    const result = await revokeInvitationAction(slug, invitationId);
    expect(result.ok).toBe(true);
  });

  it("does not let a member revoke an invitation", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const { slug, orgId } = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, memberId, "member");
    const invitationId = await createPendingInvitation(orgId, ownerId, "revoke-me-3@example.com");
    await authenticateAs(memberId);

    const result = await revokeInvitationAction(slug, invitationId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");

    const [row] = await db.select({ status: invitations.status }).from(invitations).where(sql`${invitations.id} = ${invitationId}`);
    expect(row.status).toBe("pending");
  });

  it("does not let a viewer revoke an invitation", async () => {
    const ownerId = await makeUser();
    const viewerId = await makeUser();
    const { slug, orgId } = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, viewerId, "viewer");
    const invitationId = await createPendingInvitation(orgId, ownerId, "revoke-me-4@example.com");
    await authenticateAs(viewerId);

    const result = await revokeInvitationAction(slug, invitationId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });

  it("cannot revoke (or otherwise mutate) an already-accepted invitation", async () => {
    const ownerId = await makeUser();
    const { slug, orgId } = await makeOrgWithOwner(ownerId);
    const [row] = await db
      .insert(invitations)
      .values({
        organizationId: orgId,
        email: "already-accepted@example.com",
        role: "member",
        tokenHash: `hash-${crypto.randomUUID()}`,
        invitedByUserId: ownerId,
        status: "accepted",
        acceptedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning({ id: invitations.id });
    await authenticateAs(ownerId);

    const result = await revokeInvitationAction(slug, row.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("already_used");

    const [after] = await db.select({ status: invitations.status }).from(invitations).where(sql`${invitations.id} = ${row.id}`);
    expect(after.status).toBe("accepted");
  });

  it("revoking an already-revoked invitation fails safely (no double-revoke)", async () => {
    const ownerId = await makeUser();
    const { slug, orgId } = await makeOrgWithOwner(ownerId);
    const invitationId = await createPendingInvitation(orgId, ownerId, "double-revoke@example.com");
    await authenticateAs(ownerId);

    const first = await revokeInvitationAction(slug, invitationId);
    expect(first.ok).toBe(true);

    const second = await revokeInvitationAction(slug, invitationId);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("already_used");
  });

  it("a client-supplied invitation ID from a different organization is rejected as not found", async () => {
    const ownerId = await makeUser();
    const { slug } = await makeOrgWithOwner(ownerId);
    await authenticateAs(ownerId);

    const strangerOwnerId = await makeUser();
    const { orgId: otherOrgId } = await makeOrgWithOwner(strangerOwnerId);
    const foreignInvitationId = await createPendingInvitation(otherOrgId, strangerOwnerId, "foreign@example.com");

    const result = await revokeInvitationAction(slug, foreignInvitationId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_found");

    const [row] = await db.select({ status: invitations.status }).from(invitations).where(sql`${invitations.id} = ${foreignInvitationId}`);
    expect(row.status).toBe("pending");
  });
});
