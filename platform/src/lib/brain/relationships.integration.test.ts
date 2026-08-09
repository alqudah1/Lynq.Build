import { describe, it, expect, afterEach } from "vitest";
import { neon } from "@neondatabase/serverless";
import { sql, eq } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import {
  users,
  organizations,
  organizationMemberships,
  workspaces,
  workspaceMemberships,
  knowledgeItems,
  knowledgeRelationships,
  auditLogs,
  brainPermissionGrants,
} from "@/db/schema";
import { TenantResourceNotFoundError, InsufficientRoleError } from "@/lib/authz/errors";
import { SelfRelationshipViolationError, DuplicateRelationshipError, RelationshipAlreadyArchivedError, KnowledgeItemArchivedViolationError } from "./errors";
import type { BrainCapability } from "./authz";
import type { KnowledgeDomain } from "./knowledge-items";
import { createKnowledgeItem, archiveKnowledgeItem } from "./knowledge-items";
import { createRelationship, listRelationshipsForItem, getRelationshipForUser, archiveRelationship, type RelationshipType } from "./relationships";

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `brain-rel-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Relationship Test Org", slug: `brain-rel-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
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

describe("createRelationship", () => {
  it("creates an org-scoped relationship between two org-scoped items", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const a = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "A", content: "c", actorUserId: ownerId });
    const b = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "B", content: "c", actorUserId: ownerId });

    const rel = await createRelationship(db, {
      organizationId: orgId,
      sourceItemId: a.id,
      targetItemId: b.id,
      relationshipType: "supports",
      explanation: "A backs up B's claim",
      actorUserId: ownerId,
    });

    expect(rel.sourceItemId).toBe(a.id);
    expect(rel.targetItemId).toBe(b.id);
    expect(rel.relationshipType).toBe("supports");
    expect(rel.explanation).toBe("A backs up B's claim");
    expect(rel.creatorUserId).toBe(ownerId);
    expect(rel.archivedAt).toBeNull();
  });

  it("accepts every one of the nine approved relationship types", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const a = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "A", content: "c", actorUserId: ownerId });
    const types: RelationshipType[] = ["supports", "contradicts", "depends_on", "supersedes", "related_to", "created_from", "references", "used_by", "required_for"];

    for (const relationshipType of types) {
      const b = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: `target-${relationshipType}`, content: "c", actorUserId: ownerId });
      const rel = await createRelationship(db, { organizationId: orgId, sourceItemId: a.id, targetItemId: b.id, relationshipType, actorUserId: ownerId });
      expect(rel.relationshipType).toBe(relationshipType);
    }
  });

  it("rejects a self-link", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const a = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "A", content: "c", actorUserId: ownerId });

    await expect(
      createRelationship(db, { organizationId: orgId, sourceItemId: a.id, targetItemId: a.id, relationshipType: "related_to", actorUserId: ownerId })
    ).rejects.toBeInstanceOf(SelfRelationshipViolationError);
  });

  it("rejects a self-link at the DATABASE level, bypassing the service layer", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const a = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "A", content: "c", actorUserId: ownerId });

    await expect(
      db.insert(knowledgeRelationships).values({
        organizationId: orgId,
        sourceItemId: a.id,
        targetItemId: a.id,
        relationshipType: "related_to",
        creatorUserId: ownerId,
      })
    ).rejects.toThrow();
  });

  it("rejects an invalid relationship type at the DATABASE level (real Postgres enum), bypassing application validation", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const a = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "A", content: "c", actorUserId: ownerId });
    const b = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "B", content: "c", actorUserId: ownerId });

    await expect(
      db.execute(sql`INSERT INTO knowledge_relationships (id, organization_id, source_item_id, target_item_id, relationship_type, creator_user_id)
                      VALUES (gen_random_uuid(), ${orgId}, ${a.id}, ${b.id}, 'not-a-real-type', ${ownerId})`)
    ).rejects.toThrow();
  });

  it("rejects a duplicate active relationship of the identical (source, target, type)", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const a = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "A", content: "c", actorUserId: ownerId });
    const b = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "B", content: "c", actorUserId: ownerId });

    await createRelationship(db, { organizationId: orgId, sourceItemId: a.id, targetItemId: b.id, relationshipType: "supports", actorUserId: ownerId });

    await expect(
      createRelationship(db, { organizationId: orgId, sourceItemId: a.id, targetItemId: b.id, relationshipType: "supports", actorUserId: ownerId })
    ).rejects.toBeInstanceOf(DuplicateRelationshipError);
  });

  it("allows re-creating the same edge after the original was archived", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const a = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "A", content: "c", actorUserId: ownerId });
    const b = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "B", content: "c", actorUserId: ownerId });

    const first = await createRelationship(db, { organizationId: orgId, sourceItemId: a.id, targetItemId: b.id, relationshipType: "supports", actorUserId: ownerId });
    await archiveRelationship(db, { organizationId: orgId, relationshipId: first.id, actorUserId: ownerId });

    const second = await createRelationship(db, { organizationId: orgId, sourceItemId: a.id, targetItemId: b.id, relationshipType: "supports", actorUserId: ownerId });
    expect(second.id).not.toBe(first.id);
    expect(second.archivedAt).toBeNull();
  });

  it("of two concurrent attempts to create the identical edge, exactly one succeeds and one is rejected as a duplicate", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const a = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "A", content: "c", actorUserId: ownerId });
    const b = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "B", content: "c", actorUserId: ownerId });

    const results = await Promise.allSettled([
      createRelationship(db, { organizationId: orgId, sourceItemId: a.id, targetItemId: b.id, relationshipType: "supports", actorUserId: ownerId }),
      createRelationship(db, { organizationId: orgId, sourceItemId: a.id, targetItemId: b.id, relationshipType: "supports", actorUserId: ownerId }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(DuplicateRelationshipError);

    const rows = await db.select().from(knowledgeRelationships).where(eq(knowledgeRelationships.organizationId, orgId));
    expect(rows).toHaveLength(1);
  });

  it("rejects when either endpoint belongs to a different organization (cross-tenant, application-layer)", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const a = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "A", content: "c", actorUserId: ownerId });

    const otherOwnerId = await makeUser();
    const otherOrgId = await makeOrgWithOwner(otherOwnerId);
    await grantAllCapabilities(otherOrgId, "identity", null, otherOwnerId);
    const foreign = await create({ organizationId: otherOrgId, domain: "identity", classification: "fact", title: "Foreign", content: "c", actorUserId: otherOwnerId });

    await expect(
      createRelationship(db, { organizationId: orgId, sourceItemId: a.id, targetItemId: foreign.id, relationshipType: "related_to", actorUserId: ownerId })
    ).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });

  it("rejects a cross-organization edge at the DATABASE level, bypassing the service layer", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const a = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "A", content: "c", actorUserId: ownerId });

    const otherOwnerId = await makeUser();
    const otherOrgId = await makeOrgWithOwner(otherOwnerId);
    await grantAllCapabilities(otherOrgId, "identity", null, otherOwnerId);
    const foreign = await create({ organizationId: otherOrgId, domain: "identity", classification: "fact", title: "Foreign", content: "c", actorUserId: otherOwnerId });

    // organization_id claims orgId, but target_item_id actually belongs to otherOrgId — the composite FK must reject this.
    await expect(
      db.insert(knowledgeRelationships).values({
        organizationId: orgId,
        sourceItemId: a.id,
        targetItemId: foreign.id,
        relationshipType: "related_to",
        creatorUserId: ownerId,
      })
    ).rejects.toThrow();
  });

  it("rejects creating an edge to a workspace-scoped item the actor has no explicit membership in, even as organization owner", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    await addOrgMember(orgId, memberId, "member");
    const workspaceId = await makeWorkspace(orgId);
    await addWorkspaceMember(workspaceId, memberId, "member");
    await grantAllCapabilities(orgId, "execution", workspaceId, memberId);

    const a = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "A", content: "c", actorUserId: ownerId });
    const wsItem = await create({ organizationId: orgId, workspaceId, domain: "execution", classification: "note", title: "WS Item", content: "c", actorUserId: memberId });

    await expect(
      createRelationship(db, { organizationId: orgId, sourceItemId: a.id, targetItemId: wsItem.id, relationshipType: "related_to", actorUserId: ownerId })
    ).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });

  it("succeeds across two different workspaces when the actor is an explicit member of both", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const wsA = await makeWorkspace(orgId);
    const wsB = await makeWorkspace(orgId);
    await addWorkspaceMember(wsA, ownerId, "member");
    await addWorkspaceMember(wsB, ownerId, "member");
    await grantAllCapabilities(orgId, "execution", wsA, ownerId);
    await grantAllCapabilities(orgId, "execution", wsB, ownerId);

    const a = await create({ organizationId: orgId, workspaceId: wsA, domain: "execution", classification: "note", title: "A", content: "c", actorUserId: ownerId });
    const b = await create({ organizationId: orgId, workspaceId: wsB, domain: "execution", classification: "note", title: "B", content: "c", actorUserId: ownerId });

    const rel = await createRelationship(db, { organizationId: orgId, sourceItemId: a.id, targetItemId: b.id, relationshipType: "depends_on", actorUserId: ownerId });
    expect(rel.id).toBeTruthy();
  });

  it("rejects when either endpoint is archived", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const a = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "A", content: "c", actorUserId: ownerId });
    const b = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "B", content: "c", actorUserId: ownerId });
    await archiveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: b.id, actorUserId: ownerId, expectedVersionNumber: 1 });

    await expect(
      createRelationship(db, { organizationId: orgId, sourceItemId: a.id, targetItemId: b.id, relationshipType: "related_to", actorUserId: ownerId })
    ).rejects.toBeInstanceOf(KnowledgeItemArchivedViolationError);
  });
});

describe("listRelationshipsForItem", () => {
  it("lists outgoing and incoming edges by default (both directions)", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const a = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "A", content: "c", actorUserId: ownerId });
    const b = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "B", content: "c", actorUserId: ownerId });
    const c = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "C", content: "c", actorUserId: ownerId });

    await createRelationship(db, { organizationId: orgId, sourceItemId: a.id, targetItemId: b.id, relationshipType: "supports", actorUserId: ownerId });
    await createRelationship(db, { organizationId: orgId, sourceItemId: c.id, targetItemId: a.id, relationshipType: "references", actorUserId: ownerId });

    const { relationships } = await listRelationshipsForItem(db, { organizationId: orgId, knowledgeItemId: a.id, actorUserId: ownerId });
    expect(relationships).toHaveLength(2);
  });

  it("direction filters correctly", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const a = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "A", content: "c", actorUserId: ownerId });
    const b = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "B", content: "c", actorUserId: ownerId });
    const c = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "C", content: "c", actorUserId: ownerId });

    await createRelationship(db, { organizationId: orgId, sourceItemId: a.id, targetItemId: b.id, relationshipType: "supports", actorUserId: ownerId });
    await createRelationship(db, { organizationId: orgId, sourceItemId: c.id, targetItemId: a.id, relationshipType: "references", actorUserId: ownerId });

    const outgoing = await listRelationshipsForItem(db, { organizationId: orgId, knowledgeItemId: a.id, actorUserId: ownerId, direction: "outgoing" });
    expect(outgoing.relationships).toHaveLength(1);
    expect(outgoing.relationships[0].relationshipType).toBe("supports");

    const incoming = await listRelationshipsForItem(db, { organizationId: orgId, knowledgeItemId: a.id, actorUserId: ownerId, direction: "incoming" });
    expect(incoming.relationships).toHaveLength(1);
    expect(incoming.relationships[0].relationshipType).toBe("references");
  });

  it("excludes archived relationships by default, and surfaces them only when explicitly requested", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const a = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "A", content: "c", actorUserId: ownerId });
    const b = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "B", content: "c", actorUserId: ownerId });
    const rel = await createRelationship(db, { organizationId: orgId, sourceItemId: a.id, targetItemId: b.id, relationshipType: "supports", actorUserId: ownerId });
    await archiveRelationship(db, { organizationId: orgId, relationshipId: rel.id, actorUserId: ownerId });

    const active = await listRelationshipsForItem(db, { organizationId: orgId, knowledgeItemId: a.id, actorUserId: ownerId });
    expect(active.relationships).toHaveLength(0);

    const archived = await listRelationshipsForItem(db, { organizationId: orgId, knowledgeItemId: a.id, actorUserId: ownerId, status: "archived" });
    expect(archived.relationships).toHaveLength(1);
  });

  it("never surfaces an edge whose other endpoint the actor cannot independently read (§7's visibility rule)", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    await addOrgMember(orgId, memberId, "member");
    const workspaceId = await makeWorkspace(orgId);
    await addWorkspaceMember(workspaceId, memberId, "member");
    await grantAllCapabilities(orgId, "identity", null, memberId);
    await grantAllCapabilities(orgId, "execution", workspaceId, memberId);

    const orgItem = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "Org item", content: "c", actorUserId: memberId });
    const wsItem = await create({ organizationId: orgId, workspaceId, domain: "execution", classification: "note", title: "WS item", content: "c", actorUserId: memberId });
    await createRelationship(db, { organizationId: orgId, sourceItemId: orgItem.id, targetItemId: wsItem.id, relationshipType: "related_to", actorUserId: memberId });

    // Owner has organization membership (can see orgItem) but no explicit workspace membership (cannot see wsItem).
    const { relationships } = await listRelationshipsForItem(db, { organizationId: orgId, knowledgeItemId: orgItem.id, actorUserId: ownerId });
    expect(relationships).toHaveLength(0);

    // The explicit workspace member sees it fine.
    const asMember = await listRelationshipsForItem(db, { organizationId: orgId, knowledgeItemId: orgItem.id, actorUserId: memberId });
    expect(asMember.relationships).toHaveLength(1);
  });

  it("bounds pagination — limit is capped, and nextCursor is returned when more rows exist", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const a = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "A", content: "c", actorUserId: ownerId });
    for (let i = 0; i < 5; i++) {
      const b = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: `b-${i}`, content: "c", actorUserId: ownerId });
      await createRelationship(db, { organizationId: orgId, sourceItemId: a.id, targetItemId: b.id, relationshipType: "related_to", actorUserId: ownerId });
    }

    const firstPage = await listRelationshipsForItem(db, { organizationId: orgId, knowledgeItemId: a.id, actorUserId: ownerId, limit: 2 });
    expect(firstPage.relationships).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await listRelationshipsForItem(db, {
      organizationId: orgId,
      knowledgeItemId: a.id,
      actorUserId: ownerId,
      limit: 2,
      cursor: firstPage.nextCursor,
    });
    expect(secondPage.relationships).toHaveLength(2);
    expect(secondPage.relationships[0].id).not.toBe(firstPage.relationships[0].id);
  });
});

describe("getRelationshipForUser", () => {
  it("returns 404-equivalent for a cross-tenant relationship id", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const a = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "A", content: "c", actorUserId: ownerId });
    const b = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "B", content: "c", actorUserId: ownerId });
    const rel = await createRelationship(db, { organizationId: orgId, sourceItemId: a.id, targetItemId: b.id, relationshipType: "supports", actorUserId: ownerId });

    const otherOwnerId = await makeUser();
    const otherOrgId = await makeOrgWithOwner(otherOwnerId);

    await expect(getRelationshipForUser(db, otherOrgId, rel.id, otherOwnerId)).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });

  it("returns 404-equivalent when the actor cannot independently read the other endpoint", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    await addOrgMember(orgId, memberId, "member");
    const workspaceId = await makeWorkspace(orgId);
    await addWorkspaceMember(workspaceId, memberId, "member");
    await grantAllCapabilities(orgId, "identity", null, memberId);
    await grantAllCapabilities(orgId, "execution", workspaceId, memberId);

    const orgItem = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "Org item", content: "c", actorUserId: memberId });
    const wsItem = await create({ organizationId: orgId, workspaceId, domain: "execution", classification: "note", title: "WS item", content: "c", actorUserId: memberId });
    const rel = await createRelationship(db, { organizationId: orgId, sourceItemId: orgItem.id, targetItemId: wsItem.id, relationshipType: "related_to", actorUserId: memberId });

    await expect(getRelationshipForUser(db, orgId, rel.id, ownerId)).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });
});

describe("archiveRelationship", () => {
  it("archives a relationship when the actor holds update authority on both endpoints", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const a = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "A", content: "c", actorUserId: ownerId });
    const b = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "B", content: "c", actorUserId: ownerId });
    const rel = await createRelationship(db, { organizationId: orgId, sourceItemId: a.id, targetItemId: b.id, relationshipType: "supports", actorUserId: ownerId });

    const archived = await archiveRelationship(db, { organizationId: orgId, relationshipId: rel.id, actorUserId: ownerId });
    expect(archived.archivedAt).not.toBeNull();
  });

  it("cannot archive an already-archived relationship", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const a = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "A", content: "c", actorUserId: ownerId });
    const b = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "B", content: "c", actorUserId: ownerId });
    const rel = await createRelationship(db, { organizationId: orgId, sourceItemId: a.id, targetItemId: b.id, relationshipType: "supports", actorUserId: ownerId });
    await archiveRelationship(db, { organizationId: orgId, relationshipId: rel.id, actorUserId: ownerId });

    await expect(archiveRelationship(db, { organizationId: orgId, relationshipId: rel.id, actorUserId: ownerId })).rejects.toBeInstanceOf(
      RelationshipAlreadyArchivedError
    );
  });

  it("of two concurrent archive attempts on the same relationship, exactly one succeeds and one is rejected — no double archive", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const a = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "A", content: "c", actorUserId: ownerId });
    const b = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "B", content: "c", actorUserId: ownerId });
    const rel = await createRelationship(db, { organizationId: orgId, sourceItemId: a.id, targetItemId: b.id, relationshipType: "supports", actorUserId: ownerId });

    const results = await Promise.allSettled([
      archiveRelationship(db, { organizationId: orgId, relationshipId: rel.id, actorUserId: ownerId }),
      archiveRelationship(db, { organizationId: orgId, relationshipId: rel.id, actorUserId: ownerId }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(RelationshipAlreadyArchivedError);
  });

  it("requires update authority on BOTH endpoints — an explicit edit grant in only the source's workspace cannot archive an edge into a target workspace where the actor holds no edit grant", async () => {
    const ownerId = await makeUser();
    const managerId = await makeUser();
    const otherAuthorId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    await addOrgMember(orgId, managerId, "member");
    await addOrgMember(orgId, otherAuthorId, "member");
    const wsA = await makeWorkspace(orgId);
    const wsB = await makeWorkspace(orgId);
    await addWorkspaceMember(wsA, managerId, "manager");
    await addWorkspaceMember(wsB, managerId, "member");
    await addWorkspaceMember(wsB, otherAuthorId, "member");
    // managerId holds full edit authority (as author) in wsA, but only `read` in wsB — no
    // edit_own_draft/edit_any_draft there at all. Workspace role (manager vs. member) is
    // irrelevant to this check under Module 7 — only the explicit grant set matters.
    await grantAllCapabilities(orgId, "execution", wsA, managerId);
    await grantCapability(orgId, "execution", wsB, managerId, "read");
    await grantAllCapabilities(orgId, "execution", wsB, otherAuthorId);

    const a = await create({ organizationId: orgId, workspaceId: wsA, domain: "execution", classification: "note", title: "A", content: "c", actorUserId: managerId });
    // B is authored by someone else, so managerId cannot fall back on the "author" path for B —
    // this isolates the check to managerId's own explicit grant set in wsB.
    const b = await create({ organizationId: orgId, workspaceId: wsB, domain: "execution", classification: "note", title: "B", content: "c", actorUserId: otherAuthorId });
    const rel = await createRelationship(db, { organizationId: orgId, sourceItemId: a.id, targetItemId: b.id, relationshipType: "depends_on", actorUserId: managerId });

    // managerId can read B (so the rejection below is specifically about missing edit
    // authority, not read-inaccessibility) but has no edit_own_draft/edit_any_draft grant in
    // wsB, and isn't B's author — archive requires update authority on BOTH endpoints.
    await expect(archiveRelationship(db, { organizationId: orgId, relationshipId: rel.id, actorUserId: managerId })).rejects.toBeInstanceOf(
      InsufficientRoleError
    );
  });

  it("relationship creator is not, by itself, sufficient authority to archive — archive authority comes entirely from endpoint edit authority", async () => {
    const ownerId = await makeUser();
    const authorId = await makeUser();
    const otherMemberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    await addOrgMember(orgId, authorId, "member");
    await addOrgMember(orgId, otherMemberId, "member");
    await grantAllCapabilities(orgId, "identity", null, authorId);
    // otherMemberId can read (proving the rejection is specifically about missing edit authority) but has no edit_own_draft/edit_any_draft grant.
    await grantCapability(orgId, "identity", null, otherMemberId, "read");
    const a = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "A", content: "c", actorUserId: authorId });
    const b = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "B", content: "c", actorUserId: authorId });
    // authorId creates the relationship (its own items), then a different plain member (not author, no edit grant) must be rejected.
    const rel = await createRelationship(db, { organizationId: orgId, sourceItemId: a.id, targetItemId: b.id, relationshipType: "supports", actorUserId: authorId });

    await expect(archiveRelationship(db, { organizationId: orgId, relationshipId: rel.id, actorUserId: otherMemberId })).rejects.toBeInstanceOf(
      InsufficientRoleError
    );
  });
});

describe("audit events", () => {
  it("records knowledge_relationship_created and knowledge_relationship_archived, never leaking explanation text", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const secretExplanation = "SECRET_EXPLANATION_MARKER_never_in_audit";
    const a = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "A", content: "c", actorUserId: ownerId });
    const b = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "B", content: "c", actorUserId: ownerId });
    const rel = await createRelationship(db, {
      organizationId: orgId,
      sourceItemId: a.id,
      targetItemId: b.id,
      relationshipType: "supports",
      explanation: secretExplanation,
      actorUserId: ownerId,
    });
    await archiveRelationship(db, { organizationId: orgId, relationshipId: rel.id, actorUserId: ownerId });

    const createdEvents = await db
      .select()
      .from(auditLogs)
      .where(sql`${auditLogs.organizationId} = ${orgId} and ${auditLogs.eventType} = 'knowledge_relationship_created'`);
    expect(createdEvents).toHaveLength(1);

    const archivedEvents = await db
      .select()
      .from(auditLogs)
      .where(sql`${auditLogs.organizationId} = ${orgId} and ${auditLogs.eventType} = 'knowledge_relationship_archived'`);
    expect(archivedEvents).toHaveLength(1);

    const allRows = await db.select().from(auditLogs).where(eq(auditLogs.organizationId, orgId));
    for (const row of allRows) {
      expect(JSON.stringify(row.metadata)).not.toContain(secretExplanation);
    }
  });

  it("there is no hard-delete path anywhere in this module", async () => {
    const relationshipsModule = await import("./relationships");
    expect((relationshipsModule as Record<string, unknown>).deleteRelationship).toBeUndefined();
    expect((relationshipsModule as Record<string, unknown>).hardDeleteRelationship).toBeUndefined();
    expect((relationshipsModule as Record<string, unknown>).restoreRelationship).toBeUndefined();

    const oneRoute = await import("@/app/api/organizations/[organizationId]/knowledge-relationships/[relationshipId]/route");
    expect((oneRoute as Record<string, unknown>).DELETE).toBeUndefined();
    expect((oneRoute as Record<string, unknown>).PATCH).toBeUndefined();
  });
});
