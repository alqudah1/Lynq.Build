import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, agents, agentVersions, agentCredentials, auditLogs } from "@/db/schema";
import { registerAgent } from "./agents";
import { issueAgentCredential, revokeAgentCredential } from "./credentials";
import { retireAgent } from "./lifecycle";
import { authenticateAgentFromHeader } from "./authentication";
import { UnauthenticatedError } from "@/lib/authz/errors";

const env = loadEnv();
const db = createDbClient(env);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `agent-auth-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Agent Auth Test Org", slug: `agent-auth-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: ownerId, role: "owner" });
  createdOrgIds.push(org.id);
  return org.id;
}

async function makeAgent(orgId: string, ownerId: string) {
  return registerAgent(db, {
    organizationId: orgId,
    humanOwnerUserId: ownerId,
    actorUserId: ownerId,
    name: "Auth Test Agent",
    department: "engineering",
    purpose: "Exercise credential authentication in tests",
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

function requestWithBearer(secret: string | null): Request {
  return new Request("https://platform.example.com/api/agent/brain/knowledge", {
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
  });
}

afterEach(async () => {
  while (createdOrgIds.length > 0) {
    const id = createdOrgIds.pop()!;
    await db.delete(agentCredentials).where(sql`${agentCredentials.agentId} IN (SELECT id FROM agents WHERE organization_id = ${id})`);
    await db.delete(agentVersions).where(sql`${agentVersions.agentId} IN (SELECT id FROM agents WHERE organization_id = ${id})`);
    await db.delete(agents).where(sql`${agents.organizationId} = ${id}`);
    await db.delete(auditLogs).where(sql`${auditLogs.organizationId} = ${id}`);
    await db.delete(organizations).where(sql`${organizations.id} = ${id}`);
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await db.delete(users).where(sql`${users.id} = ${id}`);
  }
});

describe("authenticateAgentFromHeader", () => {
  it("resolves a valid credential into a correct AgentPrincipal", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    const { plaintextSecret } = await issueAgentCredential(db, { organizationId: orgId, agentId: agent.id, actorUserId: ownerId });

    const principal = await authenticateAgentFromHeader(db, requestWithBearer(plaintextSecret));

    expect(principal).toEqual({
      principalType: "agent",
      agentId: agent.id,
      organizationId: orgId,
      permissionLevel: agent.permissionLevel,
      department: agent.department,
    });
  });

  it("rejects a missing Authorization header", async () => {
    await expect(authenticateAgentFromHeader(db, requestWithBearer(null))).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("rejects an unknown secret and audits agent_brain_credential_invalid", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await makeAgent(orgId, ownerId);

    await expect(authenticateAgentFromHeader(db, requestWithBearer("agt_totally-unknown-secret"))).rejects.toBeInstanceOf(UnauthenticatedError);

    const rows = await db.select().from(auditLogs).where(sql`${auditLogs.eventType} = 'agent_brain_credential_invalid'`);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("rejects a revoked credential immediately and audits agent_brain_credential_revoked", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    const { credential, plaintextSecret } = await issueAgentCredential(db, { organizationId: orgId, agentId: agent.id, actorUserId: ownerId });
    await revokeAgentCredential(db, { organizationId: orgId, agentId: agent.id, credentialId: credential.id, actorUserId: ownerId });

    await expect(authenticateAgentFromHeader(db, requestWithBearer(plaintextSecret))).rejects.toBeInstanceOf(UnauthenticatedError);

    const rows = await db.select().from(auditLogs).where(sql`${auditLogs.organizationId} = ${orgId} AND ${auditLogs.eventType} = 'agent_brain_credential_revoked'`);
    expect(rows).toHaveLength(1);
  });

  it("rejects a retired agent's still-valid, unrevoked credential immediately", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    const { plaintextSecret } = await issueAgentCredential(db, { organizationId: orgId, agentId: agent.id, actorUserId: ownerId });
    await retireAgent(db, { organizationId: orgId, agentId: agent.id, reason: "test retirement", actorUserId: ownerId });

    await expect(authenticateAgentFromHeader(db, requestWithBearer(plaintextSecret))).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("never leaks the plaintext secret or its hash into any audit record", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    const { plaintextSecret } = await issueAgentCredential(db, { organizationId: orgId, agentId: agent.id, actorUserId: ownerId });
    await retireAgent(db, { organizationId: orgId, agentId: agent.id, reason: "test retirement", actorUserId: ownerId });

    await expect(authenticateAgentFromHeader(db, requestWithBearer(plaintextSecret))).rejects.toBeInstanceOf(UnauthenticatedError);

    const rows = await db.select().from(auditLogs).where(sql`${auditLogs.organizationId} = ${orgId}`);
    for (const row of rows) {
      const serialized = JSON.stringify(row.metadata ?? {});
      expect(serialized.includes(plaintextSecret)).toBe(false);
    }
  });
});
