import { describe, it, expect, afterEach } from "vitest";
import { neon } from "@neondatabase/serverless";
import { sql, eq } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, knowledgeItems, knowledgeItemTrust, knowledgeRelationships, auditLogs, brainPermissionGrants } from "@/db/schema";
import { InsufficientRoleError } from "@/lib/authz/errors";
import { NotADecisionItemError, KnowledgeVersionConflictError, SelfRelationshipViolationError, DuplicateRelationshipError } from "./errors";
import type { BrainCapability } from "./authz";
import { createKnowledgeItem, type KnowledgeDomain } from "./knowledge-items";
import { submitKnowledgeItemForReview, approveKnowledgeItem } from "./lifecycle";
import { attachTrustMetadata } from "./trust";
import { recordDecisionOutcome, supersedeDecision } from "./decisions";

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `brain-decisions-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Decisions Test Org", slug: `brain-decisions-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: ownerId, role: "owner" });
  createdOrgIds.push(org.id);
  return org.id;
}

async function addOrgMember(orgId: string, userId: string, role: "member" | "viewer"): Promise<void> {
  await db.insert(organizationMemberships).values({ organizationId: orgId, userId, role });
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
    await db.delete(knowledgeItemTrust).where(sql`${knowledgeItemTrust.organizationId} = ${id}`);
    await db.delete(knowledgeItems).where(sql`${knowledgeItems.organizationId} = ${id}`);
    await db.delete(auditLogs).where(sql`${auditLogs.organizationId} = ${id}`);
    await db.delete(organizations).where(sql`${organizations.id} = ${id}`);
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await db.delete(users).where(sql`${users.id} = ${id}`);
  }
});

describe("recordDecisionOutcome", () => {
  it("creates a new version and updates the outcome column, defaulting to pending beforehand", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "decision", title: "Adopt new vendor", content: "We chose vendor X", actorUserId: ownerId });
    expect(item.outcome).toBe("pending");

    const updated = await recordDecisionOutcome(db, {
      organizationId: orgId,
      knowledgeItemId: item.id,
      outcome: "succeeded",
      expectedVersionNumber: 1,
      changeReason: "vendor delivered on time and under budget",
      actorUserId: ownerId,
    });
    expect(updated.outcome).toBe("succeeded");
    expect(updated.currentVersionNumber).toBe(2);
    expect(updated.title).toBe("Adopt new vendor");

    const events = await db.select().from(auditLogs).where(sql`${auditLogs.organizationId} = ${orgId} and ${auditLogs.eventType} = 'knowledge_decision_outcome_recorded'`);
    expect(events).toHaveLength(1);
  });

  it("works on an approved (non-draft) decision — outcomes are typically only knowable after approval", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "decision", title: "t", content: "c", actorUserId: ownerId });
    await submitKnowledgeItemForReview(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId });
    await approveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId });

    const updated = await recordDecisionOutcome(db, {
      organizationId: orgId,
      knowledgeItemId: item.id,
      outcome: "mixed",
      expectedVersionNumber: 1,
      changeReason: "partially worked out",
      actorUserId: ownerId,
    });
    expect(updated.outcome).toBe("mixed");
    expect(updated.status).toBe("approved");
  });

  it("rejects a non-decision item", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    await expect(
      recordDecisionOutcome(db, { organizationId: orgId, knowledgeItemId: item.id, outcome: "succeeded", expectedVersionNumber: 1, changeReason: "x", actorUserId: ownerId })
    ).rejects.toBeInstanceOf(NotADecisionItemError);
  });

  it("rejects a stale expectedVersionNumber", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "decision", title: "t", content: "c", actorUserId: ownerId });
    await recordDecisionOutcome(db, { organizationId: orgId, knowledgeItemId: item.id, outcome: "succeeded", expectedVersionNumber: 1, changeReason: "first", actorUserId: ownerId });

    await expect(
      recordDecisionOutcome(db, { organizationId: orgId, knowledgeItemId: item.id, outcome: "failed", expectedVersionNumber: 1, changeReason: "stale", actorUserId: ownerId })
    ).rejects.toBeInstanceOf(KnowledgeVersionConflictError);
  });
});

describe("supersedeDecision", () => {
  it("creates a supersedes edge (new -> old) and steps the old decision's trust to deprecated", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", ownerId);
    const oldDecision = await create({ organizationId: orgId, domain: "identity", classification: "decision", title: "Old choice", content: "we chose A", actorUserId: ownerId });
    await attachTrustMetadata(db, { organizationId: orgId, knowledgeItemId: oldDecision.id, versionNumber: 1, trustTier: "approved", expectedRevision: 0, sourceType: "founder_decision", actorUserId: ownerId });
    const newDecision = await create({ organizationId: orgId, domain: "identity", classification: "decision", title: "New choice", content: "we now choose B instead", actorUserId: ownerId });

    const { oldItem, relationship } = await supersedeDecision(db, rawSql, { organizationId: orgId, oldDecisionItemId: oldDecision.id, newDecisionItemId: newDecision.id, actorUserId: ownerId });

    expect(relationship.sourceItemId).toBe(newDecision.id);
    expect(relationship.targetItemId).toBe(oldDecision.id);
    expect(relationship.relationshipType).toBe("supersedes");
    expect(oldItem.id).toBe(oldDecision.id);

    const [trustRow] = await db.select().from(knowledgeItemTrust).where(eq(knowledgeItemTrust.knowledgeItemId, oldDecision.id));
    expect(trustRow.trustTier).toBe("deprecated");
    expect(trustRow.revision).toBe(2);

    const relRows = await db.select().from(knowledgeRelationships).where(eq(knowledgeRelationships.sourceItemId, newDecision.id));
    expect(relRows).toHaveLength(1);
    expect(relRows[0].relationshipType).toBe("supersedes");

    const events = await db.select().from(auditLogs).where(sql`${auditLogs.organizationId} = ${orgId} and ${auditLogs.eventType} = 'knowledge_decision_superseded'`);
    expect(events).toHaveLength(1);
  });

  it("rejects a self-supersede attempt", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", ownerId);
    const decision = await create({ organizationId: orgId, domain: "identity", classification: "decision", title: "t", content: "c", actorUserId: ownerId });

    await expect(
      supersedeDecision(db, rawSql, { organizationId: orgId, oldDecisionItemId: decision.id, newDecisionItemId: decision.id, actorUserId: ownerId })
    ).rejects.toBeInstanceOf(SelfRelationshipViolationError);
  });

  it("rejects when either item is not classified as a decision", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", ownerId);
    const decision = await create({ organizationId: orgId, domain: "identity", classification: "decision", title: "t", content: "c", actorUserId: ownerId });
    const fact = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t2", content: "c2", actorUserId: ownerId });

    await expect(
      supersedeDecision(db, rawSql, { organizationId: orgId, oldDecisionItemId: decision.id, newDecisionItemId: fact.id, actorUserId: ownerId })
    ).rejects.toBeInstanceOf(NotADecisionItemError);
  });

  it("requires approve authority at the old decision's exact scope — a lower-authority actor is rejected", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, memberId, "member");
    await grantCapability(orgId, "identity", memberId, "draft_write");
    await grantCapability(orgId, "identity", memberId, "read");
    // memberId deliberately has no "approve" grant.
    await grantAllCapabilities(orgId, "identity", ownerId);
    const oldDecision = await create({ organizationId: orgId, domain: "identity", classification: "decision", title: "Old", content: "c", actorUserId: ownerId });
    const newDecision = await create({ organizationId: orgId, domain: "identity", classification: "decision", title: "New", content: "c", actorUserId: memberId });

    await expect(
      supersedeDecision(db, rawSql, { organizationId: orgId, oldDecisionItemId: oldDecision.id, newDecisionItemId: newDecision.id, actorUserId: memberId })
    ).rejects.toBeInstanceOf(InsufficientRoleError);
  });

  it("rejects a duplicate supersedes edge between the same two items", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", ownerId);
    const oldDecision = await create({ organizationId: orgId, domain: "identity", classification: "decision", title: "Old", content: "c", actorUserId: ownerId });
    const newDecision = await create({ organizationId: orgId, domain: "identity", classification: "decision", title: "New", content: "c", actorUserId: ownerId });
    await supersedeDecision(db, rawSql, { organizationId: orgId, oldDecisionItemId: oldDecision.id, newDecisionItemId: newDecision.id, actorUserId: ownerId });

    await expect(
      supersedeDecision(db, rawSql, { organizationId: orgId, oldDecisionItemId: oldDecision.id, newDecisionItemId: newDecision.id, actorUserId: ownerId })
    ).rejects.toBeInstanceOf(DuplicateRelationshipError);
  });
});
