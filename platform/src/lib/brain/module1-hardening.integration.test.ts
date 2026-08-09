import { describe, it, expect, afterEach } from "vitest";
import { neon } from "@neondatabase/serverless";
import { sql, eq } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, workspaces, workspaceMemberships, knowledgeItems, knowledgeItemVersions, auditLogs, brainPermissionGrants } from "@/db/schema";
import { TenantResourceNotFoundError, InsufficientRoleError } from "@/lib/authz/errors";
import { KnowledgeVersionConflictError } from "./errors";
import type { BrainCapability } from "./authz";
import type { KnowledgeDomain } from "./knowledge-items";
import { createKnowledgeItem, getKnowledgeItemForUser, updateKnowledgeItem, archiveKnowledgeItem, listKnowledgeItemsForUser } from "./knowledge-items";

/**
 * Hardening pass tests for Brain Module 1 (see the "Reconcile workspace-
 * content authorization" report). Kept in its own file, distinct from
 * `knowledge-items.integration.test.ts`, so this pass's specific fixes stay
 * separately reviewable: the workspace-content authorization matrix,
 * archived-item read/list/restore behavior, database-level classification
 * enforcement, and audit-metadata/misleading-event checks.
 *
 * Updated for Brain Module 2 (Version History): `expectedRevision` is now
 * `expectedVersionNumber`, resolved through `currentVersionId` rather than a
 * `revision` column; `classification` now lives on `knowledge_item_versions`,
 * not `knowledge_items`; `StaleRevisionError` is now `KnowledgeVersionConflictError`.
 *
 * Updated for Brain Module 7 (Permissions): every test that previously
 * relied on organization or workspace ROLE (owner/admin auto-archiving,
 * workspace manager auto-editing another author's item, workspace role
 * alone governing creation) has been rewritten — those role-based rules
 * are exactly what Module 7 replaced with explicit Brain-domain capability
 * grants. The underlying tenant-isolation findings this file exists to
 * guard (organization membership never overrides workspace isolation,
 * archive is a stronger authority than update, cross-tenant requests stay
 * indistinguishable from nonexistent) are unchanged; only the mechanism
 * that grants authority within a reachable scope changed, from role to
 * explicit grant.
 */

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `brain-hardening-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Hardening Org", slug: `brain-hardening-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: ownerId, role: "owner" });
  createdOrgIds.push(org.id);
  return org.id;
}

async function addOrgMember(orgId: string, userId: string, role: "admin" | "member" | "viewer"): Promise<void> {
  await db.insert(organizationMemberships).values({ organizationId: orgId, userId, role });
}

async function makeWorkspace(orgId: string): Promise<string> {
  const [ws] = await db.insert(workspaces).values({ organizationId: orgId, name: "WS", slug: `ws-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: workspaces.id });
  return ws.id;
}

async function addWorkspaceMember(workspaceId: string, userId: string, role: "manager" | "member" | "viewer"): Promise<void> {
  await db.insert(workspaceMemberships).values({ workspaceId, userId, role });
}

async function setWorkspaceRole(workspaceId: string, userId: string, role: "manager" | "member" | "viewer"): Promise<void> {
  await db.update(workspaceMemberships).set({ role }).where(sql`${workspaceMemberships.workspaceId} = ${workspaceId} and ${workspaceMemberships.userId} = ${userId}`);
}

async function grantCapability(
  organizationId: string,
  domain: KnowledgeDomain,
  workspaceId: string | null,
  granteeUserId: string,
  capability: BrainCapability
): Promise<void> {
  await db.insert(brainPermissionGrants).values({ organizationId, domain, workspaceId, granteeUserId, capability });
}

/** See knowledge-items.integration.test.ts's identical helper for the full reasoning. */
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

describe("workspace-content authorization — organization role never overrides", () => {
  it("an org owner without workspace membership cannot READ a workspace-scoped item", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, memberId, "member");
    const workspaceId = await makeWorkspace(orgId);
    await addWorkspaceMember(workspaceId, memberId, "member");
    await grantCapability(orgId, "execution", workspaceId, memberId, "draft_write");
    const item = await create({ organizationId: orgId, workspaceId, domain: "execution", classification: "note", title: "t", content: "c", actorUserId: memberId });

    await expect(getKnowledgeItemForUser(db, orgId, item.id, ownerId)).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });

  it("an org owner without workspace membership cannot UPDATE a workspace-scoped item", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, memberId, "member");
    const workspaceId = await makeWorkspace(orgId);
    await addWorkspaceMember(workspaceId, memberId, "member");
    await grantCapability(orgId, "execution", workspaceId, memberId, "draft_write");
    await grantCapability(orgId, "execution", workspaceId, memberId, "read");
    const item = await create({ organizationId: orgId, workspaceId, domain: "execution", classification: "note", title: "t", content: "c", actorUserId: memberId });

    await expect(
      updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1, updates: { title: "hijacked by owner" } })
    ).rejects.toBeInstanceOf(TenantResourceNotFoundError);

    const fetched = await getKnowledgeItemForUser(db, orgId, item.id, memberId);
    expect(fetched.title).toBe("t");
  });

  it("an org owner without workspace membership cannot ARCHIVE a workspace-scoped item", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, memberId, "member");
    const workspaceId = await makeWorkspace(orgId);
    await addWorkspaceMember(workspaceId, memberId, "member");
    await grantCapability(orgId, "execution", workspaceId, memberId, "draft_write");
    const item = await create({ organizationId: orgId, workspaceId, domain: "execution", classification: "note", title: "t", content: "c", actorUserId: memberId });

    await expect(
      archiveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1 })
    ).rejects.toBeInstanceOf(TenantResourceNotFoundError);

    const [row] = await db.select().from(knowledgeItems).where(eq(knowledgeItems.id, item.id));
    expect(row.status).toBe("draft");
  });

  it("an actor holding explicit edit_any_draft + archive grants can update AND archive an item authored by someone else in the same workspace — workspace role (manager or otherwise) is irrelevant", async () => {
    const ownerId = await makeUser();
    const managerId = await makeUser();
    const authorId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, managerId, "member");
    await addOrgMember(orgId, authorId, "member");
    const workspaceId = await makeWorkspace(orgId);
    await addWorkspaceMember(workspaceId, managerId, "manager");
    await addWorkspaceMember(workspaceId, authorId, "member");
    await grantCapability(orgId, "execution", workspaceId, managerId, "edit_any_draft");
    await grantCapability(orgId, "execution", workspaceId, managerId, "archive");
    await grantCapability(orgId, "execution", workspaceId, managerId, "read");
    await grantCapability(orgId, "execution", workspaceId, authorId, "draft_write");
    const item = await create({ organizationId: orgId, workspaceId, domain: "execution", classification: "note", title: "t", content: "c", actorUserId: authorId });

    const updated = await updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: managerId, expectedVersionNumber: 1, updates: { title: "fixed by manager" } });
    expect(updated.title).toBe("fixed by manager");

    const archived = await archiveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: managerId, expectedVersionNumber: 2 });
    expect(archived.status).toBe("archived");
  });

  it("the author of their own item cannot archive it without an explicit archive grant — authorship never substitutes for the archive capability", async () => {
    const ownerId = await makeUser();
    const authorId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, authorId, "member");
    const workspaceId = await makeWorkspace(orgId);
    await addWorkspaceMember(workspaceId, authorId, "member");
    await grantCapability(orgId, "execution", workspaceId, authorId, "draft_write");
    await grantCapability(orgId, "execution", workspaceId, authorId, "read");
    const item = await create({ organizationId: orgId, workspaceId, domain: "execution", classification: "note", title: "t", content: "c", actorUserId: authorId });

    await expect(
      archiveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: authorId, expectedVersionNumber: 1 })
    ).rejects.toBeInstanceOf(InsufficientRoleError);
  });

  it("changing an actor's workspace role has no effect on their Brain capability grants — an author demoted to workspace viewer keeps their edit_own_draft grant and can still update their own item", async () => {
    const ownerId = await makeUser();
    const authorId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, authorId, "member");
    const workspaceId = await makeWorkspace(orgId);
    await addWorkspaceMember(workspaceId, authorId, "member");
    await grantCapability(orgId, "execution", workspaceId, authorId, "draft_write");
    await grantCapability(orgId, "execution", workspaceId, authorId, "read");
    await grantCapability(orgId, "execution", workspaceId, authorId, "edit_own_draft");
    const item = await create({ organizationId: orgId, workspaceId, domain: "execution", classification: "note", title: "original", content: "c", actorUserId: authorId });

    // Demoting workspace role no longer revokes anything — capability grants are the only source of authority.
    await setWorkspaceRole(workspaceId, authorId, "viewer");

    const stillReadable = await getKnowledgeItemForUser(db, orgId, item.id, authorId);
    expect(stillReadable.title).toBe("original");

    const updated = await updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: authorId, expectedVersionNumber: 1, updates: { title: "still applies" } });
    expect(updated.title).toBe("still applies");
  });

  it("workspace-scoped creation is governed purely by the explicit draft_write grant — neither organization role nor workspace role matters in either direction", async () => {
    const ownerId = await makeUser();
    const orgViewerWorkspaceMemberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, orgViewerWorkspaceMemberId, "viewer");
    const workspaceId = await makeWorkspace(orgId);
    await addWorkspaceMember(workspaceId, orgViewerWorkspaceMemberId, "member");
    await grantCapability(orgId, "execution", workspaceId, orgViewerWorkspaceMemberId, "draft_write");

    // Weakest role on both axes (org viewer, workspace member) but holds the explicit grant — succeeds.
    const item = await create({
      organizationId: orgId,
      workspaceId,
      domain: "execution",
      classification: "note",
      title: "created by org-viewer-but-granted",
      content: "c",
      actorUserId: orgViewerWorkspaceMemberId,
    });
    expect(item.workspaceId).toBe(workspaceId);

    // Strongest role on both axes (org owner, workspace manager) but no explicit grant — rejected all the same.
    await addWorkspaceMember(workspaceId, ownerId, "manager");
    await expect(
      create({ organizationId: orgId, workspaceId, domain: "execution", classification: "note", title: "x", content: "y", actorUserId: ownerId })
    ).rejects.toBeInstanceOf(InsufficientRoleError);
  });

  it("cross-tenant requests still return the identical not-found error after hardening", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    const otherOwnerId = await makeUser();
    const otherOrgId = await makeOrgWithOwner(otherOwnerId);

    await expect(getKnowledgeItemForUser(db, otherOrgId, item.id, otherOwnerId)).rejects.toBeInstanceOf(TenantResourceNotFoundError);
    await expect(
      updateKnowledgeItem(db, { organizationId: otherOrgId, knowledgeItemId: item.id, actorUserId: otherOwnerId, expectedVersionNumber: 1, updates: { title: "x" } })
    ).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });
});

describe("organization-scoped authorization matrix (Module 7: grant-based, archive requires its own explicit capability)", () => {
  it("an organization member (author) holding edit_own_draft may update their own org-scoped draft, but may not archive it without an explicit archive grant", async () => {
    const ownerId = await makeUser();
    const authorId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, authorId, "member");
    await grantCapability(orgId, "identity", null, authorId, "draft_write");
    await grantCapability(orgId, "identity", null, authorId, "edit_own_draft");
    await grantCapability(orgId, "identity", null, authorId, "read");
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: authorId });

    const updated = await updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: authorId, expectedVersionNumber: 1, updates: { title: "updated by author" } });
    expect(updated.title).toBe("updated by author");

    await expect(
      archiveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: authorId, expectedVersionNumber: 2 })
    ).rejects.toBeInstanceOf(InsufficientRoleError);
  });

  it("an actor holding an explicit archive grant may archive an org-scoped item authored by someone else — organization owner/admin role alone is never sufficient", async () => {
    const ownerId = await makeUser();
    const authorId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, authorId, "member");
    await grantCapability(orgId, "identity", null, authorId, "draft_write");
    // Owner can read (so the rejection below proves insufficient ARCHIVE authority specifically) but deliberately has no archive grant yet.
    await grantCapability(orgId, "identity", null, ownerId, "read");
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: authorId });

    // The owner role alone is not enough — without an explicit archive grant, even the owner is rejected.
    await expect(
      archiveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1 })
    ).rejects.toBeInstanceOf(InsufficientRoleError);

    await grantCapability(orgId, "identity", null, ownerId, "archive");
    const archived = await archiveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1 });
    expect(archived.status).toBe("archived");
  });
});

describe("archived-item behavior", () => {
  it("an archived item remains readable via direct fetch when explicitly requested", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    await archiveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1 });

    const fetched = await getKnowledgeItemForUser(db, orgId, item.id, ownerId);
    expect(fetched.status).toBe("archived");
  });

  it("an archived item is retrievable via an explicit status=archived list filter, though excluded from the default listing", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    await archiveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1 });

    const defaultList = await listKnowledgeItemsForUser(db, { organizationId: orgId, actorUserId: ownerId });
    expect(defaultList.items.map((i) => i.id)).not.toContain(item.id);

    const archivedList = await listKnowledgeItemsForUser(db, { organizationId: orgId, actorUserId: ownerId, status: "archived" });
    expect(archivedList.items.map((i) => i.id)).toContain(item.id);
  });

  it("there is no restore/unarchive operation anywhere in this module", async () => {
    const knowledgeItemsModule = await import("./knowledge-items");
    expect((knowledgeItemsModule as Record<string, unknown>).restoreKnowledgeItem).toBeUndefined();
    expect((knowledgeItemsModule as Record<string, unknown>).unarchiveKnowledgeItem).toBeUndefined();
  });
});

describe("classification — database-level enforcement", () => {
  it("rejects an invalid classification even when application validation is bypassed with a direct insert into knowledge_item_versions", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantCapability(orgId, "identity", null, ownerId, "draft_write");
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    await expect(
      db.insert(knowledgeItemVersions).values({
        knowledgeItemId: item.id,
        versionNumber: 2,
        title: "t",
        content: "c",
        // Deliberately invalid — never in the approved 11-value list — inserted directly, bypassing every application-layer Zod check.
        classification: "not-a-real-classification",
        createdByUserId: ownerId,
      })
    ).rejects.toThrow();

    const versions = await db.select().from(knowledgeItemVersions).where(eq(knowledgeItemVersions.knowledgeItemId, item.id));
    expect(versions).toHaveLength(1);
  });

  it("accepts every one of the 11 approved classifications at the database level", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantCapability(orgId, "identity", null, ownerId, "draft_write");
    const approved = ["fact", "instruction", "policy", "procedure", "decision", "observation", "note", "summary", "template", "prompt", "reference"];

    for (const classification of approved) {
      const item = await create({ organizationId: orgId, domain: "identity", classification, title: "t", content: "c", actorUserId: ownerId });
      expect(item.classification).toBe(classification);
    }
  });
});

describe("audit behavior", () => {
  it("a denied workspace-content mutation records knowledge_access_denied with no title, content, workspace id, or session data", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, memberId, "member");
    const workspaceId = await makeWorkspace(orgId);
    await addWorkspaceMember(workspaceId, memberId, "member");
    await grantCapability(orgId, "execution", workspaceId, memberId, "draft_write");
    const secretTitle = "SECRET_TITLE_MARKER";
    const secretContent = "SECRET_CONTENT_MARKER";
    const item = await create({
      organizationId: orgId,
      workspaceId,
      domain: "execution",
      classification: "note",
      title: secretTitle,
      content: secretContent,
      actorUserId: memberId,
    });

    // Owner has no workspace membership at all — denied at the read gate before mutate is ever reached.
    await expect(
      updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1, updates: { title: "x" } })
    ).rejects.toBeInstanceOf(TenantResourceNotFoundError);

    const rows = await db.select().from(auditLogs).where(sql`${auditLogs.organizationId} = ${orgId} and ${auditLogs.eventType} = 'knowledge_access_denied'`);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const serialized = JSON.stringify(row);
      expect(serialized).not.toContain(secretTitle);
      expect(serialized).not.toContain(secretContent);
      expect(serialized).not.toContain(workspaceId);
      expect(serialized).not.toMatch(/session|token|__Host-/i);
    }
  });

  it("a stale version-conflict failure does not write a misleading knowledge_version_created event", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "v1", content: "c", actorUserId: ownerId });

    await updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1, updates: { title: "v2" } });

    await expect(
      updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1, updates: { title: "lost" } })
    ).rejects.toBeInstanceOf(KnowledgeVersionConflictError);

    const createdEvents = await db
      .select()
      .from(auditLogs)
      .where(sql`${auditLogs.organizationId} = ${orgId} and ${auditLogs.eventType} = 'knowledge_version_created'`);
    // Exactly one legitimate success event — the stale-version rejection produced no second, misleading one.
    expect(createdEvents).toHaveLength(1);

    const conflictEvents = await db
      .select()
      .from(auditLogs)
      .where(sql`${auditLogs.organizationId} = ${orgId} and ${auditLogs.eventType} = 'knowledge_version_conflict'`);
    expect(conflictEvents).toHaveLength(1);
  });
});
