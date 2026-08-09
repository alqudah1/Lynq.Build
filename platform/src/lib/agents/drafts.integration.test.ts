import { describe, it, expect, afterEach } from "vitest";
import { neon } from "@neondatabase/serverless";
import { sql, eq } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, agents, agentVersions, knowledgeItems, brainPermissionGrants, auditLogs } from "@/db/schema";
import { registerAgent } from "./agents";
import { createBrainPermissionGrant } from "@/lib/brain/permissions";
import { createDraftKnowledgeItemAsAgent } from "./drafts";
import { InsufficientRoleError } from "@/lib/authz/errors";
import type { AgentPrincipal } from "./authentication";

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `agent-draft-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Agent Draft Test Org", slug: `agent-draft-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: ownerId, role: "owner" });
  createdOrgIds.push(org.id);
  return org.id;
}

async function makeAgent(orgId: string, ownerId: string) {
  return registerAgent(db, {
    organizationId: orgId,
    humanOwnerUserId: ownerId,
    actorUserId: ownerId,
    name: "Draft Test Agent",
    department: "engineering",
    purpose: "Exercise the agent draft ceiling in tests",
    responsibilities: "None — test fixture only",
    goals: "N/A",
    inputs: "N/A",
    outputs: "N/A",
    successCriteria: "N/A",
    failureCriteria: "N/A",
    retirementCriteria: "Deleted when the test finishes",
    permissionLevel: "assistant",
  });
}

function principalFor(agent: Awaited<ReturnType<typeof makeAgent>>, orgId: string): AgentPrincipal {
  return { principalType: "agent", agentId: agent.id, organizationId: orgId, permissionLevel: agent.permissionLevel, department: agent.department };
}

async function grantOwnerReadAndDraftWrite(orgId: string, ownerId: string) {
  await db.insert(brainPermissionGrants).values([
    { organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, granteeType: "human", capability: "draft_write" },
    { organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, granteeType: "human", capability: "read" },
  ]);
}

async function grantAgentDraftWrite(orgId: string, ownerId: string, agentId: string) {
  await createBrainPermissionGrant(db, { organizationId: orgId, domain: "identity", grantee: { type: "agent", agentId }, capability: "draft_write", actorUserId: ownerId });
}

afterEach(async () => {
  while (createdOrgIds.length > 0) {
    const id = createdOrgIds.pop()!;
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

describe("createDraftKnowledgeItemAsAgent", () => {
  it("denies an agent with no draft_write grant", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);

    await expect(
      createDraftKnowledgeItemAsAgent(db, rawSql, principalFor(agent, orgId), { domain: "identity", classification: "fact", title: "t", content: "c" })
    ).rejects.toBeInstanceOf(InsufficientRoleError);
  });

  it("succeeds with a draft_write grant, recording real agent attribution end to end", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    await grantOwnerReadAndDraftWrite(orgId, ownerId);
    await grantAgentDraftWrite(orgId, ownerId, agent.id);

    const item = await createDraftKnowledgeItemAsAgent(db, rawSql, principalFor(agent, orgId), {
      domain: "identity",
      classification: "fact",
      title: "Agent-authored fact",
      content: "content written by an agent",
    });

    expect(item.status).toBe("draft");
    expect(item.authorUserId).toBeNull();
    expect(item.authorAgentId).toBe(agent.id);
    expect(item.authorType).toBe("agent");

    // Verify the real row, not just the returned object.
    const [row] = await db.select().from(knowledgeItems).where(eq(knowledgeItems.id, item.id));
    expect(row.authorUserId).toBeNull();
    expect(row.authorAgentId).toBe(agent.id);
    expect(row.authorType).toBe("agent");

    const auditRows = await db.select().from(auditLogs).where(sql`${auditLogs.organizationId} = ${orgId} AND ${auditLogs.eventType} = 'knowledge_item_created' AND ${auditLogs.actorAgentId} = ${agent.id}`);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].actorUserId).toBeNull();
  });

  it("agent permission level alone (even a high one) does not substitute for the draft_write grant", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await registerAgent(db, {
      organizationId: orgId,
      humanOwnerUserId: ownerId,
      actorUserId: ownerId,
      name: "High Permission No Grant Agent",
      department: "engineering",
      purpose: "Prove permission level never substitutes for a grant",
      responsibilities: "None",
      goals: "N/A",
      inputs: "N/A",
      outputs: "N/A",
      successCriteria: "N/A",
      failureCriteria: "N/A",
      retirementCriteria: "N/A",
      permissionLevel: "executive",
    });

    await expect(
      createDraftKnowledgeItemAsAgent(db, rawSql, principalFor(agent, orgId), { domain: "identity", classification: "fact", title: "t", content: "c" })
    ).rejects.toBeInstanceOf(InsufficientRoleError);
  });
});

describe("agent draft ceiling — agents have no path to approve, publish, or self-grant permissions", () => {
  it("the agent module exposes no approve/publish/archive/purge/grant-permission function anywhere", async () => {
    const draftsModule = await import("./drafts");
    const exportedNames = Object.keys(draftsModule);
    expect(exportedNames).toEqual(["createDraftKnowledgeItemAsAgent"]);
  });

  it("createBrainPermissionGrant has no agent-actor path — its actorUserId is always a human user, never an agent id (a real agent id would fail organization-membership resolution)", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);

    // An agent id is not a user id — attempting to use one as `actorUserId`
    // fails the very first gate (organization membership resolution),
    // structurally proving an agent cannot call this function as itself.
    await expect(
      createBrainPermissionGrant(db, { organizationId: orgId, domain: "identity", grantee: { type: "agent", agentId: agent.id }, capability: "read", actorUserId: agent.id })
    ).rejects.toThrow();
  });
});

describe("human attribution remains unchanged after the Module 17 migration", () => {
  it("createKnowledgeItem (human path) still produces authorUserId set, authorAgentId null, authorType human", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantOwnerReadAndDraftWrite(orgId, ownerId);

    const { createKnowledgeItem } = await import("@/lib/brain/knowledge-items");
    const item = await createKnowledgeItem(db, rawSql, { organizationId: orgId, domain: "identity", classification: "fact", title: "human item", content: "c", actorUserId: ownerId });

    expect(item.authorUserId).toBe(ownerId);
    expect(item.authorAgentId).toBeNull();
    expect(item.authorType).toBe("human");
  });
});
