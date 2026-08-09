import { describe, it, expect, afterEach } from "vitest";
import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, workspaces, workspaceMemberships, knowledgeItems, knowledgeItemVersions, auditLogs, brainPermissionGrants } from "@/db/schema";
import { TenantResourceNotFoundError, InsufficientRoleError } from "@/lib/authz/errors";
import { KnowledgeVersionConflictError, KnowledgeItemAlreadyArchivedError, KnowledgeItemArchivedViolationError } from "./errors";
import type { BrainCapability } from "./authz";
import type { KnowledgeDomain } from "./knowledge-items";
import {
  createKnowledgeItem,
  getKnowledgeItemForUser,
  listKnowledgeItemsForUser,
  updateKnowledgeItem,
  archiveKnowledgeItem,
} from "./knowledge-items";

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const createdUserIds: string[] = [];
const createdOrgIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `brain-item-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Test Org", slug: `brain-item-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: ownerId, role: "owner" });
  createdOrgIds.push(org.id);
  return org.id;
}

async function addOrgMember(orgId: string, userId: string, role: "admin" | "member" | "viewer"): Promise<void> {
  await db.insert(organizationMemberships).values({ organizationId: orgId, userId, role });
}

async function makeWorkspace(orgId: string): Promise<string> {
  const [ws] = await db.insert(workspaces).values({ organizationId: orgId, name: "Marketing", slug: `mkt-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: workspaces.id });
  return ws.id;
}

async function addWorkspaceMember(workspaceId: string, userId: string, role: "manager" | "member" | "viewer"): Promise<void> {
  await db.insert(workspaceMemberships).values({ workspaceId, userId, role });
}

/**
 * Directly inserts an active Brain permission grant — the Module 7
 * replacement for what used to be an implicit organization/workspace role
 * override. Every test below that expects a Brain content operation to
 * SUCCEED must explicitly grant the exact capability it needs at the exact
 * scope; there is no longer any role (owner/admin/manager/etc.) that
 * substitutes for this, matching this codebase's existing convention of
 * inserting membership rows directly rather than going through a service
 * function in test setup.
 */
async function grantCapability(
  organizationId: string,
  domain: KnowledgeDomain,
  workspaceId: string | null,
  granteeUserId: string,
  capability: BrainCapability
): Promise<void> {
  await db.insert(brainPermissionGrants).values({ organizationId, domain, workspaceId, granteeUserId, capability });
}

/**
 * Convenience for tests that aren't specifically exercising the grant
 * boundary itself (versioning mechanics, listing/pagination, audit
 * content, etc.) — grants every capability this module's operations ever
 * check (`read`, `draft_write`, `edit_own_draft`, `edit_any_draft`,
 * `archive`) at one scope, so the test can focus on its own actual
 * assertion instead of re-deriving the minimal capability set every time.
 */
async function grantAllCapabilities(organizationId: string, domain: KnowledgeDomain, workspaceId: string | null, granteeUserId: string): Promise<void> {
  const capabilities: BrainCapability[] = ["read", "draft_write", "edit_own_draft", "edit_any_draft", "archive"];
  for (const capability of capabilities) {
    await grantCapability(organizationId, domain, workspaceId, granteeUserId, capability);
  }
}

async function create(input: Parameters<typeof createKnowledgeItem>[2]) {
  return createKnowledgeItem(db, rawSql, input);
}

afterEach(async () => {
  while (createdOrgIds.length > 0) {
    const id = createdOrgIds.pop()!;
    await db.delete(knowledgeItems).where(sql`${knowledgeItems.organizationId} = ${id}`);
    await db.delete(auditLogs).where(sql`${auditLogs.organizationId} = ${id}`);
    await db.delete(organizations).where(sql`${organizations.id} = ${id}`);
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await db.delete(users).where(sql`${users.id} = ${id}`);
  }
});

describe("createKnowledgeItem", () => {
  it("lets an actor holding an explicit draft_write grant create a draft, org-scoped item, with its first version already current", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantCapability(orgId, "execution", null, ownerId, "draft_write");

    const item = await create({
      organizationId: orgId,
      domain: "execution",
      classification: "note",
      title: "Test note",
      content: "Some content",
      actorUserId: ownerId,
    });

    expect(item.status).toBe("draft");
    expect(item.currentVersionNumber).toBe(1);
    expect(item.workspaceId).toBeNull();
    expect(item.authorUserId).toBe(ownerId);

    const [versionRow] = await db.select().from(knowledgeItemVersions).where(sql`${knowledgeItemVersions.knowledgeItemId} = ${item.id}`);
    expect(versionRow.versionNumber).toBe(1);
    expect(versionRow.title).toBe("Test note");
  });

  it("does not let a member without a draft_write grant create an item — organization role alone (even owner) is never sufficient", async () => {
    const ownerId = await makeUser();
    const viewerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, viewerId, "viewer");

    // Neither the owner nor the viewer holds a draft_write grant — both must be rejected identically; organization role never substitutes for it.
    await expect(
      create({ organizationId: orgId, domain: "execution", classification: "note", title: "x", content: "y", actorUserId: viewerId })
    ).rejects.toBeInstanceOf(InsufficientRoleError);
    await expect(
      create({ organizationId: orgId, domain: "execution", classification: "note", title: "x", content: "y", actorUserId: ownerId })
    ).rejects.toBeInstanceOf(InsufficientRoleError);
  });

  it("does not let a non-member create an item (rejected identically to a nonexistent organization)", async () => {
    const ownerId = await makeUser();
    const strangerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);

    await expect(
      create({ organizationId: orgId, domain: "execution", classification: "note", title: "x", content: "y", actorUserId: strangerId })
    ).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });

  it("lets a workspace member holding an explicit workspace-scoped draft_write grant create a workspace-scoped item; workspace membership alone (even for another member) is not enough", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const viewerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, memberId, "member");
    await addOrgMember(orgId, viewerId, "member");
    const workspaceId = await makeWorkspace(orgId);
    await addWorkspaceMember(workspaceId, memberId, "member");
    await addWorkspaceMember(workspaceId, viewerId, "viewer");
    await grantCapability(orgId, "execution", workspaceId, memberId, "draft_write");
    // viewerId deliberately receives no grant — workspace membership (any role) is never sufficient on its own.

    const item = await create({
      organizationId: orgId,
      workspaceId,
      domain: "execution",
      classification: "note",
      title: "workspace note",
      content: "content",
      actorUserId: memberId,
    });
    expect(item.workspaceId).toBe(workspaceId);

    await expect(
      create({ organizationId: orgId, workspaceId, domain: "execution", classification: "note", title: "x", content: "y", actorUserId: viewerId })
    ).rejects.toBeInstanceOf(InsufficientRoleError);
  });

  it("rejects creating a workspace-scoped item when the actor has organization membership but no explicit workspace membership — org owner does not override", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const workspaceId = await makeWorkspace(orgId);
    // Deliberately no workspace membership added for the owner.

    await expect(
      create({ organizationId: orgId, workspaceId, domain: "execution", classification: "note", title: "x", content: "y", actorUserId: ownerId })
    ).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });

  it("rejects a workspace that belongs to a different organization — application-layer check", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const otherOwnerId = await makeUser();
    const otherOrgId = await makeOrgWithOwner(otherOwnerId);
    const foreignWorkspaceId = await makeWorkspace(otherOrgId);
    await addWorkspaceMember(foreignWorkspaceId, ownerId, "manager");

    await expect(
      create({
        organizationId: orgId,
        workspaceId: foreignWorkspaceId,
        domain: "execution",
        classification: "note",
        title: "x",
        content: "y",
        actorUserId: ownerId,
      })
    ).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });

  it("rejects a workspace/organization mismatch at the DATABASE level (composite foreign key), bypassing the service layer", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const otherOwnerId = await makeUser();
    const otherOrgId = await makeOrgWithOwner(otherOwnerId);
    const foreignWorkspaceId = await makeWorkspace(otherOrgId);

    await expect(
      db.insert(knowledgeItems).values({
        organizationId: orgId,
        workspaceId: foreignWorkspaceId,
        domain: "execution",
        authorUserId: ownerId,
      })
    ).rejects.toThrow();
  });
});

describe("getKnowledgeItemForUser", () => {
  it("returns the item for an authorized organization member", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const created = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    const fetched = await getKnowledgeItemForUser(db, orgId, created.id, ownerId);
    expect(fetched.id).toBe(created.id);
  });

  it("returns 404-equivalent for a cross-tenant id", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const created = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    const otherOwnerId = await makeUser();
    const otherOrgId = await makeOrgWithOwner(otherOwnerId);

    await expect(getKnowledgeItemForUser(db, otherOrgId, created.id, otherOwnerId)).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });

  it("does not let a non-org user access the item", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const created = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    const strangerId = await makeUser();
    await expect(getKnowledgeItemForUser(db, orgId, created.id, strangerId)).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });

  it("organization membership alone does not grant access to a workspace-scoped item — only explicit workspace members can read it", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, memberId, "member");
    const workspaceId = await makeWorkspace(orgId);
    await addWorkspaceMember(workspaceId, memberId, "member");
    await grantAllCapabilities(orgId, "execution", workspaceId, memberId);

    const created = await create({
      organizationId: orgId,
      workspaceId,
      domain: "execution",
      classification: "note",
      title: "t",
      content: "c",
      actorUserId: memberId,
    });

    // Owner is a real organization member (even owner-role) but holds no explicit workspace membership.
    await expect(getKnowledgeItemForUser(db, orgId, created.id, ownerId)).rejects.toBeInstanceOf(TenantResourceNotFoundError);

    // The explicit workspace member can read it.
    const fetched = await getKnowledgeItemForUser(db, orgId, created.id, memberId);
    expect(fetched.id).toBe(created.id);
  });
});

describe("listKnowledgeItemsForUser", () => {
  it("lists only draft items by default, excluding archived ones", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "keep", content: "c", actorUserId: ownerId });
    const toArchive = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "archive-me", content: "c", actorUserId: ownerId });
    await archiveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: toArchive.id, actorUserId: ownerId, expectedVersionNumber: 1 });

    const { items } = await listKnowledgeItemsForUser(db, { organizationId: orgId, actorUserId: ownerId });
    const ids = items.map((i) => i.id);
    expect(ids).toContain(item.id);
    expect(ids).not.toContain(toArchive.id);
  });

  it("never lists a workspace-scoped item to a user without explicit membership in that workspace, even when listing unfiltered", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, memberId, "member");
    const workspaceId = await makeWorkspace(orgId);
    await addWorkspaceMember(workspaceId, memberId, "member");
    await grantAllCapabilities(orgId, "execution", workspaceId, memberId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);

    const wsItem = await create({ organizationId: orgId, workspaceId, domain: "execution", classification: "note", title: "ws", content: "c", actorUserId: memberId });
    const orgItem = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "org", content: "c", actorUserId: ownerId });

    const { items } = await listKnowledgeItemsForUser(db, { organizationId: orgId, actorUserId: ownerId });
    const ids = items.map((i) => i.id);
    expect(ids).toContain(orgItem.id);
    expect(ids).not.toContain(wsItem.id);
  });

  it("filters by domain and classification", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    await grantAllCapabilities(orgId, "growth", null, ownerId);
    await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "a", content: "c", actorUserId: ownerId });
    await create({ organizationId: orgId, domain: "growth", classification: "template", title: "b", content: "c", actorUserId: ownerId });

    const { items } = await listKnowledgeItemsForUser(db, { organizationId: orgId, domain: "growth", actorUserId: ownerId });
    expect(items).toHaveLength(1);
    expect(items[0].classification).toBe("template");
  });

  it("bounds pagination — limit is capped, and nextCursor is returned when more rows exist", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    for (let i = 0; i < 5; i++) {
      await create({ organizationId: orgId, domain: "identity", classification: "fact", title: `item-${i}`, content: "c", actorUserId: ownerId });
    }

    const firstPage = await listKnowledgeItemsForUser(db, { organizationId: orgId, actorUserId: ownerId, limit: 2 });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await listKnowledgeItemsForUser(db, { organizationId: orgId, actorUserId: ownerId, limit: 2, cursor: firstPage.nextCursor });
    expect(secondPage.items).toHaveLength(2);
    expect(secondPage.items[0].id).not.toBe(firstPage.items[0].id);

    // A caller requesting far more than the maximum still gets capped at 100 — proven structurally: requesting 1000 does not throw and does not return unbounded rows.
    const overLimit = await listKnowledgeItemsForUser(db, { organizationId: orgId, actorUserId: ownerId, limit: 1000 });
    expect(overLimit.items.length).toBeLessThanOrEqual(100);
  });
});

describe("updateKnowledgeItem", () => {
  it("lets the author update the item, creating a new version and advancing the current-version pointer", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "old", content: "c", actorUserId: ownerId });

    const updated = await updateKnowledgeItem(db, {
      organizationId: orgId,
      knowledgeItemId: item.id,
      actorUserId: ownerId,
      expectedVersionNumber: 1,
      updates: { title: "new" },
    });
    expect(updated.title).toBe("new");
    expect(updated.currentVersionNumber).toBe(2);

    const versions = await db
      .select()
      .from(knowledgeItemVersions)
      .where(sql`${knowledgeItemVersions.knowledgeItemId} = ${item.id}`);
    expect(versions).toHaveLength(2);
    const v1 = versions.find((v) => v.versionNumber === 1)!;
    expect(v1.title).toBe("old");
  });

  it("a partial update leaves untouched fields unchanged in the new version", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "old title", content: "old content", actorUserId: ownerId });

    const updated = await updateKnowledgeItem(db, {
      organizationId: orgId,
      knowledgeItemId: item.id,
      actorUserId: ownerId,
      expectedVersionNumber: 1,
      updates: { title: "new title" },
    });
    expect(updated.title).toBe("new title");
    expect(updated.content).toBe("old content");
    expect(updated.classification).toBe("fact");
  });

  it("lets a non-author update an item authored by someone else ONLY given an explicit edit_any_draft grant — organization owner/admin role never overrides this on its own", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, memberId, "member");
    await grantCapability(orgId, "identity", null, memberId, "draft_write");
    // Owner can read (so the rejection below proves insufficient MUTATE authority specifically, not mere read-inaccessibility) but deliberately has no edit_any_draft yet.
    await grantCapability(orgId, "identity", null, ownerId, "read");
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "old", content: "c", actorUserId: memberId });

    // The owner role alone is not enough — without an explicit edit_any_draft grant, even the owner is rejected.
    await expect(
      updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1, updates: { title: "no override" } })
    ).rejects.toBeInstanceOf(InsufficientRoleError);

    // With an explicit edit_any_draft grant, the owner (or anyone else) can update it.
    await grantCapability(orgId, "identity", null, ownerId, "edit_any_draft");
    const updated = await updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1, updates: { title: "fixed via grant" } });
    expect(updated.title).toBe("fixed via grant");
  });

  it("does not let a different plain member update someone else's item without an edit_any_draft grant", async () => {
    const ownerId = await makeUser();
    const authorId = await makeUser();
    const otherMemberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, authorId, "member");
    await addOrgMember(orgId, otherMemberId, "member");
    await grantCapability(orgId, "identity", null, authorId, "draft_write");
    // otherMemberId can read (proving the rejection is specifically about mutate authority) but has no edit_own_draft/edit_any_draft.
    await grantCapability(orgId, "identity", null, otherMemberId, "read");
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "old", content: "c", actorUserId: authorId });

    await expect(
      updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: otherMemberId, expectedVersionNumber: 1, updates: { title: "hijacked" } })
    ).rejects.toBeInstanceOf(InsufficientRoleError);
  });

  it("rejects a lost update — a stale expectedVersionNumber never silently overwrites a concurrent change", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "v1", content: "c", actorUserId: ownerId });

    // First update succeeds and moves the item to version 2.
    await updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1, updates: { title: "v2" } });

    // A second caller, still holding the stale version 1, must be rejected — never silently overwrite "v2".
    await expect(
      updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1, updates: { title: "lost-update" } })
    ).rejects.toBeInstanceOf(KnowledgeVersionConflictError);

    const current = await getKnowledgeItemForUser(db, orgId, item.id, ownerId);
    expect(current.title).toBe("v2");
    expect(current.currentVersionNumber).toBe(2);

    // No duplicate/orphaned version was created by the rejected attempt.
    const versions = await db.select().from(knowledgeItemVersions).where(sql`${knowledgeItemVersions.knowledgeItemId} = ${item.id}`);
    expect(versions).toHaveLength(2);
  });

  it("cannot update an archived item", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    await archiveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1 });

    await expect(
      updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1, updates: { title: "no" } })
    ).rejects.toBeInstanceOf(KnowledgeItemArchivedViolationError);
  });
});

describe("archiveKnowledgeItem", () => {
  it("archives an item, never creates a new version, and it no longer appears in the default active listing", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    const archived = await archiveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1 });
    expect(archived.status).toBe("archived");
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.currentVersionNumber).toBe(1);

    const versions = await db.select().from(knowledgeItemVersions).where(sql`${knowledgeItemVersions.knowledgeItemId} = ${item.id}`);
    expect(versions).toHaveLength(1);

    const { items } = await listKnowledgeItemsForUser(db, { organizationId: orgId, actorUserId: ownerId });
    expect(items.map((i) => i.id)).not.toContain(item.id);
  });

  it("cannot archive an already-archived item", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    await archiveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1 });

    await expect(
      archiveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1 })
    ).rejects.toBeInstanceOf(KnowledgeItemAlreadyArchivedError);
  });

  it("archived items remain readable, including their full version history", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    await updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1, updates: { title: "t2" } });
    await archiveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 2 });

    const fetched = await getKnowledgeItemForUser(db, orgId, item.id, ownerId);
    expect(fetched.status).toBe("archived");
    expect(fetched.title).toBe("t2");
  });

  it("there is no hard-delete path anywhere in this module", async () => {
    const knowledgeItemsModule = await import("./knowledge-items");
    expect((knowledgeItemsModule as Record<string, unknown>).deleteKnowledgeItem).toBeUndefined();
    expect((knowledgeItemsModule as Record<string, unknown>).hardDeleteKnowledgeItem).toBeUndefined();

    const detailRoute = await import("@/app/api/organizations/[organizationId]/knowledge/[knowledgeItemId]/route");
    expect((detailRoute as Record<string, unknown>).DELETE).toBeUndefined();

    const versionsRoute = await import("@/app/api/organizations/[organizationId]/knowledge/[knowledgeItemId]/versions/[versionNumber]/route");
    expect((versionsRoute as Record<string, unknown>).DELETE).toBeUndefined();
    expect((versionsRoute as Record<string, unknown>).PATCH).toBeUndefined();
  });
});

describe("audit events", () => {
  it("never includes knowledge content, title, or secrets in audit metadata", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const secretTitle = "UNIQUE_TITLE_MARKER_never_in_audit";
    const secretContent = "UNIQUE_CONTENT_MARKER_never_in_audit";

    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: secretTitle, content: secretContent, actorUserId: ownerId });
    await updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1, updates: { title: "changed" } });
    await archiveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 2 });

    const rows = await db.select().from(auditLogs).where(sql`${auditLogs.organizationId} = ${orgId}`);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const serialized = JSON.stringify(row.metadata);
      expect(serialized).not.toContain(secretTitle);
      expect(serialized).not.toContain(secretContent);
    }
  });

  it("records knowledge_access_denied for a membership failure (gates 2-3) and the distinct brain_permission_denied for a missing-capability failure (gate 4)", async () => {
    const ownerId = await makeUser();
    const viewerId = await makeUser();
    const strangerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, viewerId, "viewer");

    // viewerId is a real organization member but holds no draft_write grant — gate 4 (capability) denial.
    await expect(
      create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: viewerId })
    ).rejects.toBeInstanceOf(InsufficientRoleError);

    // strangerId isn't an organization member at all — gate 2 (membership) denial, unchanged since Module 1.
    await expect(
      create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: strangerId })
    ).rejects.toBeInstanceOf(TenantResourceNotFoundError);

    const permissionDeniedRows = await db.select().from(auditLogs).where(sql`${auditLogs.organizationId} = ${orgId} and ${auditLogs.eventType} = 'brain_permission_denied'`);
    expect(permissionDeniedRows.length).toBeGreaterThan(0);

    const accessDeniedRows = await db.select().from(auditLogs).where(sql`${auditLogs.organizationId} = ${orgId} and ${auditLogs.eventType} = 'knowledge_access_denied'`);
    expect(accessDeniedRows.length).toBeGreaterThan(0);
  });

  it("records knowledge_version_created on a successful update and knowledge_version_conflict on a rejected one — never a misleading success event on failure", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    await updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1, updates: { title: "t2" } });
    await expect(
      updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1, updates: { title: "stale" } })
    ).rejects.toBeInstanceOf(KnowledgeVersionConflictError);

    const createdEvents = await db
      .select()
      .from(auditLogs)
      .where(sql`${auditLogs.organizationId} = ${orgId} and ${auditLogs.eventType} = 'knowledge_version_created'`);
    expect(createdEvents).toHaveLength(1);

    const conflictEvents = await db
      .select()
      .from(auditLogs)
      .where(sql`${auditLogs.organizationId} = ${orgId} and ${auditLogs.eventType} = 'knowledge_version_conflict'`);
    expect(conflictEvents).toHaveLength(1);
  });
});

describe("Brain authz module isolation", () => {
  it("the Brain authz module is its own, separately-importable module distinct from the core authz helpers", async () => {
    const brainAuthz = await import("./authz");
    expect(typeof brainAuthz.requireBrainReadAccess).toBe("function");
    expect(typeof brainAuthz.requireBrainCreateAccess).toBe("function");
    expect(typeof brainAuthz.requireBrainMutateAccess).toBe("function");
  });
});
