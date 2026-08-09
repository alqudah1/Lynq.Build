import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, agents, agentVersions, agentCredentials } from "@/db/schema";
import { registerAgent } from "./agents";
import { issueAgentCredential, listAgentCredentials, revokeAgentCredential, verifyAgentCredential } from "./credentials";
import { AgentCredentialAlreadyRevokedError } from "./errors";

const env = loadEnv();
const db = createDbClient(env);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `agent-credential-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Agent Credential Test Org", slug: `agent-credential-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: ownerId, role: "owner" });
  createdOrgIds.push(org.id);
  return org.id;
}

async function makeAgent(orgId: string, ownerId: string) {
  return registerAgent(db, {
    organizationId: orgId,
    humanOwnerUserId: ownerId,
    actorUserId: ownerId,
    name: "Credential Test Agent",
    department: "engineering",
    purpose: "Exercise credential issuance in tests",
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
    await db.delete(agentCredentials).where(sql`${agentCredentials.agentId} IN (SELECT id FROM agents WHERE organization_id = ${id})`);
    await db.delete(agentVersions).where(sql`${agentVersions.agentId} IN (SELECT id FROM agents WHERE organization_id = ${id})`);
    await db.delete(agents).where(sql`${agents.organizationId} = ${id}`);
    await db.delete(organizations).where(sql`${organizations.id} = ${id}`);
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await db.delete(users).where(sql`${users.id} = ${id}`);
  }
});

describe("issueAgentCredential / verifyAgentCredential", () => {
  it("issues a credential and verifies the plaintext secret against its hash", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);

    const { credential, plaintextSecret } = await issueAgentCredential(db, { organizationId: orgId, agentId: agent.id, actorUserId: ownerId });
    expect(plaintextSecret.startsWith("agt_")).toBe(true);
    expect(credential.keyPrefix).toBe(plaintextSecret.slice(0, 12));

    const verified = await verifyAgentCredential(db, plaintextSecret);
    expect(verified?.id).toBe(credential.id);
    expect(verified?.lastUsedAt).not.toBeNull();
  });

  it("fails verification for a wrong secret", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    await issueAgentCredential(db, { organizationId: orgId, agentId: agent.id, actorUserId: ownerId });

    const verified = await verifyAgentCredential(db, "agt_not-the-real-secret");
    expect(verified).toBeNull();
  });
});

describe("revokeAgentCredential", () => {
  it("revokes a credential, after which verification fails", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    const { credential, plaintextSecret } = await issueAgentCredential(db, { organizationId: orgId, agentId: agent.id, actorUserId: ownerId });

    await revokeAgentCredential(db, { organizationId: orgId, agentId: agent.id, credentialId: credential.id, actorUserId: ownerId });

    const verified = await verifyAgentCredential(db, plaintextSecret);
    expect(verified).toBeNull();
  });

  it("rejects revoking an already-revoked credential", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    const { credential } = await issueAgentCredential(db, { organizationId: orgId, agentId: agent.id, actorUserId: ownerId });
    await revokeAgentCredential(db, { organizationId: orgId, agentId: agent.id, credentialId: credential.id, actorUserId: ownerId });

    await expect(
      revokeAgentCredential(db, { organizationId: orgId, agentId: agent.id, credentialId: credential.id, actorUserId: ownerId })
    ).rejects.toThrow(AgentCredentialAlreadyRevokedError);
  });
});

describe("listAgentCredentials", () => {
  it("lists issued credentials without exposing any secret", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    await issueAgentCredential(db, { organizationId: orgId, agentId: agent.id, actorUserId: ownerId });
    await issueAgentCredential(db, { organizationId: orgId, agentId: agent.id, actorUserId: ownerId });

    const list = await listAgentCredentials(db, { organizationId: orgId, agentId: agent.id, actorUserId: ownerId });
    expect(list).toHaveLength(2);
    for (const c of list) {
      expect((c as unknown as Record<string, unknown>).secretHash).toBeUndefined();
    }
  });
});
