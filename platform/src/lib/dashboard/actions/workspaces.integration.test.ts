import { describe, it, expect, afterEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, workspaces, workspaceMemberships, auditLogs } from "@/db/schema";
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

import {
  createWorkspaceAction,
  updateWorkspaceAction,
  deleteWorkspaceAction,
  addWorkspaceMemberAction,
  changeWorkspaceRoleAction,
  removeWorkspaceMemberAction,
} from "./workspaces";

const env = loadEnv();
const db = createDbClient(env);

const createdUserIds: string[] = [];
const createdOrgIds: string[] = [];

async function makeUser(email?: string): Promise<string> {
  const [user] = await db.insert(users).values({ email: email ?? `s5b-ws-action-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function authenticateAs(userId: string): Promise<void> {
  const { rawToken } = await createSession(db, { userId });
  cookieStore.set(SESSION_COOKIE_NAME, rawToken);
}

async function makeOrgWithOwner(ownerId: string): Promise<{ orgId: string; slug: string }> {
  const orgSlug = `s5b-ws-org-${crypto.randomUUID().slice(0, 8)}`;
  const [org] = await db.insert(organizations).values({ name: "Test Org", slug: orgSlug }).returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: ownerId, role: "owner" });
  createdOrgIds.push(org.id);
  return { orgId: org.id, slug: orgSlug };
}

async function addOrgMember(orgId: string, userId: string, role: "admin" | "member" | "viewer"): Promise<void> {
  await db.insert(organizationMemberships).values({ organizationId: orgId, userId, role });
}

async function makeWorkspace(orgId: string, managerId: string, slug?: string): Promise<{ workspaceId: string; slug: string }> {
  const wsSlug = slug ?? `mkt-${crypto.randomUUID().slice(0, 8)}`;
  const [ws] = await db.insert(workspaces).values({ organizationId: orgId, name: "Marketing", slug: wsSlug }).returning({ id: workspaces.id });
  await db.insert(workspaceMemberships).values({ workspaceId: ws.id, userId: managerId, role: "manager" });
  return { workspaceId: ws.id, slug: wsSlug };
}

async function addWsMember(workspaceId: string, userId: string, role: "member" | "viewer"): Promise<void> {
  await db.insert(workspaceMemberships).values({ workspaceId, userId, role });
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
    await db.delete(auditLogs).where(sql`${auditLogs.organizationId} = ${id}`);
    await db.delete(organizations).where(sql`${organizations.id} = ${id}`);
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await db.delete(users).where(sql`${users.id} = ${id}`);
  }
});

describe("createWorkspaceAction", () => {
  it("redirects to sign-in when unauthenticated", async () => {
    const orgSlug = `s5b-anon-${crypto.randomUUID().slice(0, 8)}`;
    await expect(createWorkspaceAction(orgSlug, formData({ name: "Mkt", slug: "mkt" }))).rejects.toThrow();
    expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining("/sign-in-required"));
  });

  it("creates a workspace and atomically grants the creator manager access — no other org member gains access", async () => {
    const ownerId = await makeUser();
    const bystanderMemberId = await makeUser();
    const { slug: orgSlug, orgId } = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, bystanderMemberId, "member");
    await authenticateAs(ownerId);
    const wsSlug = `mkt-${crypto.randomUUID().slice(0, 8)}`;

    await expect(createWorkspaceAction(orgSlug, formData({ name: "Marketing", slug: wsSlug }))).rejects.toThrow(`REDIRECT:/app/${orgSlug}/${wsSlug}`);

    const [ws] = await db.select({ id: workspaces.id }).from(workspaces).where(sql`${workspaces.slug} = ${wsSlug}`);
    const memberships = await db.select().from(workspaceMemberships).where(sql`${workspaceMemberships.workspaceId} = ${ws.id}`);
    expect(memberships).toHaveLength(1);
    expect(memberships[0].userId).toBe(ownerId);
    expect(memberships[0].role).toBe("manager");
  });

  it("does not allow a plain org member to create a workspace", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const { slug: orgSlug, orgId } = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, memberId, "member");
    await authenticateAs(memberId);

    const result = await createWorkspaceAction(orgSlug, formData({ name: "Marketing", slug: `mkt-${crypto.randomUUID().slice(0, 8)}` }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });

  it("rejects a reserved workspace slug", async () => {
    const ownerId = await makeUser();
    const { slug: orgSlug } = await makeOrgWithOwner(ownerId);
    await authenticateAs(ownerId);

    const result = await createWorkspaceAction(orgSlug, formData({ name: "Settings", slug: "settings" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_request");
  });
});

describe("updateWorkspaceAction — administration access via manager or org-admin-override", () => {
  it("lets the workspace manager update it", async () => {
    const ownerId = await makeUser();
    const { slug: orgSlug, orgId } = await makeOrgWithOwner(ownerId);
    const { slug: wsSlug, workspaceId } = await makeWorkspace(orgId, ownerId);
    await authenticateAs(ownerId);

    const result = await updateWorkspaceAction(orgSlug, wsSlug, formData({ name: "Renamed Workspace" }));
    expect(result.ok).toBe(true);

    const [ws] = await db.select({ name: workspaces.name }).from(workspaces).where(sql`${workspaces.id} = ${workspaceId}`);
    expect(ws.name).toBe("Renamed Workspace");
  });

  it("lets an org admin update a workspace they hold no explicit membership in (admin-override), without granting them content access", async () => {
    const ownerId = await makeUser();
    const adminId = await makeUser();
    const { slug: orgSlug, orgId } = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, adminId, "admin");
    const { slug: wsSlug, workspaceId } = await makeWorkspace(orgId, ownerId);
    await authenticateAs(adminId);

    const result = await updateWorkspaceAction(orgSlug, wsSlug, formData({ name: "Admin Renamed" }));
    expect(result.ok).toBe(true);

    // The override grants administration only — no workspace_memberships row is ever created for the admin.
    const rows = await db
      .select()
      .from(workspaceMemberships)
      .where(sql`${workspaceMemberships.workspaceId} = ${workspaceId} and ${workspaceMemberships.userId} = ${adminId}`);
    expect(rows).toHaveLength(0);
  });

  it("does not let a plain org member (no workspace membership) reach workspace administration", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const { slug: orgSlug, orgId } = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, memberId, "member");
    const { slug: wsSlug } = await makeWorkspace(orgId, ownerId);
    await authenticateAs(memberId);

    const result = await updateWorkspaceAction(orgSlug, wsSlug, formData({ name: "Should Not Apply" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });

  it("does not let a workspace viewer administer it", async () => {
    const ownerId = await makeUser();
    const viewerId = await makeUser();
    const { slug: orgSlug, orgId } = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, viewerId, "member");
    const { slug: wsSlug, workspaceId } = await makeWorkspace(orgId, ownerId);
    await addWsMember(workspaceId, viewerId, "viewer");
    await authenticateAs(viewerId);

    const result = await updateWorkspaceAction(orgSlug, wsSlug, formData({ name: "Should Not Apply" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });

  it("returns a safe slug_taken error on a duplicate workspace slug within the same organization", async () => {
    const ownerId = await makeUser();
    const { slug: orgSlug, orgId } = await makeOrgWithOwner(ownerId);
    const { slug: slugA } = await makeWorkspace(orgId, ownerId);
    const { slug: slugB } = await makeWorkspace(orgId, ownerId);
    await authenticateAs(ownerId);

    const result = await updateWorkspaceAction(orgSlug, slugA, formData({ slug: slugB }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("slug_taken");
  });
});

describe("deleteWorkspaceAction", () => {
  it("lets an org owner delete a workspace", async () => {
    const ownerId = await makeUser();
    const { slug: orgSlug, orgId } = await makeOrgWithOwner(ownerId);
    const { slug: wsSlug, workspaceId } = await makeWorkspace(orgId, ownerId);
    await authenticateAs(ownerId);

    await expect(deleteWorkspaceAction(orgSlug, wsSlug)).rejects.toThrow(`REDIRECT:/app/${orgSlug}`);

    const [ws] = await db.select({ deletedAt: workspaces.deletedAt }).from(workspaces).where(sql`${workspaces.id} = ${workspaceId}`);
    expect(ws.deletedAt).not.toBeNull();
  });

  it("lets an org admin delete a workspace via the override", async () => {
    const ownerId = await makeUser();
    const adminId = await makeUser();
    const { slug: orgSlug, orgId } = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, adminId, "admin");
    const { slug: wsSlug } = await makeWorkspace(orgId, ownerId);
    await authenticateAs(adminId);

    await expect(deleteWorkspaceAction(orgSlug, wsSlug)).rejects.toThrow(`REDIRECT:/app/${orgSlug}`);
  });

  it("does not let a workspace manager delete their own workspace", async () => {
    const ownerId = await makeUser();
    const managerId = await makeUser();
    const { slug: orgSlug, orgId } = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, managerId, "member");
    const { slug: wsSlug, workspaceId } = await makeWorkspace(orgId, managerId);
    await authenticateAs(managerId);

    const result = await deleteWorkspaceAction(orgSlug, wsSlug);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("workspace_deletion_not_permitted");

    const [ws] = await db.select({ deletedAt: workspaces.deletedAt }).from(workspaces).where(sql`${workspaces.id} = ${workspaceId}`);
    expect(ws.deletedAt).toBeNull();
  });

  it("a deleted workspace no longer resolves for administration afterward", async () => {
    const ownerId = await makeUser();
    const { slug: orgSlug, orgId } = await makeOrgWithOwner(ownerId);
    const { slug: wsSlug } = await makeWorkspace(orgId, ownerId);
    await authenticateAs(ownerId);
    await expect(deleteWorkspaceAction(orgSlug, wsSlug)).rejects.toThrow();

    const result = await updateWorkspaceAction(orgSlug, wsSlug, formData({ name: "Should Fail" }));
    expect(result.ok).toBe(false);
  });
});

describe("addWorkspaceMemberAction", () => {
  it("adds an existing organization member by email", async () => {
    const ownerId = await makeUser();
    const memberEmail = `s5b-ws-action-candidate-${crypto.randomUUID()}@example.com`;
    const memberId = await makeUser(memberEmail);
    const { slug: orgSlug, orgId } = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, memberId, "member");
    const { slug: wsSlug, workspaceId } = await makeWorkspace(orgId, ownerId);
    await authenticateAs(ownerId);

    const result = await addWorkspaceMemberAction(orgSlug, wsSlug, formData({ email: memberEmail, role: "member" }));
    expect(result.ok).toBe(true);

    const [row] = await db
      .select({ role: workspaceMemberships.role })
      .from(workspaceMemberships)
      .where(sql`${workspaceMemberships.workspaceId} = ${workspaceId} and ${workspaceMemberships.userId} = ${memberId}`);
    expect(row.role).toBe("member");
  });

  it("never adds a user who is not a member of the parent organization, even by a valid email in the system", async () => {
    const ownerId = await makeUser();
    const strangerEmail = `s5b-ws-action-stranger-${crypto.randomUUID()}@example.com`;
    await makeUser(strangerEmail);
    const { slug: orgSlug, orgId } = await makeOrgWithOwner(ownerId);
    const { slug: wsSlug } = await makeWorkspace(orgId, ownerId);
    await authenticateAs(ownerId);

    const result = await addWorkspaceMemberAction(orgSlug, wsSlug, formData({ email: strangerEmail, role: "member" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("parent_membership_required");
  });

  it("returns the same safe error for an email that matches no user at all (never leaks which case it was)", async () => {
    const ownerId = await makeUser();
    const { slug: orgSlug, orgId } = await makeOrgWithOwner(ownerId);
    const { slug: wsSlug } = await makeWorkspace(orgId, ownerId);
    await authenticateAs(ownerId);

    const result = await addWorkspaceMemberAction(orgSlug, wsSlug, formData({ email: "nobody-at-all@example.com", role: "member" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("parent_membership_required");
  });

  it("does not let an org admin's own attempt bypass validation with a malformed role", async () => {
    const ownerId = await makeUser();
    const memberEmail = `s5b-ws-action-candidate2-${crypto.randomUUID()}@example.com`;
    const memberId = await makeUser(memberEmail);
    const { slug: orgSlug, orgId } = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, memberId, "member");
    const { slug: wsSlug } = await makeWorkspace(orgId, ownerId);
    await authenticateAs(ownerId);

    const result = await addWorkspaceMemberAction(orgSlug, wsSlug, formData({ email: memberEmail, role: "superuser" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_request");
  });
});

describe("changeWorkspaceRoleAction / removeWorkspaceMemberAction", () => {
  it("lets the manager change a workspace member's role", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const org = await makeOrgWithOwner(ownerId);
    await addOrgMember(org.orgId, memberId, "member");
    const { slug: wsSlug, workspaceId } = await makeWorkspace(org.orgId, ownerId);
    await addWsMember(workspaceId, memberId, "member");
    await authenticateAs(ownerId);

    const result = await changeWorkspaceRoleAction(org.slug, wsSlug, memberId, formData({ role: "viewer" }));
    expect(result.ok).toBe(true);

    const [row] = await db
      .select({ role: workspaceMemberships.role })
      .from(workspaceMemberships)
      .where(sql`${workspaceMemberships.workspaceId} = ${workspaceId} and ${workspaceMemberships.userId} = ${memberId}`);
    expect(row.role).toBe("viewer");
  });

  it("prevents a manager from changing their own workspace role", async () => {
    const ownerId = await makeUser();
    const org = await makeOrgWithOwner(ownerId);
    const { slug: wsSlug } = await makeWorkspace(org.orgId, ownerId);
    await authenticateAs(ownerId);

    const result = await changeWorkspaceRoleAction(org.slug, wsSlug, ownerId, formData({ role: "member" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("self_role_change");
  });

  it("lets the manager remove a workspace member, and org admin override also works", async () => {
    const ownerId = await makeUser();
    const adminId = await makeUser();
    const memberId = await makeUser();
    const org = await makeOrgWithOwner(ownerId);
    await addOrgMember(org.orgId, adminId, "admin");
    await addOrgMember(org.orgId, memberId, "member");
    const { slug: wsSlug, workspaceId } = await makeWorkspace(org.orgId, ownerId);
    await addWsMember(workspaceId, memberId, "member");

    await authenticateAs(adminId);
    const result = await removeWorkspaceMemberAction(org.slug, wsSlug, memberId);
    expect(result.ok).toBe(true);

    const rows = await db
      .select()
      .from(workspaceMemberships)
      .where(sql`${workspaceMemberships.workspaceId} = ${workspaceId} and ${workspaceMemberships.userId} = ${memberId}`);
    expect(rows).toHaveLength(0);
  });

  it("does not let a workspace viewer remove another member", async () => {
    const ownerId = await makeUser();
    const viewerId = await makeUser();
    const targetId = await makeUser();
    const org = await makeOrgWithOwner(ownerId);
    await addOrgMember(org.orgId, viewerId, "member");
    await addOrgMember(org.orgId, targetId, "member");
    const { slug: wsSlug, workspaceId } = await makeWorkspace(org.orgId, ownerId);
    await addWsMember(workspaceId, viewerId, "viewer");
    await addWsMember(workspaceId, targetId, "member");
    await authenticateAs(viewerId);

    const result = await removeWorkspaceMemberAction(org.slug, wsSlug, targetId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });
});

describe("data serialization boundary", () => {
  it("no ActionResult ever contains a stack trace, SQL text, or the session cookie", async () => {
    const ownerId = await makeUser();
    const org = await makeOrgWithOwner(ownerId);
    await authenticateAs(ownerId);

    const result = await createWorkspaceAction(org.slug, formData({ name: "x", slug: "settings" }));
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/at Object|at async|node_modules|__Host-lynq_session|SELECT |INSERT |UPDATE /i);
  });
});
