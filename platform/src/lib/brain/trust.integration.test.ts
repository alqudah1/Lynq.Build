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
  knowledgeItemSources,
  knowledgeItemTrust,
  auditLogs,
  brainPermissionGrants,
} from "@/db/schema";
import { TenantResourceNotFoundError, InsufficientRoleError } from "@/lib/authz/errors";
import { TrustAssessmentConflictError, SourceImmutableViolationError, KnowledgeItemArchivedViolationError } from "./errors";
import type { BrainCapability } from "./authz";
import type { KnowledgeDomain } from "./knowledge-items";
import { createKnowledgeItem, archiveKnowledgeItem } from "./knowledge-items";
import { getTrustAssessmentForVersion, attachTrustMetadata } from "./trust";

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `brain-trust-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Trust Test Org", slug: `brain-trust-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
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

/** read + draft_write + approve — the full set trust.ts's own operations ever check. */
async function grantAllCapabilities(organizationId: string, domain: KnowledgeDomain, workspaceId: string | null, granteeUserId: string): Promise<void> {
  const capabilities: BrainCapability[] = ["read", "draft_write", "approve"];
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

describe("getTrustAssessmentForVersion", () => {
  it("synthesizes an unknown/unassessed view when no row has ever been recorded", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    const view = await getTrustAssessmentForVersion(db, orgId, item.id, 1, ownerId);
    expect(view.trust.trustTier).toBe("unknown");
    expect(view.trust.revision).toBe(0);
    expect(view.trust.assessedAt).toBeNull();
    expect(view.source).toBeNull();
  });

  it("returns 404-equivalent for a cross-tenant version", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    const otherOwnerId = await makeUser();
    const otherOrgId = await makeOrgWithOwner(otherOwnerId);
    await expect(getTrustAssessmentForVersion(db, otherOrgId, item.id, 1, otherOwnerId)).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });
});

describe("attachTrustMetadata", () => {
  it("an organization owner can attach trust metadata on the first call", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    const view = await attachTrustMetadata(db, {
      organizationId: orgId,
      knowledgeItemId: item.id,
      versionNumber: 1,
      trustTier: "approved",
      expectedRevision: 0,
      sourceType: "founder_decision",
      sourceDetail: "2026 planning meeting",
      actorUserId: ownerId,
    });

    expect(view.trust.trustTier).toBe("approved");
    expect(view.trust.revision).toBe(1);
    expect(view.source?.sourceType).toBe("founder_decision");
    expect(view.source?.sourceDetail).toBe("2026 planning meeting");
  });

  it("an actor holding an explicit approve grant can attach trust metadata — organization admin role alone is never sufficient", async () => {
    const ownerId = await makeUser();
    const adminId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    await addOrgMember(orgId, adminId, "admin");
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    // adminId can read (so the rejection below proves insufficient APPROVE authority specifically) but has no approve grant yet.
    await grantCapability(orgId, "identity", null, adminId, "read");

    // The admin role alone is not enough — without an explicit approve grant, the admin is rejected.
    await expect(
      attachTrustMetadata(db, { organizationId: orgId, knowledgeItemId: item.id, versionNumber: 1, trustTier: "verified", expectedRevision: 0, sourceType: "client_approved", actorUserId: adminId })
    ).rejects.toBeInstanceOf(InsufficientRoleError);

    // With an explicit approve grant added, the admin (or anyone else) can attach trust metadata.
    await grantCapability(orgId, "identity", null, adminId, "approve");

    const view = await attachTrustMetadata(db, {
      organizationId: orgId,
      knowledgeItemId: item.id,
      versionNumber: 1,
      trustTier: "verified",
      expectedRevision: 0,
      sourceType: "client_approved",
      actorUserId: adminId,
    });
    expect(view.trust.trustTier).toBe("verified");
  });

  it("a plain organization member cannot attach trust metadata — approve authority is stricter than ordinary edit authority", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    await addOrgMember(orgId, memberId, "member");
    // memberId can create (draft_write) and read its own item, but holds no approve grant.
    await grantCapability(orgId, "identity", null, memberId, "draft_write");
    await grantCapability(orgId, "identity", null, memberId, "read");
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: memberId });

    await expect(
      attachTrustMetadata(db, {
        organizationId: orgId,
        knowledgeItemId: item.id,
        versionNumber: 1,
        trustTier: "approved",
        expectedRevision: 0,
        sourceType: "internal_documentation",
        actorUserId: memberId,
      })
    ).rejects.toBeInstanceOf(InsufficientRoleError);
  });

  it("an actor with ordinary edit authority in a workspace, but no approve grant, cannot attach trust metadata to a workspace-scoped item there", async () => {
    const ownerId = await makeUser();
    const managerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    await addOrgMember(orgId, managerId, "member");
    const workspaceId = await makeWorkspace(orgId);
    await addWorkspaceMember(workspaceId, managerId, "manager");
    await grantCapability(orgId, "execution", workspaceId, managerId, "draft_write");
    await grantCapability(orgId, "execution", workspaceId, managerId, "read");
    const item = await create({ organizationId: orgId, workspaceId, domain: "execution", classification: "note", title: "t", content: "c", actorUserId: managerId });

    await expect(
      attachTrustMetadata(db, {
        organizationId: orgId,
        knowledgeItemId: item.id,
        versionNumber: 1,
        trustTier: "approved",
        expectedRevision: 0,
        sourceType: "internal_documentation",
        actorUserId: managerId,
      })
    ).rejects.toBeInstanceOf(InsufficientRoleError);
  });

  it("an organization owner without explicit workspace membership cannot reach a workspace-scoped item's trust at all (workspace isolation preserved)", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    await addOrgMember(orgId, memberId, "member");
    const workspaceId = await makeWorkspace(orgId);
    await addWorkspaceMember(workspaceId, memberId, "member");
    await grantCapability(orgId, "execution", workspaceId, memberId, "draft_write");
    const item = await create({ organizationId: orgId, workspaceId, domain: "execution", classification: "note", title: "t", content: "c", actorUserId: memberId });

    await expect(
      attachTrustMetadata(db, {
        organizationId: orgId,
        knowledgeItemId: item.id,
        versionNumber: 1,
        trustTier: "approved",
        expectedRevision: 0,
        sourceType: "internal_documentation",
        actorUserId: ownerId,
      })
    ).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });

  it("an organization owner WITH explicit workspace membership AND explicit read+approve grants can attach trust metadata to a workspace-scoped item", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    await addOrgMember(orgId, memberId, "member");
    const workspaceId = await makeWorkspace(orgId);
    await addWorkspaceMember(workspaceId, memberId, "member");
    await addWorkspaceMember(workspaceId, ownerId, "viewer");
    await grantCapability(orgId, "execution", workspaceId, memberId, "draft_write");
    await grantCapability(orgId, "execution", workspaceId, ownerId, "read");
    await grantCapability(orgId, "execution", workspaceId, ownerId, "approve");
    const item = await create({ organizationId: orgId, workspaceId, domain: "execution", classification: "note", title: "t", content: "c", actorUserId: memberId });

    const view = await attachTrustMetadata(db, {
      organizationId: orgId,
      knowledgeItemId: item.id,
      versionNumber: 1,
      trustTier: "observed",
      expectedRevision: 0,
      sourceType: "meeting_notes",
      actorUserId: ownerId,
    });
    expect(view.trust.trustTier).toBe("observed");
  });

  it("reassessing with the correct expectedRevision succeeds and advances the revision", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    await attachTrustMetadata(db, { organizationId: orgId, knowledgeItemId: item.id, versionNumber: 1, trustTier: "hypothesis", expectedRevision: 0, sourceType: "ai_generated_draft", actorUserId: ownerId });

    const reassessed = await attachTrustMetadata(db, {
      organizationId: orgId,
      knowledgeItemId: item.id,
      versionNumber: 1,
      trustTier: "approved",
      expectedRevision: 1,
      sourceType: "ai_generated_draft",
      actorUserId: ownerId,
    });
    expect(reassessed.trust.trustTier).toBe("approved");
    expect(reassessed.trust.revision).toBe(2);
  });

  it("rejects a stale expectedRevision, never silently overwriting", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    await attachTrustMetadata(db, { organizationId: orgId, knowledgeItemId: item.id, versionNumber: 1, trustTier: "hypothesis", expectedRevision: 0, sourceType: "ai_generated_draft", actorUserId: ownerId });
    await attachTrustMetadata(db, { organizationId: orgId, knowledgeItemId: item.id, versionNumber: 1, trustTier: "approved", expectedRevision: 1, sourceType: "ai_generated_draft", actorUserId: ownerId });

    await expect(
      attachTrustMetadata(db, {
        organizationId: orgId,
        knowledgeItemId: item.id,
        versionNumber: 1,
        trustTier: "verified",
        expectedRevision: 1, // stale — current is now 2
        sourceType: "ai_generated_draft",
        actorUserId: ownerId,
      })
    ).rejects.toBeInstanceOf(TrustAssessmentConflictError);

    const current = await getTrustAssessmentForVersion(db, orgId, item.id, 1, ownerId);
    expect(current.trust.trustTier).toBe("approved");
    expect(current.trust.revision).toBe(2);
  });

  it("rejects a sourceType that differs from what's already recorded — source is immutable", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    await attachTrustMetadata(db, { organizationId: orgId, knowledgeItemId: item.id, versionNumber: 1, trustTier: "hypothesis", expectedRevision: 0, sourceType: "meeting_notes", actorUserId: ownerId });

    await expect(
      attachTrustMetadata(db, {
        organizationId: orgId,
        knowledgeItemId: item.id,
        versionNumber: 1,
        trustTier: "approved",
        expectedRevision: 1,
        sourceType: "founder_decision", // different from the recorded "meeting_notes"
        actorUserId: ownerId,
      })
    ).rejects.toBeInstanceOf(SourceImmutableViolationError);

    const rows = await db.select().from(knowledgeItemSources).where(eq(knowledgeItemSources.knowledgeItemId, item.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceType).toBe("meeting_notes");
  });

  it("restating the identical sourceType on a later call succeeds without creating a second source row", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    await attachTrustMetadata(db, { organizationId: orgId, knowledgeItemId: item.id, versionNumber: 1, trustTier: "hypothesis", expectedRevision: 0, sourceType: "meeting_notes", actorUserId: ownerId });
    await attachTrustMetadata(db, { organizationId: orgId, knowledgeItemId: item.id, versionNumber: 1, trustTier: "approved", expectedRevision: 1, sourceType: "meeting_notes", actorUserId: ownerId });

    const rows = await db.select().from(knowledgeItemSources).where(eq(knowledgeItemSources.knowledgeItemId, item.id));
    expect(rows).toHaveLength(1);
  });

  it("rejects attaching trust metadata to an archived item", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    await grantCapability(orgId, "identity", null, ownerId, "archive");
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    await archiveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1 });

    await expect(
      attachTrustMetadata(db, {
        organizationId: orgId,
        knowledgeItemId: item.id,
        versionNumber: 1,
        trustTier: "approved",
        expectedRevision: 0,
        sourceType: "internal_documentation",
        actorUserId: ownerId,
      })
    ).rejects.toBeInstanceOf(KnowledgeItemArchivedViolationError);
  });

  it("of two concurrent first-attach attempts, exactly one succeeds and one is rejected as a conflict", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    const results = await Promise.allSettled([
      attachTrustMetadata(db, { organizationId: orgId, knowledgeItemId: item.id, versionNumber: 1, trustTier: "approved", expectedRevision: 0, sourceType: "founder_decision", actorUserId: ownerId }),
      attachTrustMetadata(db, { organizationId: orgId, knowledgeItemId: item.id, versionNumber: 1, trustTier: "observed", expectedRevision: 0, sourceType: "founder_decision", actorUserId: ownerId }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(TrustAssessmentConflictError);

    const rows = await db.select().from(knowledgeItemTrust).where(eq(knowledgeItemTrust.knowledgeItemId, item.id));
    expect(rows).toHaveLength(1);
  });

  it("of two concurrent reassess attempts against the same expectedRevision, exactly one succeeds and one is rejected", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    await attachTrustMetadata(db, { organizationId: orgId, knowledgeItemId: item.id, versionNumber: 1, trustTier: "hypothesis", expectedRevision: 0, sourceType: "founder_decision", actorUserId: ownerId });

    const results = await Promise.allSettled([
      attachTrustMetadata(db, { organizationId: orgId, knowledgeItemId: item.id, versionNumber: 1, trustTier: "approved", expectedRevision: 1, sourceType: "founder_decision", actorUserId: ownerId }),
      attachTrustMetadata(db, { organizationId: orgId, knowledgeItemId: item.id, versionNumber: 1, trustTier: "observed", expectedRevision: 1, sourceType: "founder_decision", actorUserId: ownerId }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(TrustAssessmentConflictError);
  });
});

describe("database-level enforcement", () => {
  it("rejects an invalid trust_tier at the database level, bypassing application validation", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    await expect(
      db.execute(sql`INSERT INTO knowledge_item_trust (id, organization_id, knowledge_item_id, knowledge_item_version_id, trust_tier, revision, created_at, updated_at)
                      SELECT gen_random_uuid(), ${orgId}, ${item.id}, kiv.id, 'not-a-real-tier', 1, now(), now()
                      FROM knowledge_item_versions kiv WHERE kiv.knowledge_item_id = ${item.id}`)
    ).rejects.toThrow();
  });

  it("rejects an invalid source_type at the database level, bypassing application validation", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    await expect(
      db.execute(sql`INSERT INTO knowledge_item_sources (id, organization_id, knowledge_item_id, knowledge_item_version_id, source_type, created_at)
                      SELECT gen_random_uuid(), ${orgId}, ${item.id}, kiv.id, 'not-a-real-source', now()
                      FROM knowledge_item_versions kiv WHERE kiv.knowledge_item_id = ${item.id}`)
    ).rejects.toThrow();
  });

  it("rejects a cross-organization trust row at the database level, bypassing the service layer", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    const otherOwnerId = await makeUser();
    const otherOrgId = await makeOrgWithOwner(otherOwnerId);

    await expect(
      db.execute(sql`INSERT INTO knowledge_item_trust (id, organization_id, knowledge_item_id, knowledge_item_version_id, trust_tier, revision, created_at, updated_at)
                      SELECT gen_random_uuid(), ${otherOrgId}, ${item.id}, kiv.id, 'approved', 1, now(), now()
                      FROM knowledge_item_versions kiv WHERE kiv.knowledge_item_id = ${item.id}`)
    ).rejects.toThrow();
  });
});

describe("audit events", () => {
  it("records knowledge_source_recorded exactly once and knowledge_trust_assessed on every assessment, never leaking sourceDetail", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const secretDetail = "SECRET_SOURCE_DETAIL_MARKER";
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    await attachTrustMetadata(db, { organizationId: orgId, knowledgeItemId: item.id, versionNumber: 1, trustTier: "hypothesis", expectedRevision: 0, sourceType: "meeting_notes", sourceDetail: secretDetail, actorUserId: ownerId });
    await attachTrustMetadata(db, { organizationId: orgId, knowledgeItemId: item.id, versionNumber: 1, trustTier: "approved", expectedRevision: 1, sourceType: "meeting_notes", sourceDetail: secretDetail, actorUserId: ownerId });

    const sourceEvents = await db.select().from(auditLogs).where(sql`${auditLogs.organizationId} = ${orgId} and ${auditLogs.eventType} = 'knowledge_source_recorded'`);
    expect(sourceEvents).toHaveLength(1);

    const trustEvents = await db.select().from(auditLogs).where(sql`${auditLogs.organizationId} = ${orgId} and ${auditLogs.eventType} = 'knowledge_trust_assessed'`);
    expect(trustEvents).toHaveLength(2);

    const allRows = await db.select().from(auditLogs).where(eq(auditLogs.organizationId, orgId));
    for (const row of allRows) {
      expect(JSON.stringify(row.metadata)).not.toContain(secretDetail);
    }
  });

  it("a stale reassess writes knowledge_trust_conflict, never a misleading knowledge_trust_assessed", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    await attachTrustMetadata(db, { organizationId: orgId, knowledgeItemId: item.id, versionNumber: 1, trustTier: "hypothesis", expectedRevision: 0, sourceType: "meeting_notes", actorUserId: ownerId });

    await expect(
      attachTrustMetadata(db, { organizationId: orgId, knowledgeItemId: item.id, versionNumber: 1, trustTier: "approved", expectedRevision: 0, sourceType: "meeting_notes", actorUserId: ownerId })
    ).rejects.toBeInstanceOf(TrustAssessmentConflictError);

    const assessedEvents = await db.select().from(auditLogs).where(sql`${auditLogs.organizationId} = ${orgId} and ${auditLogs.eventType} = 'knowledge_trust_assessed'`);
    expect(assessedEvents).toHaveLength(1); // only the original successful attach

    const conflictEvents = await db.select().from(auditLogs).where(sql`${auditLogs.organizationId} = ${orgId} and ${auditLogs.eventType} = 'knowledge_trust_conflict'`);
    expect(conflictEvents).toHaveLength(1);
  });
});
