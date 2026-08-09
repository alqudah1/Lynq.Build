import { describe, it, expect, afterEach } from "vitest";
import { neon } from "@neondatabase/serverless";
import { sql, eq } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, workspaces, workspaceMemberships, knowledgeItems, knowledgeItemVersions, auditLogs, brainPermissionGrants } from "@/db/schema";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { KnowledgeVersionConflictError, KnowledgeItemArchivedViolationError } from "./errors";
import type { BrainCapability } from "./authz";
import type { KnowledgeDomain } from "./knowledge-items";
import { createKnowledgeItem, getKnowledgeItemForUser, updateKnowledgeItem } from "./knowledge-items";
import {
  listKnowledgeItemVersionsForUser,
  getKnowledgeItemVersionForUser,
  getCurrentKnowledgeItemVersionForUser,
  restoreKnowledgeItemVersion,
} from "./knowledge-item-versions";

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `brain-version-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Version Test Org", slug: `brain-version-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
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

describe("version 1 existence and current-version resolution", () => {
  it("creating an item creates exactly one version, numbered 1, and it is current", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    const { versions } = await listKnowledgeItemVersionsForUser(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId });
    expect(versions).toHaveLength(1);
    expect(versions[0].versionNumber).toBe(1);
    expect(versions[0].isCurrent).toBe(true);

    const current = await getCurrentKnowledgeItemVersionForUser(db, orgId, item.id, ownerId);
    expect(current.versionNumber).toBe(1);
  });
});

describe("sequential version creation and non-orphaned pointer", () => {
  it("each successful update creates the next sequential version number, and the pointer always resolves to a real, current-item-owned version", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "v1", content: "c", actorUserId: ownerId });

    await updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1, updates: { title: "v2" } });
    await updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 2, updates: { title: "v3" } });

    const { versions } = await listKnowledgeItemVersionsForUser(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId });
    expect(versions.map((v) => v.versionNumber)).toEqual([3, 2, 1]);
    expect(versions[0].isCurrent).toBe(true);

    const [itemRow] = await db.select().from(knowledgeItems).where(eq(knowledgeItems.id, item.id));
    const [pointedVersion] = await db.select().from(knowledgeItemVersions).where(eq(knowledgeItemVersions.id, itemRow.currentVersionId!));
    expect(pointedVersion.knowledgeItemId).toBe(item.id);
    expect(pointedVersion.versionNumber).toBe(3);
  });

  it("bounds version-history pagination — cursor-based, never offset-based", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "v1", content: "c", actorUserId: ownerId });
    for (let i = 2; i <= 6; i++) {
      await updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: i - 1, updates: { title: `v${i}` } });
    }

    const firstPage = await listKnowledgeItemVersionsForUser(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, limit: 2 });
    expect(firstPage.versions).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await listKnowledgeItemVersionsForUser(db, {
      organizationId: orgId,
      knowledgeItemId: item.id,
      actorUserId: ownerId,
      limit: 2,
      cursor: firstPage.nextCursor,
    });
    expect(secondPage.versions).toHaveLength(2);
    expect(secondPage.versions[0].versionNumber).toBeLessThan(firstPage.versions[1].versionNumber);
  });
});

describe("historical immutability", () => {
  it("there is no update or delete code path for version rows anywhere in this module", async () => {
    const versionsModule = await import("./knowledge-item-versions");
    expect((versionsModule as Record<string, unknown>).updateKnowledgeItemVersion).toBeUndefined();
    expect((versionsModule as Record<string, unknown>).deleteKnowledgeItemVersion).toBeUndefined();

    const listRoute = await import("@/app/api/organizations/[organizationId]/knowledge/[knowledgeItemId]/versions/route");
    expect((listRoute as Record<string, unknown>).PATCH).toBeUndefined();
    expect((listRoute as Record<string, unknown>).DELETE).toBeUndefined();
    expect((listRoute as Record<string, unknown>).POST).toBeUndefined();

    const oneRoute = await import("@/app/api/organizations/[organizationId]/knowledge/[knowledgeItemId]/versions/[versionNumber]/route");
    expect((oneRoute as Record<string, unknown>).PATCH).toBeUndefined();
    expect((oneRoute as Record<string, unknown>).DELETE).toBeUndefined();
  });

  it("a historical (non-current) version's content is never altered by a later update", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "v1", content: "c1", actorUserId: ownerId });
    await updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1, updates: { title: "v2", content: "c2" } });

    const v1 = await getKnowledgeItemVersionForUser(db, orgId, item.id, 1, ownerId);
    expect(v1.title).toBe("v1");
    expect(v1.content).toBe("c1");
  });
});

describe("per-item uniqueness and cross-item isolation", () => {
  it("two different items can each independently have their own version 1 (uniqueness is per-item, not global)", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const itemA = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "a", content: "c", actorUserId: ownerId });
    const itemB = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "b", content: "c", actorUserId: ownerId });

    const versionA = await getKnowledgeItemVersionForUser(db, orgId, itemA.id, 1, ownerId);
    const versionB = await getKnowledgeItemVersionForUser(db, orgId, itemB.id, 1, ownerId);
    expect(versionA.title).toBe("a");
    expect(versionB.title).toBe("b");
  });

  it("a version number that belongs to a different item is a 404 on this item, never silently returned", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const itemA = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "a", content: "c", actorUserId: ownerId });
    await updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: itemA.id, actorUserId: ownerId, expectedVersionNumber: 1, updates: { title: "a2" } });
    const itemB = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "b", content: "c", actorUserId: ownerId });
    // itemB has only version 1 — version 2 exists only for itemA.
    await expect(getKnowledgeItemVersionForUser(db, orgId, itemB.id, 2, ownerId)).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });
});

describe("cross-tenant and workspace authorization for version history", () => {
  it("a cross-tenant organization id gets an identical 404 for version history", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    const otherOwnerId = await makeUser();
    const otherOrgId = await makeOrgWithOwner(otherOwnerId);

    await expect(listKnowledgeItemVersionsForUser(db, { organizationId: otherOrgId, knowledgeItemId: item.id, actorUserId: otherOwnerId })).rejects.toBeInstanceOf(
      TenantResourceNotFoundError
    );
  });

  it("requires explicit workspace membership to read a workspace-scoped item's version history", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    await addOrgMember(orgId, memberId, "member");
    const workspaceId = await makeWorkspace(orgId);
    await addWorkspaceMember(workspaceId, memberId, "member");
    await grantAllCapabilities(orgId, "execution", workspaceId, memberId);
    const item = await create({ organizationId: orgId, workspaceId, domain: "execution", classification: "note", title: "t", content: "c", actorUserId: memberId });

    await expect(listKnowledgeItemVersionsForUser(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId })).rejects.toBeInstanceOf(
      TenantResourceNotFoundError
    );

    const { versions } = await listKnowledgeItemVersionsForUser(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: memberId });
    expect(versions).toHaveLength(1);
  });

  it("an organization owner/admin without workspace membership cannot restore a workspace-scoped item's version, even though they are a real org member", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    await addOrgMember(orgId, memberId, "member");
    const workspaceId = await makeWorkspace(orgId);
    await addWorkspaceMember(workspaceId, memberId, "member");
    await grantAllCapabilities(orgId, "execution", workspaceId, memberId);
    const item = await create({ organizationId: orgId, workspaceId, domain: "execution", classification: "note", title: "t", content: "c", actorUserId: memberId });
    await updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: memberId, expectedVersionNumber: 1, updates: { title: "t2" } });

    await expect(
      restoreKnowledgeItemVersion(db, {
        organizationId: orgId,
        knowledgeItemId: item.id,
        sourceVersionNumber: 1,
        expectedVersionNumber: 2,
        changeReason: "attempted restore by non-member owner",
        actorUserId: ownerId,
      })
    ).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });
});

describe("archived-item version-history behavior", () => {
  it("an archived item's full version history remains readable", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t1", content: "c", actorUserId: ownerId });
    await updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1, updates: { title: "t2" } });

    const { archiveKnowledgeItem } = await import("./knowledge-items");
    await archiveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 2 });

    const { versions } = await listKnowledgeItemVersionsForUser(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId });
    expect(versions).toHaveLength(2);
  });

  it("restoring a version into an archived item is rejected — Module 1's approved lifecycle does not allow it", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t1", content: "c", actorUserId: ownerId });
    await updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1, updates: { title: "t2" } });

    const { archiveKnowledgeItem } = await import("./knowledge-items");
    await archiveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 2 });

    await expect(
      restoreKnowledgeItemVersion(db, {
        organizationId: orgId,
        knowledgeItemId: item.id,
        sourceVersionNumber: 1,
        expectedVersionNumber: 2,
        changeReason: "should not be permitted",
        actorUserId: ownerId,
      })
    ).rejects.toBeInstanceOf(KnowledgeItemArchivedViolationError);
  });
});

describe("restore/rollback semantics", () => {
  it("restoring an older version creates a brand-new version copying its content — it never rewinds the pointer", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "v1", content: "content-v1", actorUserId: ownerId });
    await updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1, updates: { title: "v2", content: "content-v2" } });
    await updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 2, updates: { title: "v3", content: "content-v3" } });

    const restored = await restoreKnowledgeItemVersion(db, {
      organizationId: orgId,
      knowledgeItemId: item.id,
      sourceVersionNumber: 1,
      expectedVersionNumber: 3,
      changeReason: "reverting a bad edit",
      actorUserId: ownerId,
    });

    expect(restored.currentVersionNumber).toBe(4);
    expect(restored.title).toBe("v1");
    expect(restored.content).toBe("content-v1");

    const { versions } = await listKnowledgeItemVersionsForUser(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId });
    expect(versions).toHaveLength(4);
    // The original v1/v2/v3 remain untouched, exactly as written.
    const v1 = versions.find((v) => v.versionNumber === 1)!;
    const v3 = versions.find((v) => v.versionNumber === 3)!;
    expect(v1.title).toBe("v1");
    expect(v3.title).toBe("v3");
    const v4 = versions.find((v) => v.versionNumber === 4)!;
    expect(v4.changeReason).toBe("reverting a bad edit");
  });

  it("a failed (stale) restore leaves the current version unchanged and creates no new version", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "v1", content: "c", actorUserId: ownerId });
    await updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1, updates: { title: "v2" } });

    await expect(
      restoreKnowledgeItemVersion(db, {
        organizationId: orgId,
        knowledgeItemId: item.id,
        sourceVersionNumber: 1,
        expectedVersionNumber: 1, // stale — current is actually 2
        changeReason: "stale restore attempt",
        actorUserId: ownerId,
      })
    ).rejects.toBeInstanceOf(KnowledgeVersionConflictError);

    const current = await getKnowledgeItemForUser(db, orgId, item.id, ownerId);
    expect(current.currentVersionNumber).toBe(2);
    expect(current.title).toBe("v2");

    const { versions } = await listKnowledgeItemVersionsForUser(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId });
    expect(versions).toHaveLength(2);
  });
});

describe("concurrency", () => {
  it("of two concurrent updates racing on the same expected version, exactly one succeeds and one is rejected — no duplicate version numbers, no lost update", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "v1", content: "c", actorUserId: ownerId });

    const results = await Promise.allSettled([
      updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1, updates: { title: "race-a" } }),
      updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1, updates: { title: "race-b" } }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(KnowledgeVersionConflictError);

    const versions = await db.select().from(knowledgeItemVersions).where(eq(knowledgeItemVersions.knowledgeItemId, item.id));
    expect(versions).toHaveLength(2);
    const versionNumbers = versions.map((v) => v.versionNumber).sort();
    expect(versionNumbers).toEqual([1, 2]);
  });
});

describe("audit metadata never contains version content", () => {
  it("knowledge_version_created and knowledge_version_restored events never include title or content", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const secretV1 = "SECRET_V1_MARKER";
    const secretV2 = "SECRET_V2_MARKER";
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: secretV1, content: "c", actorUserId: ownerId });
    await updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1, updates: { title: secretV2 } });
    await restoreKnowledgeItemVersion(db, {
      organizationId: orgId,
      knowledgeItemId: item.id,
      sourceVersionNumber: 1,
      expectedVersionNumber: 2,
      changeReason: "restoring for test",
      actorUserId: ownerId,
    });

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.organizationId, orgId));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const serialized = JSON.stringify(row.metadata);
      expect(serialized).not.toContain(secretV1);
      expect(serialized).not.toContain(secretV2);
    }

    const restoredEvents = rows.filter((r) => r.eventType === "knowledge_version_restored");
    expect(restoredEvents).toHaveLength(1);
  });
});
