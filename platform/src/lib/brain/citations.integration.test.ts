import { describe, it, expect, afterEach } from "vitest";
import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, knowledgeItems, auditLogs, brainPermissionGrants } from "@/db/schema";
import type { BrainCapability } from "./authz";
import { createKnowledgeItem, type KnowledgeDomain } from "./knowledge-items";
import { attachTrustMetadata } from "./trust";
import { createEvidence } from "./evidence";
import { buildCitations } from "./citations";
import type { RetrieveRelevantKnowledgeResult } from "./retrieval";

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `brain-citations-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Citations Test Org", slug: `brain-citations-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: ownerId, role: "owner" });
  createdOrgIds.push(org.id);
  return org.id;
}

async function grantCapability(organizationId: string, domain: KnowledgeDomain, granteeUserId: string, capability: BrainCapability): Promise<void> {
  await db.insert(brainPermissionGrants).values({ organizationId, domain, workspaceId: null, granteeUserId, capability });
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

describe("buildCitations", () => {
  it("produces exactly one citation per trace node — no additions, no omissions", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantCapability(orgId, "identity", ownerId, "draft_write");
    await grantCapability(orgId, "identity", ownerId, "read");
    const a = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "A", content: "content a", actorUserId: ownerId });
    const b = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "B", content: "content b", actorUserId: ownerId });

    const trace: RetrieveRelevantKnowledgeResult = {
      nodes: [
        { item: a, source: "keyword", rank: 0.5, depth: 0 },
        { item: b, source: "graph", rank: null, depth: 1 },
      ],
    };

    const result = await buildCitations(db, { organizationId: orgId, trace, actorUserId: ownerId });
    expect(result.citations).toHaveLength(2);
    expect(result.citations.map((c) => c.itemId).sort()).toEqual([a.id, b.id].sort());
  });

  it("returns no citations for an empty trace", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const result = await buildCitations(db, { organizationId: orgId, trace: { nodes: [] }, actorUserId: ownerId });
    expect(result.citations).toHaveLength(0);
    expect(result.gaps).toHaveLength(0);
  });

  it("records an explicit gap for unknown trust and for a missing source, never silently omitting the citation itself", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantCapability(orgId, "identity", ownerId, "draft_write");
    await grantCapability(orgId, "identity", ownerId, "read");
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "Unassessed", content: "content", actorUserId: ownerId });

    const trace: RetrieveRelevantKnowledgeResult = { nodes: [{ item, source: "keyword", rank: 1, depth: 0 }] };
    const result = await buildCitations(db, { organizationId: orgId, trace, actorUserId: ownerId });

    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].trustTier).toBe("unknown");
    expect(result.citations[0].source).toBeNull();
    expect(result.gaps).toEqual(
      expect.arrayContaining([
        { itemId: item.id, reason: "unknown_trust" },
        { itemId: item.id, reason: "no_source_recorded" },
      ])
    );
  });

  it("includes real evidence and source-hierarchy rank once assessed, with no gap recorded", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantCapability(orgId, "identity", ownerId, "draft_write");
    await grantCapability(orgId, "identity", ownerId, "read");
    await grantCapability(orgId, "identity", ownerId, "approve");
    await grantCapability(orgId, "identity", ownerId, "edit_own_draft");
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "Assessed", content: "content", actorUserId: ownerId });
    await attachTrustMetadata(db, { organizationId: orgId, knowledgeItemId: item.id, versionNumber: 1, trustTier: "verified", expectedRevision: 0, sourceType: "founder_decision", actorUserId: ownerId });
    await createEvidence(db, { organizationId: orgId, knowledgeItemId: item.id, versionNumber: 1, evidenceClass: "primary", description: "a signed document", evidenceTrustTier: "verified", actorUserId: ownerId });

    const trace: RetrieveRelevantKnowledgeResult = { nodes: [{ item, source: "keyword", rank: 1, depth: 0 }] };
    const result = await buildCitations(db, { organizationId: orgId, trace, actorUserId: ownerId });

    expect(result.gaps).toHaveLength(0);
    const citation = result.citations[0];
    expect(citation.trustTier).toBe("verified");
    expect(citation.source).toMatchObject({ sourceType: "founder_decision" });
    expect(citation.source!.rank).toBe(1);
    expect(citation.evidence).toHaveLength(1);
    expect(citation.evidence[0].description).toBe("a signed document");
  });

  it("passes assumptions through unchanged, never merging them into the evidence list", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantCapability(orgId, "identity", ownerId, "draft_write");
    await grantCapability(orgId, "identity", ownerId, "read");
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    const trace: RetrieveRelevantKnowledgeResult = { nodes: [{ item, source: "keyword", rank: 1, depth: 0 }] };
    const result = await buildCitations(db, {
      organizationId: orgId,
      trace,
      assumptions: [{ description: "assumed this policy still applies to the enterprise tier" }],
      actorUserId: ownerId,
    });

    expect(result.assumptions).toEqual([{ description: "assumed this policy still applies to the enterprise tier" }]);
    expect(result.citations[0].evidence).toHaveLength(0);
    // The assumption text must never appear inside any evidence entry.
    for (const citation of result.citations) {
      for (const evidence of citation.evidence) {
        expect(evidence.description).not.toContain("enterprise tier");
      }
    }
  });
});
