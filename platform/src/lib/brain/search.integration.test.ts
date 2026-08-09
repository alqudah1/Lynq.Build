import { describe, it, expect, afterEach } from "vitest";
import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, workspaces, workspaceMemberships, knowledgeItems, auditLogs, brainPermissionGrants } from "@/db/schema";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import type { BrainCapability } from "./authz";
import { createKnowledgeItem, archiveKnowledgeItem, type KnowledgeDomain } from "./knowledge-items";
import { retireKnowledgeItem } from "./lifecycle";
import { searchKnowledgeItems } from "./search";

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `brain-search-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Search Test Org", slug: `brain-search-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
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
  for (const capability of ["read", "draft_write", "edit_own_draft", "archive"] as const) {
    await grantCapability(organizationId, domain, workspaceId, granteeUserId, capability);
  }
}

function create(input: Parameters<typeof createKnowledgeItem>[2]) {
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

describe("searchKnowledgeItems", () => {
  it("returns items matching the query term, ranked, and excludes non-matching items", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    await create({ organizationId: orgId, domain: "identity", classification: "policy", title: "Refund Policy", content: "Customers may request a refund within 30 days", actorUserId: ownerId });
    await create({ organizationId: orgId, domain: "identity", classification: "note", title: "Team Offsite", content: "Notes from the quarterly offsite", actorUserId: ownerId });

    const { results } = await searchKnowledgeItems(db, { organizationId: orgId, query: "refund", actorUserId: ownerId });
    expect(results).toHaveLength(1);
    expect(results[0].item.title).toBe("Refund Policy");
  });

  it("ranks an exact/stronger term match above a weaker one", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    await create({ organizationId: orgId, domain: "identity", classification: "note", title: "Onboarding", content: "onboarding onboarding onboarding process for new hires", actorUserId: ownerId });
    await create({ organizationId: orgId, domain: "identity", classification: "note", title: "Misc", content: "a brief mention of onboarding in passing", actorUserId: ownerId });

    const { results } = await searchKnowledgeItems(db, { organizationId: orgId, query: "onboarding", actorUserId: ownerId });
    expect(results).toHaveLength(2);
    expect(results[0].item.title).toBe("Onboarding");
    expect(results[0].rank).toBeGreaterThan(results[1].rank);
  });

  it("never returns a workspace-scoped item to an actor without explicit membership in that workspace", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, memberId, "member");
    const workspaceId = await makeWorkspace(orgId);
    await addWorkspaceMember(workspaceId, memberId, "member");
    await grantAllCapabilities(orgId, "execution", workspaceId, memberId);
    await create({ organizationId: orgId, workspaceId, domain: "execution", classification: "note", title: "Secret Project Plan", content: "confidential roadmap details", actorUserId: memberId });

    const asOwner = await searchKnowledgeItems(db, { organizationId: orgId, query: "confidential", actorUserId: ownerId });
    expect(asOwner.results).toHaveLength(0);

    const asMember = await searchKnowledgeItems(db, { organizationId: orgId, query: "confidential", actorUserId: memberId });
    expect(asMember.results).toHaveLength(1);
  });

  it("never returns an item the actor lacks a read Domain Grant for, even with organization and workspace membership", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, memberId, "member");
    await grantCapability(orgId, "identity", null, memberId, "draft_write");
    // Deliberately no "read" grant for memberId.
    await create({ organizationId: orgId, domain: "identity", classification: "note", title: "Findable Note", content: "a note about widgets", actorUserId: memberId });

    const { results } = await searchKnowledgeItems(db, { organizationId: orgId, query: "widgets", actorUserId: memberId });
    expect(results).toHaveLength(0);
  });

  it("excludes archived and retired items by default", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const archivedItem = await create({ organizationId: orgId, domain: "identity", classification: "note", title: "Old Note", content: "a stale mention of gizmos", actorUserId: ownerId });
    await archiveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: archivedItem.id, actorUserId: ownerId, expectedVersionNumber: 1 });
    const retiredItem = await create({ organizationId: orgId, domain: "identity", classification: "note", title: "Retired Note", content: "another mention of gizmos", actorUserId: ownerId });
    await retireKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: retiredItem.id, reason: "superseded", actorUserId: ownerId });

    const { results } = await searchKnowledgeItems(db, { organizationId: orgId, query: "gizmos", actorUserId: ownerId });
    expect(results).toHaveLength(0);
  });

  it("filters by domain and by explicit workspaceId (null meaning organization-scoped only)", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    await grantAllCapabilities(orgId, "growth", null, ownerId);
    await create({ organizationId: orgId, domain: "identity", classification: "note", title: "Identity Doc", content: "the word zephyr appears here", actorUserId: ownerId });
    await create({ organizationId: orgId, domain: "growth", classification: "note", title: "Growth Doc", content: "the word zephyr appears here too", actorUserId: ownerId });

    const identityOnly = await searchKnowledgeItems(db, { organizationId: orgId, query: "zephyr", domain: "identity", actorUserId: ownerId });
    expect(identityOnly.results).toHaveLength(1);
    expect(identityOnly.results[0].item.domain).toBe("identity");

    const orgScopedOnly = await searchKnowledgeItems(db, { organizationId: orgId, query: "zephyr", workspaceId: null, actorUserId: ownerId });
    expect(orgScopedOnly.results).toHaveLength(2);
  });

  it("bounds pagination — limit is capped, and nextCursor is returned when more rows exist", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    for (let i = 0; i < 5; i++) {
      await create({ organizationId: orgId, domain: "identity", classification: "note", title: `flamingo-${i}`, content: "flamingo flamingo flamingo appears repeatedly", actorUserId: ownerId });
    }

    const firstPage = await searchKnowledgeItems(db, { organizationId: orgId, query: "flamingo", actorUserId: ownerId, limit: 2 });
    expect(firstPage.results).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await searchKnowledgeItems(db, { organizationId: orgId, query: "flamingo", actorUserId: ownerId, limit: 2, cursor: firstPage.nextCursor });
    expect(secondPage.results).toHaveLength(2);
    expect(secondPage.results[0].item.id).not.toBe(firstPage.results[0].item.id);
    expect(secondPage.results[0].item.id).not.toBe(firstPage.results[1].item.id);
  });

  it("returns no results (never throws) for a query with no matches", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    await create({ organizationId: orgId, domain: "identity", classification: "note", title: "t", content: "c", actorUserId: ownerId });

    const { results, nextCursor } = await searchKnowledgeItems(db, { organizationId: orgId, query: "nonexistentxyzterm", actorUserId: ownerId });
    expect(results).toHaveLength(0);
    expect(nextCursor).toBeNull();
  });

  it("rejects a non-member with the identical not-found error as every other Brain read", async () => {
    const ownerId = await makeUser();
    const strangerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);

    await expect(searchKnowledgeItems(db, { organizationId: orgId, query: "anything", actorUserId: strangerId })).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });
});
