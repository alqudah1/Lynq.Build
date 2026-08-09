import { describe, it, expect, afterEach } from "vitest";
import { neon } from "@neondatabase/serverless";
import { sql, eq } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, workspaces, workspaceMemberships, knowledgeItems, knowledgeItemEvidence, auditLogs, brainPermissionGrants } from "@/db/schema";
import { TenantResourceNotFoundError, InsufficientRoleError } from "@/lib/authz/errors";
import { KnowledgeItemArchivedViolationError } from "./errors";
import type { BrainCapability } from "./authz";
import type { KnowledgeDomain } from "./knowledge-items";
import { createKnowledgeItem, archiveKnowledgeItem } from "./knowledge-items";
import { createEvidence, listEvidenceForVersion } from "./evidence";

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `brain-evidence-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Evidence Test Org", slug: `brain-evidence-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
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

/** read + draft_write + edit_own_draft + archive — the full set evidence.ts's own operations ever check. */
async function grantAllCapabilities(organizationId: string, domain: KnowledgeDomain, workspaceId: string | null, granteeUserId: string): Promise<void> {
  const capabilities: BrainCapability[] = ["read", "draft_write", "edit_own_draft", "archive"];
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

describe("createEvidence", () => {
  it("adds evidence to a version for an authorized actor", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    const evidence = await createEvidence(db, {
      organizationId: orgId,
      knowledgeItemId: item.id,
      versionNumber: 1,
      evidenceClass: "primary",
      description: "A signed contract confirming this fact",
      evidenceTrustTier: "verified",
      actorUserId: ownerId,
    });

    expect(evidence.evidenceClass).toBe("primary");
    expect(evidence.evidenceTrustTier).toBe("verified");
    expect(evidence.isStale).toBe(false);
  });

  it("accepts every one of the five evidence classes", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    const classes = ["primary", "supporting", "weak", "historical", "conflicting"] as const;

    for (const evidenceClass of classes) {
      const evidence = await createEvidence(db, {
        organizationId: orgId,
        knowledgeItemId: item.id,
        versionNumber: 1,
        evidenceClass,
        description: `evidence of class ${evidenceClass}`,
        evidenceTrustTier: "hypothesis",
        actorUserId: ownerId,
      });
      expect(evidence.evidenceClass).toBe(evidenceClass);
    }
  });

  it("evidence is append-only — multiple rows accumulate for the same version, none overwritten", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    await createEvidence(db, { organizationId: orgId, knowledgeItemId: item.id, versionNumber: 1, evidenceClass: "primary", description: "first", evidenceTrustTier: "verified", actorUserId: ownerId });
    await createEvidence(db, { organizationId: orgId, knowledgeItemId: item.id, versionNumber: 1, evidenceClass: "supporting", description: "second", evidenceTrustTier: "approved", actorUserId: ownerId });

    const rows = await db.select().from(knowledgeItemEvidence).where(eq(knowledgeItemEvidence.knowledgeItemId, item.id));
    expect(rows).toHaveLength(2);
    const descriptions = rows.map((r) => r.description).sort();
    expect(descriptions).toEqual(["first", "second"]);
  });

  it("a plain organization viewer can read but cannot create evidence — not the author, not owner/admin", async () => {
    const ownerId = await makeUser();
    const viewerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    await addOrgMember(orgId, viewerId, "viewer");
    // viewerId can read (proving the rejection below is specifically about missing edit authority) but has no edit_own_draft/edit_any_draft grant.
    await grantCapability(orgId, "identity", null, viewerId, "read");
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    await expect(
      createEvidence(db, { organizationId: orgId, knowledgeItemId: item.id, versionNumber: 1, evidenceClass: "primary", description: "x", evidenceTrustTier: "verified", actorUserId: viewerId })
    ).rejects.toBeInstanceOf(InsufficientRoleError);
  });

  it("a workspace member CAN create evidence (ordinary content-edit authority, lower bar than trust approval)", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    await addOrgMember(orgId, memberId, "member");
    const workspaceId = await makeWorkspace(orgId);
    await addWorkspaceMember(workspaceId, memberId, "member");
    await grantAllCapabilities(orgId, "execution", workspaceId, memberId);
    const item = await create({ organizationId: orgId, workspaceId, domain: "execution", classification: "note", title: "t", content: "c", actorUserId: memberId });

    const evidence = await createEvidence(db, {
      organizationId: orgId,
      knowledgeItemId: item.id,
      versionNumber: 1,
      evidenceClass: "weak",
      description: "an informal mention",
      evidenceTrustTier: "hypothesis",
      actorUserId: memberId,
    });
    expect(evidence.id).toBeTruthy();
  });

  it("a workspace viewer cannot create evidence", async () => {
    const ownerId = await makeUser();
    const authorId = await makeUser();
    const viewerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    await addOrgMember(orgId, authorId, "member");
    await addOrgMember(orgId, viewerId, "member");
    const workspaceId = await makeWorkspace(orgId);
    await addWorkspaceMember(workspaceId, authorId, "member");
    await addWorkspaceMember(workspaceId, viewerId, "viewer");
    await grantAllCapabilities(orgId, "execution", workspaceId, authorId);
    // viewerId can read (proving the rejection below is specifically about missing edit authority) but has no edit_own_draft/edit_any_draft grant.
    await grantCapability(orgId, "execution", workspaceId, viewerId, "read");
    const item = await create({ organizationId: orgId, workspaceId, domain: "execution", classification: "note", title: "t", content: "c", actorUserId: authorId });

    await expect(
      createEvidence(db, { organizationId: orgId, knowledgeItemId: item.id, versionNumber: 1, evidenceClass: "weak", description: "x", evidenceTrustTier: "hypothesis", actorUserId: viewerId })
    ).rejects.toBeInstanceOf(InsufficientRoleError);
  });

  it("rejects evidence attached to an archived item", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    await archiveKnowledgeItem(db, { organizationId: orgId, knowledgeItemId: item.id, actorUserId: ownerId, expectedVersionNumber: 1 });

    await expect(
      createEvidence(db, { organizationId: orgId, knowledgeItemId: item.id, versionNumber: 1, evidenceClass: "primary", description: "x", evidenceTrustTier: "verified", actorUserId: ownerId })
    ).rejects.toBeInstanceOf(KnowledgeItemArchivedViolationError);
  });

  it("rejects evidence pointing outside tenant boundaries (cross-tenant version resolution)", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    const otherOwnerId = await makeUser();
    const otherOrgId = await makeOrgWithOwner(otherOwnerId);

    await expect(
      createEvidence(db, { organizationId: otherOrgId, knowledgeItemId: item.id, versionNumber: 1, evidenceClass: "primary", description: "x", evidenceTrustTier: "verified", actorUserId: otherOwnerId })
    ).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });
});

describe("database-level enforcement", () => {
  it("rejects an invalid evidence_class at the database level, bypassing application validation", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    await expect(
      db.execute(sql`INSERT INTO knowledge_item_evidence (id, organization_id, knowledge_item_id, knowledge_item_version_id, evidence_class, description, evidence_trust_tier, created_at, updated_at)
                      SELECT gen_random_uuid(), ${orgId}, ${item.id}, kiv.id, 'not-a-real-class', 'x', 'verified', now(), now()
                      FROM knowledge_item_versions kiv WHERE kiv.knowledge_item_id = ${item.id}`)
    ).rejects.toThrow();
  });

  it("rejects a cross-organization evidence row at the database level, bypassing the service layer", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    const otherOwnerId = await makeUser();
    const otherOrgId = await makeOrgWithOwner(otherOwnerId);

    await expect(
      db.execute(sql`INSERT INTO knowledge_item_evidence (id, organization_id, knowledge_item_id, knowledge_item_version_id, evidence_class, description, evidence_trust_tier, created_at, updated_at)
                      SELECT gen_random_uuid(), ${otherOrgId}, ${item.id}, kiv.id, 'primary', 'x', 'verified', now(), now()
                      FROM knowledge_item_versions kiv WHERE kiv.knowledge_item_id = ${item.id}`)
    ).rejects.toThrow();
  });
});

describe("listEvidenceForVersion", () => {
  it("bounds pagination — limit is capped, and nextCursor is returned when more rows exist", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    for (let i = 0; i < 5; i++) {
      await createEvidence(db, { organizationId: orgId, knowledgeItemId: item.id, versionNumber: 1, evidenceClass: "supporting", description: `evidence-${i}`, evidenceTrustTier: "observed", actorUserId: ownerId });
    }

    const firstPage = await listEvidenceForVersion(db, { organizationId: orgId, knowledgeItemId: item.id, versionNumber: 1, actorUserId: ownerId, limit: 2 });
    expect(firstPage.evidence).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await listEvidenceForVersion(db, {
      organizationId: orgId,
      knowledgeItemId: item.id,
      versionNumber: 1,
      actorUserId: ownerId,
      limit: 2,
      cursor: firstPage.nextCursor,
    });
    expect(secondPage.evidence).toHaveLength(2);
    expect(secondPage.evidence[0].id).not.toBe(firstPage.evidence[0].id);
  });

  it("returns 404-equivalent for a cross-tenant version", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    const otherOwnerId = await makeUser();
    const otherOrgId = await makeOrgWithOwner(otherOwnerId);
    await expect(listEvidenceForVersion(db, { organizationId: otherOrgId, knowledgeItemId: item.id, versionNumber: 1, actorUserId: otherOwnerId })).rejects.toBeInstanceOf(
      TenantResourceNotFoundError
    );
  });
});

describe("audit events", () => {
  it("records knowledge_evidence_created without leaking description or externalReference", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const secretDescription = "SECRET_EVIDENCE_DESCRIPTION_MARKER";
    const secretReference = "SECRET_EXTERNAL_REFERENCE_MARKER";
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    await createEvidence(db, {
      organizationId: orgId,
      knowledgeItemId: item.id,
      versionNumber: 1,
      evidenceClass: "primary",
      description: secretDescription,
      externalReference: secretReference,
      evidenceTrustTier: "verified",
      actorUserId: ownerId,
    });

    const events = await db.select().from(auditLogs).where(sql`${auditLogs.organizationId} = ${orgId} and ${auditLogs.eventType} = 'knowledge_evidence_created'`);
    expect(events).toHaveLength(1);
    for (const row of events) {
      const serialized = JSON.stringify(row.metadata);
      expect(serialized).not.toContain(secretDescription);
      expect(serialized).not.toContain(secretReference);
    }
  });
});

describe("structural checks", () => {
  it("there is no update or delete path for evidence anywhere in this module", async () => {
    const evidenceModule = await import("./evidence");
    expect((evidenceModule as Record<string, unknown>).updateEvidence).toBeUndefined();
    expect((evidenceModule as Record<string, unknown>).deleteEvidence).toBeUndefined();

    const route = await import(
      "@/app/api/organizations/[organizationId]/knowledge/[knowledgeItemId]/versions/[versionNumber]/evidence/route"
    );
    expect((route as Record<string, unknown>).PATCH).toBeUndefined();
    expect((route as Record<string, unknown>).DELETE).toBeUndefined();
  });
});
