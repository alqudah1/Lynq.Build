import { describe, it, expect, afterEach } from "vitest";
import { db, makeUser, makeOrgWithOwner, makeAgent, grantAgentCapability, cleanupAgentRuntimeTestData } from "./test-helpers";
import { createExecution } from "./executions";
import { assignExecution, startExecution, advanceExecution, failExecution } from "./lifecycle";
import { delegateExecution, checkDelegationResult } from "./delegation";
import { DelegationCycleError, DelegationDepthExceededError, DelegatorLacksCapabilityError } from "./errors";

afterEach(cleanupAgentRuntimeTestData);

async function makeExecutingExecution(orgId: string, ownerId: string, agentId: string) {
  const execution = await createExecution(db, {
    organizationId: orgId,
    ownerUserId: ownerId,
    goal: "Coordinate a multi-step deliverable",
    successCriteria: "All subtasks complete",
    failureCriteria: "Any subtask fails without recovery",
    domainsRequested: ["identity"],
    actorUserId: ownerId,
  });
  await assignExecution(db, { organizationId: orgId, executionId: execution.id, assignedAgentId: agentId, actorUserId: ownerId });
  await startExecution(db, { organizationId: orgId, executionId: execution.id, actorUserId: ownerId });
  await advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "planning", actorAgentId: agentId });
  await advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "reasoning", actorAgentId: agentId });
  return advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "executing", actorAgentId: agentId });
}

describe("delegateExecution", () => {
  it("creates a real, first-class child execution and moves the parent to waiting", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const parentAgent = await makeAgent(orgId, ownerId);
    const childAgent = await makeAgent(orgId, ownerId);
    await grantAgentCapability(orgId, ownerId, parentAgent.id, "identity", "read");
    const parentExecuting = await makeExecutingExecution(orgId, ownerId, parentAgent.id);

    const { delegation, child, parent } = await delegateExecution(db, {
      organizationId: orgId,
      parentExecutionId: parentExecuting.id,
      delegateAgentId: childAgent.id,
      goal: "Design the visual asset",
      successCriteria: "Asset delivered",
      failureCriteria: "No asset delivered",
      domainsRequested: ["identity"],
      actorAgentId: parentAgent.id,
    });

    expect(child.parentExecutionId).toBe(parentExecuting.id);
    expect(child.rootExecutionId).toBe(parentExecuting.rootExecutionId);
    expect(child.delegationDepth).toBe(1);
    expect(child.assignedAgentId).toBe(childAgent.id);
    expect(child.status).toBe("assigned");
    expect(parent.status).toBe("waiting");
    expect(delegation.depth).toBe(1);
  });

  it("does not transfer permissions — the child independently needs its own grant for a gated action", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const parentAgent = await makeAgent(orgId, ownerId);
    const childAgent = await makeAgent(orgId, ownerId);
    // Parent holds read (required to delegate at all) but the CHILD is
    // never granted draft_write.
    await grantAgentCapability(orgId, ownerId, parentAgent.id, "identity", "read");
    const parentExecuting = await makeExecutingExecution(orgId, ownerId, parentAgent.id);

    const { child } = await delegateExecution(db, {
      organizationId: orgId,
      parentExecutionId: parentExecuting.id,
      delegateAgentId: childAgent.id,
      goal: "Write a draft",
      successCriteria: "Draft exists",
      failureCriteria: "No draft",
      domainsRequested: ["identity"],
      actorAgentId: parentAgent.id,
    });

    const { createDraftKnowledgeItemAsAgent } = await import("@/lib/agents/drafts");
    const { rawSql } = await import("./test-helpers");
    const childPrincipal = { principalType: "agent" as const, agentId: childAgent.id, organizationId: orgId, permissionLevel: childAgent.permissionLevel, department: childAgent.department };

    await expect(createDraftKnowledgeItemAsAgent(db, rawSql, childPrincipal, { domain: "identity", classification: "fact", title: "t", content: "c" })).rejects.toThrow();
    expect(child.assignedAgentId).toBe(childAgent.id);
  });

  it("rejects delegation when the delegating agent itself lacks read on a requested domain", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const parentAgent = await makeAgent(orgId, ownerId);
    const childAgent = await makeAgent(orgId, ownerId);
    const parentExecuting = await makeExecutingExecution(orgId, ownerId, parentAgent.id);

    await expect(
      delegateExecution(db, {
        organizationId: orgId,
        parentExecutionId: parentExecuting.id,
        delegateAgentId: childAgent.id,
        goal: "g",
        successCriteria: "s",
        failureCriteria: "f",
        domainsRequested: ["identity"],
        actorAgentId: parentAgent.id,
      })
    ).rejects.toBeInstanceOf(DelegatorLacksCapabilityError);
  });

  it("rejects a delegation cycle — delegating back to an agent already in the ancestry", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agentA = await makeAgent(orgId, ownerId);
    const agentB = await makeAgent(orgId, ownerId);
    await grantAgentCapability(orgId, ownerId, agentA.id, "identity", "read");
    await grantAgentCapability(orgId, ownerId, agentB.id, "identity", "read");

    const rootExecuting = await makeExecutingExecution(orgId, ownerId, agentA.id);
    const { child: childExecution } = await delegateExecution(db, {
      organizationId: orgId,
      parentExecutionId: rootExecuting.id,
      delegateAgentId: agentB.id,
      goal: "g",
      successCriteria: "s",
      failureCriteria: "f",
      domainsRequested: ["identity"],
      actorAgentId: agentA.id,
    });

    // childExecution is assigned to agentB but not yet executing — advance it so it can delegate too.
    await startExecution(db, { organizationId: orgId, executionId: childExecution.id, actorUserId: ownerId });
    await advanceExecution(db, { organizationId: orgId, executionId: childExecution.id, toStatus: "planning", actorAgentId: agentB.id });
    await advanceExecution(db, { organizationId: orgId, executionId: childExecution.id, toStatus: "reasoning", actorAgentId: agentB.id });
    const childExecuting = await advanceExecution(db, { organizationId: orgId, executionId: childExecution.id, toStatus: "executing", actorAgentId: agentB.id });

    // agentB attempting to delegate BACK to agentA (already in the ancestry) must be rejected.
    await expect(
      delegateExecution(db, {
        organizationId: orgId,
        parentExecutionId: childExecuting.id,
        delegateAgentId: agentA.id,
        goal: "g2",
        successCriteria: "s2",
        failureCriteria: "f2",
        domainsRequested: ["identity"],
        actorAgentId: agentB.id,
      })
    ).rejects.toBeInstanceOf(DelegationCycleError);
  });

  it("bounds delegation depth", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);

    // Build a chain of 6 agents, delegating one after another; depth 6 must exceed the max of 5.
    const chainAgents = await Promise.all(Array.from({ length: 7 }, () => makeAgent(orgId, ownerId)));
    for (const agent of chainAgents) {
      await grantAgentCapability(orgId, ownerId, agent.id, "identity", "read");
    }

    let currentExecuting = await makeExecutingExecution(orgId, ownerId, chainAgents[0].id);

    for (let i = 1; i < 6; i++) {
      const { child } = await delegateExecution(db, {
        organizationId: orgId,
        parentExecutionId: currentExecuting.id,
        delegateAgentId: chainAgents[i].id,
        goal: `g${i}`,
        successCriteria: "s",
        failureCriteria: "f",
        domainsRequested: ["identity"],
        actorAgentId: chainAgents[i - 1].id,
      });
      await startExecution(db, { organizationId: orgId, executionId: child.id, actorUserId: ownerId });
      await advanceExecution(db, { organizationId: orgId, executionId: child.id, toStatus: "planning", actorAgentId: chainAgents[i].id });
      await advanceExecution(db, { organizationId: orgId, executionId: child.id, toStatus: "reasoning", actorAgentId: chainAgents[i].id });
      currentExecuting = await advanceExecution(db, { organizationId: orgId, executionId: child.id, toStatus: "executing", actorAgentId: chainAgents[i].id });
    }

    // currentExecuting.delegationDepth is now 5 — one more delegation would be depth 6, exceeding MAX_DELEGATION_DEPTH (5).
    await expect(
      delegateExecution(db, {
        organizationId: orgId,
        parentExecutionId: currentExecuting.id,
        delegateAgentId: chainAgents[6].id,
        goal: "too deep",
        successCriteria: "s",
        failureCriteria: "f",
        domainsRequested: ["identity"],
        actorAgentId: chainAgents[5].id,
      })
    ).rejects.toBeInstanceOf(DelegationDepthExceededError);
  }, 30000);
});

describe("child failure propagation", () => {
  it("is deterministic: a failed child is reflected in checkDelegationResult, never silently absorbed", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const parentAgent = await makeAgent(orgId, ownerId);
    const childAgent = await makeAgent(orgId, ownerId);
    await grantAgentCapability(orgId, ownerId, parentAgent.id, "identity", "read");
    const parentExecuting = await makeExecutingExecution(orgId, ownerId, parentAgent.id);

    const { delegation, child } = await delegateExecution(db, {
      organizationId: orgId,
      parentExecutionId: parentExecuting.id,
      delegateAgentId: childAgent.id,
      goal: "g",
      successCriteria: "s",
      failureCriteria: "f",
      domainsRequested: ["identity"],
      actorAgentId: parentAgent.id,
    });

    await failExecution(db, { organizationId: orgId, executionId: child.id, failureClass: "runtime_error", reason: "boom", actorAgentId: childAgent.id });

    const result = await checkDelegationResult(db, orgId, delegation.id);
    expect(result.childStatus).toBe("failed");
    expect(result.delegation.status).toBe("failed");
  });
});

describe("cancellation cascade", () => {
  it("cancelling a parent cascades to cancel an active child delegation", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const parentAgent = await makeAgent(orgId, ownerId);
    const childAgent = await makeAgent(orgId, ownerId);
    await grantAgentCapability(orgId, ownerId, parentAgent.id, "identity", "read");
    const parentExecuting = await makeExecutingExecution(orgId, ownerId, parentAgent.id);

    const { child } = await delegateExecution(db, {
      organizationId: orgId,
      parentExecutionId: parentExecuting.id,
      delegateAgentId: childAgent.id,
      goal: "g",
      successCriteria: "s",
      failureCriteria: "f",
      domainsRequested: ["identity"],
      actorAgentId: parentAgent.id,
    });

    const { cancelExecution } = await import("./lifecycle");
    await cancelExecution(db, { organizationId: orgId, executionId: parentExecuting.id, reason: "parent cancelled", actorUserId: ownerId });

    const { getExecutionForUser } = await import("./executions");
    const refreshedChild = await getExecutionForUser(db, { organizationId: orgId, executionId: child.id, actorUserId: ownerId });
    expect(refreshedChild.status).toBe("cancelled");
  });
});
