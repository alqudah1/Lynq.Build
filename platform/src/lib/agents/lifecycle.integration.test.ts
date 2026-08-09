import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, agents, agentVersions } from "@/db/schema";
import { registerAgent } from "./agents";
import { advanceAgentLifecycleStage, changeAgentPermissionLevel, retireAgent, recordAgentHealth } from "./lifecycle";
import { InvalidAgentLifecycleTransitionError, AgentAlreadyRetiredError, AgentNotLiveError } from "./errors";

const env = loadEnv();
const db = createDbClient(env);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `agent-lifecycle-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Agent Lifecycle Test Org", slug: `agent-lifecycle-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: ownerId, role: "owner" });
  createdOrgIds.push(org.id);
  return org.id;
}

async function makeAgent(orgId: string, ownerId: string) {
  return registerAgent(db, {
    organizationId: orgId,
    humanOwnerUserId: ownerId,
    actorUserId: ownerId,
    name: "Deal-Risk Reviewer",
    department: "sales_and_bizdev",
    purpose: "Flag unverified claims in outreach before they go out",
    responsibilities: "Reviews outbound drafts for unverifiable claims",
    goals: "Zero unverified claims reaching a prospect",
    inputs: "Draft outreach copy, Brain Identity + Market domains",
    outputs: "An approve/flag verdict with the specific unverified claim highlighted",
    successCriteria: "No flagged claim ever turns out true after the fact",
    failureCriteria: "A flagged-safe claim later proves false, or a real risk is missed",
    retirementCriteria: "Sales adopts a different review process, or false-negative rate exceeds threshold",
    permissionLevel: "manager",
  });
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

describe("advanceAgentLifecycleStage", () => {
  it("walks idea through approval, forcing permission level to observer at approval", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    expect(agent.permissionLevel).toBe("manager");

    await advanceAgentLifecycleStage(db, { organizationId: orgId, agentId: agent.id, toStage: "specification", actorUserId: ownerId });
    await advanceAgentLifecycleStage(db, { organizationId: orgId, agentId: agent.id, toStage: "development", actorUserId: ownerId });
    await advanceAgentLifecycleStage(db, { organizationId: orgId, agentId: agent.id, toStage: "testing", actorUserId: ownerId });
    const approved = await advanceAgentLifecycleStage(db, { organizationId: orgId, agentId: agent.id, toStage: "approval", actorUserId: ownerId });

    expect(approved.lifecycleStage).toBe("approval");
    expect(approved.permissionLevel).toBe("observer");
    expect(approved.currentVersionNumber).toBe(2);
  });

  it("rejects skipping a stage", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);

    await expect(
      advanceAgentLifecycleStage(db, { organizationId: orgId, agentId: agent.id, toStage: "development", actorUserId: ownerId })
    ).rejects.toThrow(InvalidAgentLifecycleTransitionError);
  });

  it("rejects moving backward", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    await advanceAgentLifecycleStage(db, { organizationId: orgId, agentId: agent.id, toStage: "specification", actorUserId: ownerId });
    await advanceAgentLifecycleStage(db, { organizationId: orgId, agentId: agent.id, toStage: "development", actorUserId: ownerId });

    await expect(
      advanceAgentLifecycleStage(db, { organizationId: orgId, agentId: agent.id, toStage: "specification", actorUserId: ownerId })
    ).rejects.toThrow(InvalidAgentLifecycleTransitionError);
  });
});

describe("changeAgentPermissionLevel", () => {
  it("rejects a permission change while the agent isn't live yet", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);

    await expect(
      changeAgentPermissionLevel(db, { organizationId: orgId, agentId: agent.id, newPermissionLevel: "operator", reason: "too early", actorUserId: ownerId })
    ).rejects.toThrow(AgentNotLiveError);
  });

  it("succeeds once the agent has reached deployment, recording a new version", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    await advanceAgentLifecycleStage(db, { organizationId: orgId, agentId: agent.id, toStage: "specification", actorUserId: ownerId });
    await advanceAgentLifecycleStage(db, { organizationId: orgId, agentId: agent.id, toStage: "development", actorUserId: ownerId });
    await advanceAgentLifecycleStage(db, { organizationId: orgId, agentId: agent.id, toStage: "testing", actorUserId: ownerId });
    const approved = await advanceAgentLifecycleStage(db, { organizationId: orgId, agentId: agent.id, toStage: "approval", actorUserId: ownerId });
    const deployed = await advanceAgentLifecycleStage(db, { organizationId: orgId, agentId: agent.id, toStage: "deployment", actorUserId: ownerId });
    expect(deployed.permissionLevel).toBe("observer");

    const promoted = await changeAgentPermissionLevel(db, {
      organizationId: orgId,
      agentId: agent.id,
      newPermissionLevel: "operator",
      reason: "3 months clean track record",
      actorUserId: ownerId,
    });

    expect(promoted.permissionLevel).toBe("operator");
    expect(promoted.currentVersionNumber).toBe(approved.currentVersionNumber + 1);
  });
});

describe("retireAgent", () => {
  it("retires an agent from an early stage and records the reason", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);

    const retired = await retireAgent(db, { organizationId: orgId, agentId: agent.id, reason: "plans changed before spec was written", actorUserId: ownerId });

    expect(retired.lifecycleStage).toBe("retired");
    expect(retired.retiredAt).not.toBeNull();
    expect(retired.retirementReason).toBe("plans changed before spec was written");
  });

  it("rejects retiring an already-retired agent", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    await retireAgent(db, { organizationId: orgId, agentId: agent.id, reason: "first retirement", actorUserId: ownerId });

    await expect(
      retireAgent(db, { organizationId: orgId, agentId: agent.id, reason: "second retirement", actorUserId: ownerId })
    ).rejects.toThrow(AgentAlreadyRetiredError);
  });
});

describe("recordAgentHealth", () => {
  it("updates the coarse health status", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);

    const updated = await recordAgentHealth(db, { organizationId: orgId, agentId: agent.id, healthStatus: "healthy", actorUserId: ownerId });
    expect(updated.healthStatus).toBe("healthy");
  });
});
