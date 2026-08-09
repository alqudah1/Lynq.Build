import { describe, it, expect, afterEach } from "vitest";
import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, knowledgeItems, knowledgeRelationships, knowledgeItemTrust, auditLogs, brainPermissionGrants } from "@/db/schema";
import { createKnowledgeItem, updateKnowledgeItem, archiveKnowledgeItem } from "./knowledge-items";
import { createRelationship, archiveRelationship } from "./relationships";
import { attachTrustMetadata } from "./trust";
import { createEvidence } from "./evidence";
import { restoreKnowledgeItemVersion } from "./knowledge-item-versions";
import {
  submitKnowledgeItemForReview,
  sendKnowledgeItemBackToDraft,
  approveKnowledgeItem,
  publishKnowledgeItem,
  restoreKnowledgeItem,
  retireKnowledgeItem,
} from "./lifecycle";
import { bootstrapBrainPermissions, createBrainPermissionGrant, updateBrainPermissionGrant, revokeBrainPermissionGrant } from "./permissions";
import { supersedeDecision, recordDecisionOutcome } from "./decisions";

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `brain-audit-sweep-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Audit Sweep Org", slug: `brain-audit-sweep-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: ownerId, role: "owner" });
  createdOrgIds.push(org.id);
  return org.id;
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
    await db.delete(brainPermissionGrants).where(sql`${brainPermissionGrants.organizationId} = ${id}`);
    await db.delete(auditLogs).where(sql`${auditLogs.organizationId} = ${id}`);
    await db.delete(organizations).where(sql`${organizations.id} = ${id}`);
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await db.delete(users).where(sql`${users.id} = ${id}`);
  }
});

/**
 * Module 15's own required completeness sweep — "a test proving every
 * mutating function built in #1–#9 produces exactly one corresponding
 * audit event," extended here to every later Brain module too (#3.1, #13,
 * #14). A single connected walkthrough, not isolated spot checks per
 * module — the value is proving the FULL set of expected success events
 * really does accumulate across one realistic sequence of operations, with
 * nothing silently missing.
 */
describe("audit completeness sweep across Brain Modules 1-14", () => {
  it("produces every expected mutation-success audit event type at least once", async () => {
    const ownerId = await makeUser();
    const granteeId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await db.insert(organizationMemberships).values({ organizationId: orgId, userId: granteeId, role: "member" });

    // Module 7: bootstrap + grant lifecycle.
    await bootstrapBrainPermissions(db, { organizationId: orgId, actorUserId: ownerId });
    const grant = await createBrainPermissionGrant(db, { organizationId: orgId, domain: "identity", grantee: { type: "human", userId: granteeId }, capability: "read", actorUserId: ownerId });
    await updateBrainPermissionGrant(db, { organizationId: orgId, grantId: grant.id, reason: "onboarding", expectedRevision: 1, actorUserId: ownerId });
    await revokeBrainPermissionGrant(db, { organizationId: orgId, grantId: grant.id, actorUserId: ownerId });

    // Module 1/2: item creation, update, version restore.
    const itemA = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "A v1", content: "content v1", actorUserId: ownerId });
    await updateKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: itemA.id, actorUserId: ownerId, expectedVersionNumber: 1, updates: { title: "A v2" } });
    await restoreKnowledgeItemVersion(db, { organizationId: orgId, knowledgeItemId: itemA.id, sourceVersionNumber: 1, expectedVersionNumber: 2, changeReason: "revert to v1", actorUserId: ownerId });

    // Module 3: relationships.
    const itemB = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "B", content: "content b", actorUserId: ownerId });
    const relationship = await createRelationship(db, { organizationId: orgId, sourceItemId: itemA.id, targetItemId: itemB.id, relationshipType: "related_to", actorUserId: ownerId });
    await archiveRelationship(db, { organizationId: orgId, relationshipId: relationship.id, actorUserId: ownerId });

    // Module 4: trust + source + evidence.
    await attachTrustMetadata(db, { organizationId: orgId, knowledgeItemId: itemA.id, versionNumber: 3, trustTier: "hypothesis", expectedRevision: 0, sourceType: "meeting_notes", actorUserId: ownerId });
    await createEvidence(db, { organizationId: orgId, knowledgeItemId: itemA.id, versionNumber: 3, evidenceClass: "supporting", description: "a supporting note", evidenceTrustTier: "hypothesis", actorUserId: ownerId });

    // Modules 8/9: full lifecycle walk.
    await submitKnowledgeItemForReview(db, { organizationId: orgId, knowledgeItemId: itemA.id, actorUserId: ownerId });
    await sendKnowledgeItemBackToDraft(db, { organizationId: orgId, knowledgeItemId: itemA.id, actorUserId: ownerId });
    await submitKnowledgeItemForReview(db, { organizationId: orgId, knowledgeItemId: itemA.id, actorUserId: ownerId });
    await approveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: itemA.id, actorUserId: ownerId });
    await publishKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: itemA.id, actorUserId: ownerId });
    await archiveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: itemA.id, actorUserId: ownerId, expectedVersionNumber: 3 });
    await restoreKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: itemA.id, actorUserId: ownerId });
    await retireKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: itemA.id, reason: "superseded by later work", actorUserId: ownerId });

    // Module 14: decisions.
    const oldDecision = await create({ organizationId: orgId, domain: "identity", classification: "decision", title: "Old decision", content: "we chose X", actorUserId: ownerId });
    const newDecision = await create({ organizationId: orgId, domain: "identity", classification: "decision", title: "New decision", content: "we now choose Y", actorUserId: ownerId });
    await supersedeDecision(db, rawSql, { organizationId: orgId, oldDecisionItemId: oldDecision.id, newDecisionItemId: newDecision.id, actorUserId: ownerId });
    await recordDecisionOutcome(db, { organizationId: orgId, knowledgeItemId: newDecision.id, outcome: "succeeded", expectedVersionNumber: 1, changeReason: "worked out well", actorUserId: ownerId });

    const rows = await db.select({ eventType: auditLogs.eventType }).from(auditLogs).where(sql`${auditLogs.organizationId} = ${orgId}`);
    const observed = new Set(rows.map((r) => r.eventType));

    const expectedSuccessEvents = [
      "brain_permission_bootstrapped",
      "brain_permission_granted",
      "brain_permission_updated",
      "brain_permission_revoked",
      "knowledge_item_created",
      "knowledge_version_created",
      "knowledge_version_restored",
      "knowledge_relationship_created",
      "knowledge_relationship_archived",
      "knowledge_source_recorded",
      "knowledge_trust_assessed",
      "knowledge_evidence_created",
      "knowledge_item_submitted_for_review",
      "knowledge_item_sent_back_to_draft",
      "knowledge_item_approved",
      "knowledge_item_published",
      "knowledge_item_archived",
      "knowledge_item_restored",
      "knowledge_item_retired",
      "knowledge_decision_superseded",
      "knowledge_decision_outcome_recorded",
    ];

    const missing = expectedSuccessEvents.filter((e) => !observed.has(e));
    expect(missing).toEqual([]);
  });
});
