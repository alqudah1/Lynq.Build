import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, agents, agentVersions, knowledgeItems, brainPermissionGrants, auditLogs, rateLimitCounters } from "@/db/schema";
import { registerAgent } from "@/lib/agents/agents";
import { issueAgentCredential } from "@/lib/agents/credentials";
import { createBrainPermissionGrant } from "@/lib/brain/permissions";
import { AGENT_BRAIN_READ_RATE_LIMIT } from "@/lib/agents/rate-limits";

import { GET as LIST_KNOWLEDGE, POST as CREATE_DRAFT } from "./route";
import { GET as GET_KNOWLEDGE_ITEM } from "./[knowledgeItemId]/route";
import { GET as LIST_VERSIONS } from "./[knowledgeItemId]/versions/route";
import { GET as LIST_RELATIONSHIPS } from "./[knowledgeItemId]/relationships/route";
import { GET as GET_CONTEXT } from "./[knowledgeItemId]/versions/[versionNumber]/context/route";

const env = loadEnv();
const db = createDbClient(env);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `agent-brain-route-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Agent Brain Route Test Org", slug: `agent-brain-route-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: ownerId, role: "owner" });
  createdOrgIds.push(org.id);
  return org.id;
}

async function makeAgentWithCredential(orgId: string, ownerId: string) {
  const agent = await registerAgent(db, {
    organizationId: orgId,
    humanOwnerUserId: ownerId,
    actorUserId: ownerId,
    name: "Route Test Agent",
    department: "engineering",
    purpose: "Exercise agent brain routes end to end",
    responsibilities: "None — test fixture only",
    goals: "N/A",
    inputs: "N/A",
    outputs: "N/A",
    successCriteria: "N/A",
    failureCriteria: "N/A",
    retirementCriteria: "Deleted when the test finishes",
    permissionLevel: "assistant",
  });
  const { plaintextSecret } = await issueAgentCredential(db, { organizationId: orgId, agentId: agent.id, actorUserId: ownerId });
  return { agent, secret: plaintextSecret };
}

function authedRequest(url: string, secret: string, init: RequestInit = {}): Request {
  return new Request(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${secret}` } });
}

async function grantOrgWide(orgId: string, ownerId: string, agentId: string, capability: "read" | "draft_write") {
  await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, granteeType: "human", capability });
  await createBrainPermissionGrant(db, { organizationId: orgId, domain: "identity", grantee: { type: "agent", agentId }, capability, actorUserId: ownerId });
}

afterEach(async () => {
  await db.delete(rateLimitCounters).where(sql`${rateLimitCounters.key} LIKE 'agent-brain:%'`);
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

describe("agent brain read/write routes", () => {
  it("rejects every route with 401 when unauthenticated", async () => {
    const listRes = await LIST_KNOWLEDGE(new Request("https://platform.example.com/api/agent/brain/knowledge"));
    expect(listRes.status).toBe(401);

    const getRes = await GET_KNOWLEDGE_ITEM(new Request("https://platform.example.com/x"), { params: Promise.resolve({ knowledgeItemId: crypto.randomUUID() }) });
    expect(getRes.status).toBe(401);
  });

  it("full flow: register agent, grant read + draft_write, create a draft via the route, list it, get it, list its versions, get its citation-ready context", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { agent, secret } = await makeAgentWithCredential(orgId, ownerId);
    await grantOrgWide(orgId, ownerId, agent.id, "draft_write");
    await grantOrgWide(orgId, ownerId, agent.id, "read");

    const createRes = await CREATE_DRAFT(
      authedRequest("https://platform.example.com/api/agent/brain/knowledge", secret, {
        method: "POST",
        body: JSON.stringify({ domain: "identity", classification: "fact", title: "Agent draft", content: "written by an agent" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()).data;
    expect(created.authorAgentId).toBe(agent.id);
    expect(created.authorUserId).toBeNull();

    const listRes = await LIST_KNOWLEDGE(authedRequest("https://platform.example.com/api/agent/brain/knowledge", secret));
    expect(listRes.status).toBe(200);
    expect((await listRes.json()).data.items).toHaveLength(1);

    const getRes = await GET_KNOWLEDGE_ITEM(authedRequest("https://platform.example.com/x", secret), { params: Promise.resolve({ knowledgeItemId: created.id }) });
    expect(getRes.status).toBe(200);

    const versionsRes = await LIST_VERSIONS(authedRequest("https://platform.example.com/x", secret), { params: Promise.resolve({ knowledgeItemId: created.id }) });
    expect(versionsRes.status).toBe(200);
    expect((await versionsRes.json()).data.versions).toHaveLength(1);

    const relationshipsRes = await LIST_RELATIONSHIPS(authedRequest("https://platform.example.com/x", secret), { params: Promise.resolve({ knowledgeItemId: created.id }) });
    expect(relationshipsRes.status).toBe(200);

    const contextRes = await GET_CONTEXT(authedRequest("https://platform.example.com/x", secret), { params: Promise.resolve({ knowledgeItemId: created.id, versionNumber: "1" }) });
    expect(contextRes.status).toBe(200);
    const context = (await contextRes.json()).data;
    expect(context.title).toBe("Agent draft");
    expect(context.versionNumber).toBe(1);
  });

  it("returns 403 (not 401/404) when the agent lacks draft_write but the credential itself is valid", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { secret } = await makeAgentWithCredential(orgId, ownerId);

    const createRes = await CREATE_DRAFT(
      authedRequest("https://platform.example.com/api/agent/brain/knowledge", secret, {
        method: "POST",
        body: JSON.stringify({ domain: "identity", classification: "fact", title: "t", content: "c" }),
      })
    );
    expect(createRes.status).toBe(403);
  });

  it("returns 401 for a bogus bearer token, never leaking whether an agent with that prefix exists", async () => {
    const res = await LIST_KNOWLEDGE(authedRequest("https://platform.example.com/api/agent/brain/knowledge", "agt_definitely-not-a-real-secret"));
    expect(res.status).toBe(401);
  });

  it("rate limit applies: exceeding the read budget for one endpoint class returns 429", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { agent, secret } = await makeAgentWithCredential(orgId, ownerId);
    await grantOrgWide(orgId, ownerId, agent.id, "read");

    // Pre-fill the counter to exactly the limit so the NEXT request is the one that exceeds it — avoids firing `AGENT_BRAIN_READ_RATE_LIMIT.limit` real requests in a test.
    await db.insert(rateLimitCounters).values({ key: `agent-brain:list:agent:${agent.id}:org:${orgId}`, count: AGENT_BRAIN_READ_RATE_LIMIT.limit, windowStart: new Date() });

    const res = await LIST_KNOWLEDGE(authedRequest("https://platform.example.com/api/agent/brain/knowledge", secret));
    expect(res.status).toBe(429);

    const rateLimitedAudit = await db.select().from(auditLogs).where(sql`${auditLogs.organizationId} = ${orgId} AND ${auditLogs.eventType} = 'agent_brain_rate_limited'`);
    expect(rateLimitedAudit.length).toBeGreaterThan(0);
  });
});
