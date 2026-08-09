import { describe, it, expect, afterEach } from "vitest";
import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, knowledgeItems, auditLogs, brainPermissionGrants } from "@/db/schema";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { createKnowledgeItem } from "./knowledge-items";
import { attachTrustMetadata } from "./trust";
import { validateSourceAssignment } from "./source-hierarchy";

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `brain-source-hierarchy-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Source Hierarchy Test Org", slug: `brain-source-hierarchy-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: ownerId, role: "owner" });
  createdOrgIds.push(org.id);
  return org.id;
}

async function create(input: Parameters<typeof createKnowledgeItem>[2]) {
  return createKnowledgeItem(db, rawSql, input);
}

async function grantAllCapabilities(organizationId: string, granteeUserId: string): Promise<void> {
  for (const capability of ["read", "draft_write", "approve"] as const) {
    await db.insert(brainPermissionGrants).values({ organizationId, domain: "identity", workspaceId: null, granteeUserId, capability });
  }
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

describe("validateSourceAssignment", () => {
  it("returns isValid: false, never a 404, when no source has been recorded yet", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    const result = await validateSourceAssignment(db, orgId, item.id, 1, ownerId);
    expect(result.isValid).toBe(false);
    expect(result.sourceType).toBeNull();
    expect(result.rank).toBeNull();
    expect(result.reason).toBeTruthy();
  });

  it("returns the correct rank for a recorded source", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    await attachTrustMetadata(db, { organizationId: orgId, knowledgeItemId: item.id, versionNumber: 1, trustTier: "approved", expectedRevision: 0, sourceType: "client_approved", actorUserId: ownerId });

    const result = await validateSourceAssignment(db, orgId, item.id, 1, ownerId);
    expect(result.isValid).toBe(true);
    expect(result.sourceType).toBe("client_approved");
    expect(result.rank).toBe(3);
  });

  it("returns 404-equivalent for a cross-tenant version", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    const otherOwnerId = await makeUser();
    const otherOrgId = await makeOrgWithOwner(otherOwnerId);
    await expect(validateSourceAssignment(db, otherOrgId, item.id, 1, otherOwnerId)).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });
});
