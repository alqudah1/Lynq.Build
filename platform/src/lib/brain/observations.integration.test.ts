import { describe, it, expect, afterEach } from "vitest";
import { neon } from "@neondatabase/serverless";
import { sql, eq } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, knowledgeItems, knowledgeRelationships, auditLogs, brainPermissionGrants } from "@/db/schema";
import { ObservationRequiresSourceError, ObservationTrustCeilingError } from "./errors";
import type { BrainCapability } from "./authz";
import { createKnowledgeItem, type KnowledgeDomain } from "./knowledge-items";
import { attachTrustMetadata } from "./trust";
import { createObservation } from "./observations";

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `brain-observations-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Observations Test Org", slug: `brain-observations-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: ownerId, role: "owner" });
  createdOrgIds.push(org.id);
  return org.id;
}

async function grantCapability(organizationId: string, domain: KnowledgeDomain, granteeUserId: string, capability: BrainCapability): Promise<void> {
  await db.insert(brainPermissionGrants).values({ organizationId, domain, workspaceId: null, granteeUserId, capability });
}

async function grantAllCapabilities(organizationId: string, domain: KnowledgeDomain, granteeUserId: string): Promise<void> {
  for (const capability of ["read", "draft_write", "edit_own_draft", "approve"] as const) {
    await grantCapability(organizationId, domain, granteeUserId, capability);
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

describe("createObservation", () => {
  it("creates an observation-classified item with a created_from edge to each cited source", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", ownerId);
    const factA = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "Fact A", content: "meeting note 1", actorUserId: ownerId });
    const factB = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "Fact B", content: "meeting note 2", actorUserId: ownerId });

    const { item, relationships } = await createObservation(db, rawSql, {
      organizationId: orgId,
      domain: "identity",
      title: "Pattern across meetings",
      content: "Both meetings raised the same concern",
      sourceItemIds: [factA.id, factB.id],
      actorUserId: ownerId,
    });

    expect(item.classification).toBe("observation");
    expect(relationships).toHaveLength(2);
    for (const rel of relationships) {
      expect(rel.relationshipType).toBe("created_from");
      expect(rel.sourceItemId).toBe(item.id);
    }
    expect(relationships.map((r) => r.targetItemId).sort()).toEqual([factA.id, factB.id].sort());

    const rows = await db.select().from(knowledgeRelationships).where(eq(knowledgeRelationships.sourceItemId, item.id));
    expect(rows).toHaveLength(2);
  });

  it("rejects an observation with zero cited sources, before any row is written", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", ownerId);

    await expect(
      createObservation(db, rawSql, { organizationId: orgId, domain: "identity", title: "No sources", content: "content", sourceItemIds: [], actorUserId: ownerId })
    ).rejects.toBeInstanceOf(ObservationRequiresSourceError);

    const rows = await db.select().from(knowledgeItems).where(eq(knowledgeItems.organizationId, orgId));
    expect(rows).toHaveLength(0);
  });

  it("supports 'supports' as the relationship type instead of the created_from default", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", ownerId);
    const source = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "Source", content: "c", actorUserId: ownerId });

    const { relationships } = await createObservation(db, rawSql, {
      organizationId: orgId,
      domain: "identity",
      title: "Obs",
      content: "content",
      sourceItemIds: [source.id],
      relationshipType: "supports",
      actorUserId: ownerId,
    });
    expect(relationships[0].relationshipType).toBe("supports");
  });
});

describe("Observation trust ceiling", () => {
  it("rejects setting an observation's trust tier to verified", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", ownerId);
    const source = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "Source", content: "c", actorUserId: ownerId });
    const { item } = await createObservation(db, rawSql, {
      organizationId: orgId,
      domain: "identity",
      title: "Obs",
      content: "content",
      sourceItemIds: [source.id],
      actorUserId: ownerId,
    });

    await expect(
      attachTrustMetadata(db, { organizationId: orgId, knowledgeItemId: item.id, versionNumber: 1, trustTier: "verified", expectedRevision: 0, sourceType: "meeting_notes", actorUserId: ownerId })
    ).rejects.toBeInstanceOf(ObservationTrustCeilingError);
  });

  it("allows setting an observation's trust tier to approved (below the ceiling)", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", ownerId);
    const source = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "Source", content: "c", actorUserId: ownerId });
    const { item } = await createObservation(db, rawSql, {
      organizationId: orgId,
      domain: "identity",
      title: "Obs",
      content: "content",
      sourceItemIds: [source.id],
      actorUserId: ownerId,
    });

    const result = await attachTrustMetadata(db, { organizationId: orgId, knowledgeItemId: item.id, versionNumber: 1, trustTier: "approved", expectedRevision: 0, sourceType: "meeting_notes", actorUserId: ownerId });
    expect(result.trust.trustTier).toBe("approved");
  });

  it("does not affect non-observation items — a plain fact can still be set to verified", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "Fact", content: "c", actorUserId: ownerId });

    const result = await attachTrustMetadata(db, { organizationId: orgId, knowledgeItemId: item.id, versionNumber: 1, trustTier: "verified", expectedRevision: 0, sourceType: "founder_decision", actorUserId: ownerId });
    expect(result.trust.trustTier).toBe("verified");
  });
});
