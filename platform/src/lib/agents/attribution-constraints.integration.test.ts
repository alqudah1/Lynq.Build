import { describe, it, expect, afterEach } from "vitest";
import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, agents, agentVersions, knowledgeItems, knowledgeItemVersions, brainPermissionGrants, auditLogs } from "@/db/schema";
import { registerAgent } from "./agents";

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `attribution-constraint-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Attribution Constraint Test Org", slug: `attribution-constraint-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: ownerId, role: "owner" });
  createdOrgIds.push(org.id);
  return org.id;
}

async function makeAgent(orgId: string, ownerId: string) {
  return registerAgent(db, {
    organizationId: orgId,
    humanOwnerUserId: ownerId,
    actorUserId: ownerId,
    name: "Constraint Test Agent",
    department: "engineering",
    purpose: "Exercise DB constraints in tests",
    responsibilities: "None — test fixture only",
    goals: "N/A",
    inputs: "N/A",
    outputs: "N/A",
    successCriteria: "N/A",
    failureCriteria: "N/A",
    retirementCriteria: "Deleted when the test finishes",
    permissionLevel: "observer",
  });
}

afterEach(async () => {
  while (createdOrgIds.length > 0) {
    const id = createdOrgIds.pop()!;
    await db.delete(knowledgeItemVersions).where(sql`${knowledgeItemVersions.knowledgeItemId} IN (SELECT id FROM knowledge_items WHERE organization_id = ${id})`);
    await db.delete(knowledgeItems).where(sql`${knowledgeItems.organizationId} = ${id}`);
    await db.delete(brainPermissionGrants).where(sql`${brainPermissionGrants.organizationId} = ${id}`);
    await db.delete(auditLogs).where(sql`${auditLogs.organizationId} = ${id}`);
    await db.delete(agentVersions).where(sql`${agentVersions.agentId} IN (SELECT id FROM agents WHERE organization_id = ${id})`);
    await db.delete(agents).where(sql`${agents.organizationId} = ${id}`);
    await db.delete(organizations).where(sql`${organizations.id} = ${id}`);
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await db.delete(users).where(sql`${users.id} = ${id}`);
  }
});

describe("brain_permission_grants_exactly_one_grantee_check", () => {
  it("rejects a grant with both grantee_user_id and grantee_agent_id set", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);

    await expect(
      rawSql`INSERT INTO brain_permission_grants (id, organization_id, domain, grantee_user_id, grantee_agent_id, grantee_type, capability)
             VALUES (gen_random_uuid(), ${orgId}, 'identity', ${ownerId}, ${agent.id}, 'human', 'read')`
    ).rejects.toThrow();
  });

  it("rejects a grant with neither grantee set", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);

    await expect(
      rawSql`INSERT INTO brain_permission_grants (id, organization_id, domain, grantee_type, capability)
             VALUES (gen_random_uuid(), ${orgId}, 'identity', 'human', 'read')`
    ).rejects.toThrow();
  });

  it("accepts a grant with only grantee_agent_id set", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);

    const rows = await rawSql`INSERT INTO brain_permission_grants (id, organization_id, domain, grantee_agent_id, grantee_type, capability)
             VALUES (gen_random_uuid(), ${orgId}, 'identity', ${agent.id}, 'agent', 'read') RETURNING id`;
    expect(rows).toHaveLength(1);
  });
});

describe("knowledge_items_at_most_one_author_check", () => {
  it("rejects an item with both author_user_id and author_agent_id set", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);

    await expect(
      rawSql`INSERT INTO knowledge_items (id, organization_id, domain, status, author_user_id, author_agent_id, author_type)
             VALUES (gen_random_uuid(), ${orgId}, 'identity', 'draft', ${ownerId}, ${agent.id}, 'human')`
    ).rejects.toThrow();
  });

  it("accepts an item with neither author set (a tombstoned/legacy row)", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);

    const rows = await rawSql`INSERT INTO knowledge_items (id, organization_id, domain, status)
             VALUES (gen_random_uuid(), ${orgId}, 'identity', 'draft') RETURNING id`;
    expect(rows).toHaveLength(1);
  });
});

describe("knowledge_item_versions_at_most_one_creator_check", () => {
  it("rejects a version with both created_by_user_id and created_by_agent_id set", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    const [item] = await rawSql`INSERT INTO knowledge_items (id, organization_id, domain, status) VALUES (gen_random_uuid(), ${orgId}, 'identity', 'draft') RETURNING id`;

    await expect(
      rawSql`INSERT INTO knowledge_item_versions (id, knowledge_item_id, version_number, title, content, classification, created_by_user_id, created_by_agent_id)
             VALUES (gen_random_uuid(), ${item.id}, 1, 't', 'c', 'fact', ${ownerId}, ${agent.id})`
    ).rejects.toThrow();
  });
});

describe("audit_logs_at_most_one_actor_check", () => {
  it("rejects an audit row with both actor_user_id and actor_agent_id set", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);

    await expect(
      rawSql`INSERT INTO audit_logs (id, organization_id, actor_user_id, actor_agent_id, event_type)
             VALUES (gen_random_uuid(), ${orgId}, ${ownerId}, ${agent.id}, 'agent_brain_read')`
    ).rejects.toThrow();
  });

  it("accepts an audit row with only actor_agent_id set", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);

    const rows = await rawSql`INSERT INTO audit_logs (id, organization_id, actor_agent_id, actor_type, event_type)
             VALUES (gen_random_uuid(), ${orgId}, ${agent.id}, 'agent', 'agent_brain_read') RETURNING id`;
    expect(rows).toHaveLength(1);
  });
});

describe("agents_id_org_unique / cross-tenant composite FKs", () => {
  it("rejects a grant naming an agent that belongs to a DIFFERENT organization than the grant itself", async () => {
    const ownerId = await makeUser();
    const otherOwnerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const otherOrgId = await makeOrgWithOwner(otherOwnerId);
    const foreignAgent = await makeAgent(otherOrgId, otherOwnerId);

    await expect(
      rawSql`INSERT INTO brain_permission_grants (id, organization_id, domain, grantee_agent_id, grantee_type, capability)
             VALUES (gen_random_uuid(), ${orgId}, 'identity', ${foreignAgent.id}, 'agent', 'read')`
    ).rejects.toThrow();
  });
});
