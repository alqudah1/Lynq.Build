import { describe, it, expect, afterEach } from "vitest";
import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, knowledgeItems, auditLogs, brainPermissionGrants } from "@/db/schema";
import { InsufficientRoleError } from "@/lib/authz/errors";
import { InvalidLifecycleTransitionError, KnowledgeItemNotEditableError } from "./errors";
import type { BrainCapability } from "./authz";
import type { KnowledgeDomain } from "./knowledge-items";
import { createKnowledgeItem, updateKnowledgeItem, archiveKnowledgeItem, getKnowledgeItemForUser } from "./knowledge-items";
import {
  submitKnowledgeItemForReview,
  sendKnowledgeItemBackToDraft,
  approveKnowledgeItem,
  publishKnowledgeItem,
  restoreKnowledgeItem,
  retireKnowledgeItem,
} from "./lifecycle";

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `brain-lifecycle-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Lifecycle Test Org", slug: `brain-lifecycle-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: ownerId, role: "owner" });
  createdOrgIds.push(org.id);
  return org.id;
}

async function grantCapability(organizationId: string, domain: KnowledgeDomain, workspaceId: string | null, granteeUserId: string, capability: BrainCapability): Promise<void> {
  await db.insert(brainPermissionGrants).values({ organizationId, domain, workspaceId, granteeUserId, capability });
}

async function grantAllCapabilities(organizationId: string, domain: KnowledgeDomain, granteeUserId: string): Promise<void> {
  for (const capability of ["read", "draft_write", "edit_own_draft", "edit_any_draft", "approve", "archive"] as const) {
    await grantCapability(organizationId, domain, null, granteeUserId, capability);
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

describe("full lifecycle happy path", () => {
  it("moves draft -> review -> approved -> published -> archived -> approved (restore) -> retired, recording every transition", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    expect(item.status).toBe("draft");

    const review = await submitKnowledgeItemForReview(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId });
    expect(review.status).toBe("review");

    const approved = await approveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId });
    expect(approved.status).toBe("approved");
    expect(approved.approvedByUserId).toBe(ownerId);
    expect(approved.approvedAt).not.toBeNull();

    const published = await publishKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId });
    expect(published.status).toBe("published");
    expect(published.publishedByUserId).toBe(ownerId);

    const archived = await archiveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1 });
    expect(archived.status).toBe("archived");

    const restored = await restoreKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId });
    expect(restored.status).toBe("approved");
    expect(restored.archivedAt).toBeNull();

    const retired = await retireKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, reason: "superseded by a newer policy", actorUserId: ownerId });
    expect(retired.status).toBe("retired");
    expect(retired.retiredReason).toBe("superseded by a newer policy");
    expect(retired.retiredByUserId).toBe(ownerId);

    const events = await db.select({ eventType: auditLogs.eventType }).from(auditLogs).where(sql`${auditLogs.organizationId} = ${orgId}`);
    const types = events.map((e) => e.eventType);
    for (const expected of [
      "knowledge_item_submitted_for_review",
      "knowledge_item_approved",
      "knowledge_item_published",
      "knowledge_item_archived",
      "knowledge_item_restored",
      "knowledge_item_retired",
    ]) {
      expect(types).toContain(expected);
    }
  });

  it("supports the Review -> Draft 'sent back' loop before eventually being approved", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    await submitKnowledgeItemForReview(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId });
    const backToDraft = await sendKnowledgeItemBackToDraft(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId });
    expect(backToDraft.status).toBe("draft");

    // Content can be edited again now that it's back in draft.
    const updated = await updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1, updates: { title: "revised" } });
    expect(updated.title).toBe("revised");

    await submitKnowledgeItemForReview(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId });
    const approved = await approveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId });
    expect(approved.status).toBe("approved");
  });
});

describe("illegal transitions are always rejected — no skip ever reaches Approved", () => {
  it("draft -> approved directly is never legal, even for the organization owner", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    await expect(approveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId })).rejects.toBeInstanceOf(InvalidLifecycleTransitionError);
  });

  it("draft -> published directly is never legal", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    await expect(publishKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId })).rejects.toBeInstanceOf(InvalidLifecycleTransitionError);
  });

  it("cannot submit-for-review an item that is already in review", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    await submitKnowledgeItemForReview(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId });

    await expect(submitKnowledgeItemForReview(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId })).rejects.toBeInstanceOf(InvalidLifecycleTransitionError);
  });

  it("cannot restore an item that isn't archived", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    await expect(restoreKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId })).rejects.toBeInstanceOf(InvalidLifecycleTransitionError);
  });

  it("cannot retire an already-retired or purged item", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    await retireKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, reason: "no longer needed", actorUserId: ownerId });

    await expect(
      retireKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, reason: "again", actorUserId: ownerId })
    ).rejects.toBeInstanceOf(InvalidLifecycleTransitionError);
  });

  it("archiving a retired item is rejected — retired is a closer-to-terminal state than archived", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    await retireKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, reason: "no longer needed", actorUserId: ownerId });

    await expect(
      archiveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1 })
    ).rejects.toBeInstanceOf(InvalidLifecycleTransitionError);
  });
});

describe("capability requirements per transition", () => {
  it("a plain member without the approve capability cannot approve, even with ordinary edit authority", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await db.insert(organizationMemberships).values({ organizationId: orgId, userId: memberId, role: "member" });
    await grantCapability(orgId, "identity", null, memberId, "draft_write");
    await grantCapability(orgId, "identity", null, memberId, "edit_own_draft");
    await grantCapability(orgId, "identity", null, memberId, "read");
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: memberId });
    await submitKnowledgeItemForReview(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: memberId });

    await expect(approveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: memberId })).rejects.toBeInstanceOf(InsufficientRoleError);
  });

  it("an actor without the archive capability cannot retire an item, even as its author", async () => {
    const ownerId = await makeUser();
    const authorId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await db.insert(organizationMemberships).values({ organizationId: orgId, userId: authorId, role: "member" });
    await grantCapability(orgId, "identity", null, authorId, "draft_write");
    await grantCapability(orgId, "identity", null, authorId, "read");
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: authorId });

    await expect(
      retireKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, reason: "attempt", actorUserId: authorId })
    ).rejects.toBeInstanceOf(InsufficientRoleError);
  });
});

describe("content edits are blocked once an item leaves draft", () => {
  it("cannot update an item that is in review, approved, or published", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    await submitKnowledgeItemForReview(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId });

    await expect(
      updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1, updates: { title: "sneaky edit" } })
    ).rejects.toBeInstanceOf(KnowledgeItemNotEditableError);

    await approveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId });
    await expect(
      updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1, updates: { title: "sneaky edit 2" } })
    ).rejects.toBeInstanceOf(KnowledgeItemNotEditableError);
  });
});

describe("archiving now reachable from Approved and Published, per §4's diagram", () => {
  it("an approved item can be archived directly", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    await submitKnowledgeItemForReview(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId });
    await approveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId });

    const archived = await archiveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1 });
    expect(archived.status).toBe("archived");
  });

  it("a published item can be archived directly", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    await submitKnowledgeItemForReview(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId });
    await approveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId });
    await publishKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId });

    const archived = await archiveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1 });
    expect(archived.status).toBe("archived");
  });

  it("a plain draft item can still be archived directly — Module 1's original shipped behavior, preserved", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    const archived = await archiveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1 });
    expect(archived.status).toBe("archived");
  });
});

describe("concurrency", () => {
  it("of two concurrent approve attempts on the same item, exactly one succeeds and one is rejected as an invalid/conflicting transition", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    await submitKnowledgeItemForReview(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId });

    const results = await Promise.allSettled([
      approveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId }),
      approveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(InvalidLifecycleTransitionError);

    const final = await getKnowledgeItemForUser(db, orgId, item.id, ownerId);
    expect(final.status).toBe("approved");
  });
});

describe("cross-tenant isolation", () => {
  it("a cross-tenant lifecycle transition attempt is rejected identically to a nonexistent item", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    const otherOwnerId = await makeUser();
    const otherOrgId = await makeOrgWithOwner(otherOwnerId);

    await expect(
      submitKnowledgeItemForReview(db, { organizationId: otherOrgId, knowledgeItemId: item.id, actorUserId: otherOwnerId })
    ).rejects.toThrow();
  });
});
