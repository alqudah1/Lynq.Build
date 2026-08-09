import { describe, it, expect, afterEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, auditLogs } from "@/db/schema";
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
  createOrganizationAction,
  updateOrganizationAction,
  deleteOrganizationAction,
  changeOrganizationRoleAction,
  removeOrganizationMemberAction,
} from "./organizations";

const env = loadEnv();
const db = createDbClient(env);

const createdUserIds: string[] = [];
const createdOrgIds: string[] = [];

async function makeUser(email?: string): Promise<string> {
  const [user] = await db.insert(users).values({ email: email ?? `s5b-org-action-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function authenticateAs(userId: string): Promise<void> {
  const { rawToken } = await createSession(db, { userId });
  cookieStore.set(SESSION_COOKIE_NAME, rawToken);
}

async function makeOrgWithOwner(ownerId: string, slug?: string): Promise<{ orgId: string; slug: string }> {
  const orgSlug = slug ?? `s5b-org-${crypto.randomUUID().slice(0, 8)}`;
  const [org] = await db.insert(organizations).values({ name: "Test Org", slug: orgSlug }).returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: ownerId, role: "owner" });
  createdOrgIds.push(org.id);
  return { orgId: org.id, slug: orgSlug };
}

async function addMember(orgId: string, userId: string, role: "admin" | "member" | "viewer"): Promise<void> {
  await db.insert(organizationMemberships).values({ organizationId: orgId, userId, role });
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

describe("createOrganizationAction", () => {
  it("redirects to sign-in when unauthenticated", async () => {
    await expect(createOrganizationAction(formData({ name: "Acme", slug: `acme-${crypto.randomUUID()}` }))).rejects.toThrow();
    expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining("/sign-in-required"));
  });

  it("creates the organization and redirects to its dashboard on success", async () => {
    const userId = await makeUser();
    await authenticateAs(userId);
    const slug = `acme-${crypto.randomUUID().slice(0, 8)}`;

    await expect(createOrganizationAction(formData({ name: "Acme", slug }))).rejects.toThrow(`REDIRECT:/app/${slug}`);

    const [org] = await db.select({ id: organizations.id }).from(organizations).where(sql`${organizations.slug} = ${slug}`);
    createdOrgIds.push(org.id);
    const [membership] = await db
      .select({ role: organizationMemberships.role })
      .from(organizationMemberships)
      .where(sql`${organizationMemberships.organizationId} = ${org.id} and ${organizationMemberships.userId} = ${userId}`);
    expect(membership.role).toBe("owner");
  });

  it("rejects a reserved slug ('new') with a validation error, never hitting the database", async () => {
    const userId = await makeUser();
    await authenticateAs(userId);

    const result = await createOrganizationAction(formData({ name: "Acme", slug: "new" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_request");
  });

  it("returns a safe slug_taken error on a duplicate slug — never a raw database error", async () => {
    const userId = await makeUser();
    await authenticateAs(userId);
    const { slug } = await makeOrgWithOwner(userId);

    const result = await createOrganizationAction(formData({ name: "Another", slug }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("slug_taken");
      expect(JSON.stringify(result)).not.toMatch(/duplicate key|constraint|SELECT |INSERT /i);
    }
  });
});

describe("updateOrganizationAction", () => {
  it("lets an owner update the name", async () => {
    const userId = await makeUser();
    await authenticateAs(userId);
    const { slug } = await makeOrgWithOwner(userId);

    const result = await updateOrganizationAction(slug, formData({ name: "Renamed Co" }));
    expect(result.ok).toBe(true);

    const [org] = await db.select({ name: organizations.name }).from(organizations).where(sql`${organizations.slug} = ${slug}`);
    expect(org.name).toBe("Renamed Co");
  });

  it("lets an admin update the name", async () => {
    const ownerId = await makeUser();
    const adminId = await makeUser();
    const { slug, orgId } = await makeOrgWithOwner(ownerId);
    await addMember(orgId, adminId, "admin");
    await authenticateAs(adminId);

    const result = await updateOrganizationAction(slug, formData({ name: "Admin Renamed" }));
    expect(result.ok).toBe(true);
  });

  it("does not allow a plain member to update organization settings", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const { slug, orgId } = await makeOrgWithOwner(ownerId);
    await addMember(orgId, memberId, "member");
    await authenticateAs(memberId);

    const result = await updateOrganizationAction(slug, formData({ name: "Should Not Apply" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });

  it("does not allow a viewer to update organization settings", async () => {
    const ownerId = await makeUser();
    const viewerId = await makeUser();
    const { slug, orgId } = await makeOrgWithOwner(ownerId);
    await addMember(orgId, viewerId, "viewer");
    await authenticateAs(viewerId);

    const result = await updateOrganizationAction(slug, formData({ name: "Should Not Apply" }));
    expect(result.ok).toBe(false);
  });

  it("returns a safe slug_taken error when renaming into another organization's slug", async () => {
    const userId = await makeUser();
    await authenticateAs(userId);
    const { slug: slugA } = await makeOrgWithOwner(userId);
    const { slug: slugB } = await makeOrgWithOwner(userId);

    const result = await updateOrganizationAction(slugA, formData({ slug: slugB }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("slug_taken");
  });

  it("rejects a reserved slug on rename", async () => {
    const userId = await makeUser();
    await authenticateAs(userId);
    const { slug } = await makeOrgWithOwner(userId);

    const result = await updateOrganizationAction(slug, formData({ slug: "new" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_request");
  });
});

describe("deleteOrganizationAction", () => {
  it("lets the owner delete (soft-delete) the organization and redirects to /app", async () => {
    const userId = await makeUser();
    await authenticateAs(userId);
    const { slug, orgId } = await makeOrgWithOwner(userId);

    await expect(deleteOrganizationAction(slug)).rejects.toThrow("REDIRECT:/app");

    const [org] = await db.select({ deletedAt: organizations.deletedAt }).from(organizations).where(sql`${organizations.id} = ${orgId}`);
    expect(org.deletedAt).not.toBeNull();
  });

  it("does not let an admin delete the organization", async () => {
    const ownerId = await makeUser();
    const adminId = await makeUser();
    const { slug, orgId } = await makeOrgWithOwner(ownerId);
    await addMember(orgId, adminId, "admin");
    await authenticateAs(adminId);

    const result = await deleteOrganizationAction(slug);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");

    const [org] = await db.select({ deletedAt: organizations.deletedAt }).from(organizations).where(sql`${organizations.id} = ${orgId}`);
    expect(org.deletedAt).toBeNull();
  });

  it("a deleted organization no longer resolves for its former owner (disappears from the dashboard)", async () => {
    const userId = await makeUser();
    await authenticateAs(userId);
    const { slug } = await makeOrgWithOwner(userId);
    await expect(deleteOrganizationAction(slug)).rejects.toThrow();

    const result = await updateOrganizationAction(slug, formData({ name: "Should Fail" }));
    expect(result.ok).toBe(false);
  });
});

describe("changeOrganizationRoleAction", () => {
  it("lets an owner promote a member to admin", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const { slug, orgId } = await makeOrgWithOwner(ownerId);
    await addMember(orgId, memberId, "member");
    await authenticateAs(ownerId);

    const result = await changeOrganizationRoleAction(slug, memberId, formData({ role: "admin" }));
    expect(result.ok).toBe(true);

    const [membership] = await db
      .select({ role: organizationMemberships.role })
      .from(organizationMemberships)
      .where(sql`${organizationMemberships.organizationId} = ${orgId} and ${organizationMemberships.userId} = ${memberId}`);
    expect(membership.role).toBe("admin");
  });

  it("prevents a user from changing their own role, even the owner", async () => {
    const ownerId = await makeUser();
    const { slug } = await makeOrgWithOwner(ownerId);
    await authenticateAs(ownerId);

    const result = await changeOrganizationRoleAction(slug, ownerId, formData({ role: "admin" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("self_role_change");
  });

  it("prevents an admin from changing the owner's role", async () => {
    const ownerId = await makeUser();
    const adminId = await makeUser();
    const { slug, orgId } = await makeOrgWithOwner(ownerId);
    await addMember(orgId, adminId, "admin");
    await authenticateAs(adminId);

    const result = await changeOrganizationRoleAction(slug, ownerId, formData({ role: "member" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("admin_cannot_act_on_owner");
  });

  it("allows one owner to demote another owner once a second owner exists", async () => {
    const ownerId = await makeUser();
    const secondOwnerId = await makeUser();
    const { slug, orgId } = await makeOrgWithOwner(ownerId);
    await addMember(orgId, secondOwnerId, "member");
    await authenticateAs(ownerId);

    const promote = await changeOrganizationRoleAction(slug, secondOwnerId, formData({ role: "owner" }));
    expect(promote.ok).toBe(true);

    await authenticateAs(secondOwnerId);
    const demoteFirst = await changeOrganizationRoleAction(slug, ownerId, formData({ role: "admin" }));
    expect(demoteFirst.ok).toBe(true);

    const [membership] = await db
      .select({ role: organizationMemberships.role })
      .from(organizationMemberships)
      .where(sql`${organizationMemberships.organizationId} = ${orgId} and ${organizationMemberships.userId} = ${ownerId}`);
    expect(membership.role).toBe("admin");
  });

  it("does not let a member change anyone's role", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const otherId = await makeUser();
    const { slug, orgId } = await makeOrgWithOwner(ownerId);
    await addMember(orgId, memberId, "member");
    await addMember(orgId, otherId, "viewer");
    await authenticateAs(memberId);

    const result = await changeOrganizationRoleAction(slug, otherId, formData({ role: "member" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });

  it("does not trust a client-supplied role bypassing schema validation", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const { slug, orgId } = await makeOrgWithOwner(ownerId);
    await addMember(orgId, memberId, "member");
    await authenticateAs(ownerId);

    const result = await changeOrganizationRoleAction(slug, memberId, formData({ role: "superadmin" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_request");
  });
});

describe("removeOrganizationMemberAction", () => {
  it("lets an owner remove a member", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const { slug, orgId } = await makeOrgWithOwner(ownerId);
    await addMember(orgId, memberId, "member");
    await authenticateAs(ownerId);

    const result = await removeOrganizationMemberAction(slug, memberId);
    expect(result.ok).toBe(true);

    const rows = await db
      .select()
      .from(organizationMemberships)
      .where(sql`${organizationMemberships.organizationId} = ${orgId} and ${organizationMemberships.userId} = ${memberId}`);
    expect(rows).toHaveLength(0);
  });

  it("prevents an admin from removing the owner", async () => {
    const ownerId = await makeUser();
    const adminId = await makeUser();
    const { slug, orgId } = await makeOrgWithOwner(ownerId);
    await addMember(orgId, adminId, "admin");
    await authenticateAs(adminId);

    const result = await removeOrganizationMemberAction(slug, ownerId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("admin_cannot_act_on_owner");
  });

  it("prevents removing the last owner", async () => {
    const ownerId = await makeUser();
    const { slug } = await makeOrgWithOwner(ownerId);
    await authenticateAs(ownerId);

    const result = await removeOrganizationMemberAction(slug, ownerId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("last_owner");
  });

  it("a client-supplied target ID for a user outside the organization never succeeds", async () => {
    const ownerId = await makeUser();
    const strangerId = await makeUser();
    const { slug } = await makeOrgWithOwner(ownerId);
    await authenticateAs(ownerId);

    const result = await removeOrganizationMemberAction(slug, strangerId);
    expect(result.ok).toBe(false);
  });
});

describe("data serialization boundary", () => {
  it("no ActionResult ever contains a stack trace, SQL text, or the session cookie", async () => {
    const userId = await makeUser();
    await authenticateAs(userId);
    const { slug } = await makeOrgWithOwner(userId);

    const result = await createOrganizationAction(formData({ name: "x", slug }));
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/at Object|at async|node_modules|__Host-lynq_session|SELECT |INSERT |UPDATE /i);
  });
});
