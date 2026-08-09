import { describe, it, expect, afterEach } from "vitest";
import { sql, eq } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, agents, agentVersions } from "@/db/schema";
import { registerAgent, getAgent, listAgents, updateAgentAnatomy } from "./agents";
import { AgentVersionConflictError } from "./errors";
import { InsufficientRoleError, TenantResourceNotFoundError } from "@/lib/authz/errors";

const env = loadEnv();
const db = createDbClient(env);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `agent-registry-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Agent Registry Test Org", slug: `agent-registry-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: ownerId, role: "owner" });
  createdOrgIds.push(org.id);
  return org.id;
}

function baseAnatomy() {
  return {
    name: "Roadmap Synthesizer",
    department: "product" as const,
    purpose: "Turn scattered feedback into prioritized themes",
    responsibilities: "Reads product feedback, clusters it, produces a ranked theme list",
    goals: "Maximize signal density per theme surfaced",
    inputs: "Feedback from Client Success and Support, Brain Identity domain",
    outputs: "A ranked theme list handed to the Product department lead",
    successCriteria: "Themes match what the Product lead independently prioritizes",
    failureCriteria: "Themes are noise, or miss a theme a human would have caught",
    retirementCriteria: "Product adopts a different synthesis process, or accuracy drops below threshold for 3 consecutive reviews",
    permissionLevel: "assistant" as const,
  };
}

afterEach(async () => {
  while (createdOrgIds.length > 0) {
    const id = createdOrgIds.pop()!;
    await db.delete(agentVersions).where(sql`${agentVersions.agentId} IN (SELECT id FROM agents WHERE organization_id = ${id})`);
    await db.delete(agents).where(sql`${agents.organizationId} = ${id}`);
    await db.delete(organizations).where(sql`${organizations.id} = ${id}`);
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await db.delete(users).where(sql`${users.id} = ${id}`);
  }
});

describe("registerAgent", () => {
  it("registers a new agent at the idea stage with a v1 agent_versions row", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);

    const agent = await registerAgent(db, { organizationId: orgId, humanOwnerUserId: ownerId, actorUserId: ownerId, ...baseAnatomy() });

    expect(agent.lifecycleStage).toBe("idea");
    expect(agent.healthStatus).toBe("unknown");
    expect(agent.currentVersionNumber).toBe(1);
    expect(agent.permissionLevel).toBe("assistant");

    const versions = await db.select().from(agentVersions).where(eq(agentVersions.agentId, agent.id));
    expect(versions).toHaveLength(1);
    expect(versions[0].versionNumber).toBe(1);
  });

  it("rejects a non-owner/admin member", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await db.insert(organizationMemberships).values({ organizationId: orgId, userId: memberId, role: "member" });

    await expect(
      registerAgent(db, { organizationId: orgId, humanOwnerUserId: ownerId, actorUserId: memberId, ...baseAnatomy() })
    ).rejects.toThrow(InsufficientRoleError);
  });

  it("rejects a human owner with no organization membership", async () => {
    const ownerId = await makeUser();
    const outsiderId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);

    await expect(
      registerAgent(db, { organizationId: orgId, humanOwnerUserId: outsiderId, actorUserId: ownerId, ...baseAnatomy() })
    ).rejects.toThrow();
  });
});

describe("getAgent / listAgents", () => {
  it("returns 404-shaped error for a cross-tenant agent id", async () => {
    const ownerId = await makeUser();
    const otherOwnerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const otherOrgId = await makeOrgWithOwner(otherOwnerId);

    const agent = await registerAgent(db, { organizationId: orgId, humanOwnerUserId: ownerId, actorUserId: ownerId, ...baseAnatomy() });

    await expect(getAgent(db, { organizationId: otherOrgId, agentId: agent.id, actorUserId: otherOwnerId })).rejects.toThrow(TenantResourceNotFoundError);
  });

  it("lists every agent registered for an organization", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);

    await registerAgent(db, { organizationId: orgId, humanOwnerUserId: ownerId, actorUserId: ownerId, ...baseAnatomy() });
    await registerAgent(db, { organizationId: orgId, humanOwnerUserId: ownerId, actorUserId: ownerId, ...baseAnatomy(), name: "Usage Analyst" });

    const result = await listAgents(db, { organizationId: orgId, actorUserId: ownerId });
    expect(result).toHaveLength(2);
  });
});

describe("updateAgentAnatomy", () => {
  it("creates a new version and updates current fields on a valid edit", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await registerAgent(db, { organizationId: orgId, humanOwnerUserId: ownerId, actorUserId: ownerId, ...baseAnatomy() });

    const updated = await updateAgentAnatomy(db, {
      organizationId: orgId,
      agentId: agent.id,
      expectedVersionNumber: 1,
      updates: { purpose: "Turn scattered feedback into prioritized, evidence-backed themes" },
      changeReason: "sharpened the purpose statement",
      actorUserId: ownerId,
    });

    expect(updated.currentVersionNumber).toBe(2);
    expect(updated.purpose).toBe("Turn scattered feedback into prioritized, evidence-backed themes");

    const versions = await db.select().from(agentVersions).where(eq(agentVersions.agentId, agent.id));
    expect(versions).toHaveLength(2);
  });

  it("rejects a stale expectedVersionNumber with AgentVersionConflictError", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await registerAgent(db, { organizationId: orgId, humanOwnerUserId: ownerId, actorUserId: ownerId, ...baseAnatomy() });

    await updateAgentAnatomy(db, { organizationId: orgId, agentId: agent.id, expectedVersionNumber: 1, updates: { goals: "Refined goal" }, actorUserId: ownerId });

    await expect(
      updateAgentAnatomy(db, { organizationId: orgId, agentId: agent.id, expectedVersionNumber: 1, updates: { goals: "Conflicting goal" }, actorUserId: ownerId })
    ).rejects.toThrow(AgentVersionConflictError);
  });
});
