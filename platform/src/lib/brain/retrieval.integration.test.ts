import { describe, it, expect, afterEach } from "vitest";
import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, workspaces, workspaceMemberships, knowledgeItems, knowledgeRelationships, auditLogs, brainPermissionGrants } from "@/db/schema";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import type { BrainCapability } from "./authz";
import { createKnowledgeItem, type KnowledgeDomain } from "./knowledge-items";
import { createRelationship } from "./relationships";
import { retireKnowledgeItem } from "./lifecycle";
import { retrieveRelevantKnowledge } from "./retrieval";

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `brain-retrieval-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Retrieval Test Org", slug: `brain-retrieval-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: ownerId, role: "owner" });
  createdOrgIds.push(org.id);
  return org.id;
}

async function addOrgMember(orgId: string, userId: string, role: "member" | "viewer"): Promise<void> {
  await db.insert(organizationMemberships).values({ organizationId: orgId, userId, role });
}

async function makeWorkspace(orgId: string): Promise<string> {
  const [ws] = await db.insert(workspaces).values({ organizationId: orgId, name: "WS", slug: `ws-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: workspaces.id });
  return ws.id;
}

async function addWorkspaceMember(workspaceId: string, userId: string, role: "manager" | "member" | "viewer"): Promise<void> {
  await db.insert(workspaceMemberships).values({ workspaceId, userId, role });
}

async function grantCapability(organizationId: string, domain: KnowledgeDomain, workspaceId: string | null, granteeUserId: string, capability: BrainCapability): Promise<void> {
  await db.insert(brainPermissionGrants).values({ organizationId, domain, workspaceId, granteeUserId, capability });
}

async function grantAllCapabilities(organizationId: string, domain: KnowledgeDomain, workspaceId: string | null, granteeUserId: string): Promise<void> {
  for (const capability of ["read", "draft_write"] as const) {
    await grantCapability(organizationId, domain, workspaceId, granteeUserId, capability);
  }
}

function create(input: Parameters<typeof createKnowledgeItem>[2]) {
  return createKnowledgeItem(db, rawSql, input);
}

afterEach(async () => {
  while (createdOrgIds.length > 0) {
    const id = createdOrgIds.pop()!;
    await db.delete(knowledgeRelationships).where(sql`${knowledgeRelationships.organizationId} = ${id}`);
    await db.delete(knowledgeItems).where(sql`${knowledgeItems.organizationId} = ${id}`);
    await db.delete(auditLogs).where(sql`${auditLogs.organizationId} = ${id}`);
    await db.delete(organizations).where(sql`${organizations.id} = ${id}`);
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await db.delete(users).where(sql`${users.id} = ${id}`);
  }
});

describe("retrieveRelevantKnowledge", () => {
  it("unions a keyword seed hit with its graph-traversal neighbor, de-duplicated", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const seed = await create({ organizationId: orgId, domain: "identity", classification: "note", title: "Narwhal Policy", content: "details about narwhal handling", actorUserId: ownerId });
    const neighbor = await create({ organizationId: orgId, domain: "identity", classification: "note", title: "Related Doc", content: "unrelated words entirely", actorUserId: ownerId });
    await createRelationship(db, { organizationId: orgId, sourceItemId: seed.id, targetItemId: neighbor.id, relationshipType: "related_to", actorUserId: ownerId });

    const { nodes } = await retrieveRelevantKnowledge(db, { organizationId: orgId, query: "narwhal", actorUserId: ownerId });
    const ids = nodes.map((n) => n.item.id);
    expect(ids).toContain(seed.id);
    expect(ids).toContain(neighbor.id);
    expect(new Set(ids).size).toBe(ids.length);

    const seedNode = nodes.find((n) => n.item.id === seed.id)!;
    expect(seedNode.source).toBe("keyword");
    expect(seedNode.depth).toBe(0);
    const neighborNode = nodes.find((n) => n.item.id === neighbor.id)!;
    expect(neighborNode.source).toBe("graph");
    expect(neighborNode.depth).toBe(1);
  });

  it("is cycle-safe — a deliberately cyclic relationship graph never loops or duplicates a node", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const a = await create({ organizationId: orgId, domain: "identity", classification: "note", title: "Quokka A", content: "quokka details here", actorUserId: ownerId });
    const b = await create({ organizationId: orgId, domain: "identity", classification: "note", title: "B", content: "b content", actorUserId: ownerId });
    const c = await create({ organizationId: orgId, domain: "identity", classification: "note", title: "C", content: "c content", actorUserId: ownerId });
    await createRelationship(db, { organizationId: orgId, sourceItemId: a.id, targetItemId: b.id, relationshipType: "related_to", actorUserId: ownerId });
    await createRelationship(db, { organizationId: orgId, sourceItemId: b.id, targetItemId: c.id, relationshipType: "related_to", actorUserId: ownerId });
    await createRelationship(db, { organizationId: orgId, sourceItemId: c.id, targetItemId: a.id, relationshipType: "related_to", actorUserId: ownerId });

    const { nodes } = await retrieveRelevantKnowledge(db, { organizationId: orgId, query: "quokka", actorUserId: ownerId, maxDepth: 5 });
    const ids = nodes.map((n) => n.item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([a.id, b.id, c.id]));
  });

  it("never surfaces a graph-traversal neighbor the actor cannot already read directly, and never expands traversal through an invisible node", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, memberId, "member");
    const workspaceId = await makeWorkspace(orgId);
    await addWorkspaceMember(workspaceId, memberId, "member");
    await grantAllCapabilities(orgId, "execution", workspaceId, memberId);
    await grantAllCapabilities(orgId, "identity", null, memberId);

    const seed = await create({ organizationId: orgId, domain: "identity", classification: "note", title: "Toucan Report", content: "toucan migration details", actorUserId: memberId });
    // hiddenFromOwner lives in a workspace the owner cannot see.
    const hiddenFromOwner = await create({ organizationId: orgId, workspaceId, domain: "execution", classification: "note", title: "Hidden", content: "hidden content", actorUserId: memberId });
    const beyondHidden = await create({ organizationId: orgId, domain: "identity", classification: "note", title: "Beyond", content: "content beyond the hidden node", actorUserId: memberId });
    await createRelationship(db, { organizationId: orgId, sourceItemId: seed.id, targetItemId: hiddenFromOwner.id, relationshipType: "related_to", actorUserId: memberId });
    await createRelationship(db, { organizationId: orgId, sourceItemId: hiddenFromOwner.id, targetItemId: beyondHidden.id, relationshipType: "related_to", actorUserId: memberId });

    // Owner cannot read the workspace-scoped node, and therefore never traverses through it to reach "Beyond" either.
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const asOwner = await retrieveRelevantKnowledge(db, { organizationId: orgId, query: "toucan", actorUserId: ownerId, maxDepth: 3 });
    const ownerIds = asOwner.nodes.map((n) => n.item.id);
    expect(ownerIds).toContain(seed.id);
    expect(ownerIds).not.toContain(hiddenFromOwner.id);
    expect(ownerIds).not.toContain(beyondHidden.id);

    // The workspace member can see all three.
    const asMember = await retrieveRelevantKnowledge(db, { organizationId: orgId, query: "toucan", actorUserId: memberId, maxDepth: 3 });
    const memberIds = asMember.nodes.map((n) => n.item.id);
    expect(memberIds).toEqual(expect.arrayContaining([seed.id, hiddenFromOwner.id, beyondHidden.id]));
  });

  it("respects maxDepth — a node two hops away is excluded when maxDepth is 1", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const seed = await create({ organizationId: orgId, domain: "identity", classification: "note", title: "Platypus Notes", content: "platypus habitat notes", actorUserId: ownerId });
    const oneHop = await create({ organizationId: orgId, domain: "identity", classification: "note", title: "One Hop", content: "one hop content", actorUserId: ownerId });
    const twoHops = await create({ organizationId: orgId, domain: "identity", classification: "note", title: "Two Hops", content: "two hop content", actorUserId: ownerId });
    await createRelationship(db, { organizationId: orgId, sourceItemId: seed.id, targetItemId: oneHop.id, relationshipType: "related_to", actorUserId: ownerId });
    await createRelationship(db, { organizationId: orgId, sourceItemId: oneHop.id, targetItemId: twoHops.id, relationshipType: "related_to", actorUserId: ownerId });

    const { nodes } = await retrieveRelevantKnowledge(db, { organizationId: orgId, query: "platypus", actorUserId: ownerId, maxDepth: 1 });
    const ids = nodes.map((n) => n.item.id);
    expect(ids).toContain(seed.id);
    expect(ids).toContain(oneHop.id);
    expect(ids).not.toContain(twoHops.id);
  });

  it("excludes a retired neighbor discovered via traversal, matching keyword search's own liveness rule", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    await grantCapability(orgId, "identity", null, ownerId, "archive");
    const seed = await create({ organizationId: orgId, domain: "identity", classification: "note", title: "Wombat Report", content: "wombat burrow depth study", actorUserId: ownerId });
    const retiredNeighbor = await create({ organizationId: orgId, domain: "identity", classification: "note", title: "Old", content: "old content", actorUserId: ownerId });
    await createRelationship(db, { organizationId: orgId, sourceItemId: seed.id, targetItemId: retiredNeighbor.id, relationshipType: "related_to", actorUserId: ownerId });
    await retireKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: retiredNeighbor.id, reason: "superseded", actorUserId: ownerId });

    const { nodes } = await retrieveRelevantKnowledge(db, { organizationId: orgId, query: "wombat", actorUserId: ownerId });
    expect(nodes.map((n) => n.item.id)).not.toContain(retiredNeighbor.id);
  });

  it("rejects a non-member with the identical not-found error as every other Brain read", async () => {
    const ownerId = await makeUser();
    const strangerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);

    await expect(retrieveRelevantKnowledge(db, { organizationId: orgId, query: "anything", actorUserId: strangerId })).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });
});
