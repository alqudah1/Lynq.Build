import { describe, it, expect, afterEach } from "vitest";
import { db, makeUser, makeOrgWithOwner, makeAgent, grantAgentCapability, cleanupAgentRuntimeTestData } from "./test-helpers";
import { createExecution } from "./executions";
import {
  assignExecution,
  startExecution,
  advanceExecution,
  completeExecution,
  failExecution,
  retryExecution,
  pauseExecution,
  resumeExecution,
  cancelExecution,
  archiveExecution,
} from "./lifecycle";
import { createPlan, completePlanStep } from "./plans";
import { InvalidExecutionTransitionError, InsufficientCompletionEvidenceError, RetryLimitExceededError, FailureNotRetryableError } from "./errors";
import { TenantResourceNotFoundError, InsufficientRoleError } from "@/lib/authz/errors";
import { retireAgent } from "@/lib/agents/lifecycle";

afterEach(cleanupAgentRuntimeTestData);

async function makeExecution(orgId: string, ownerId: string) {
  return createExecution(db, {
    organizationId: orgId,
    ownerUserId: ownerId,
    goal: "Draft a summary of Q3 performance",
    successCriteria: "A summary artifact exists covering revenue and churn",
    failureCriteria: "No summary produced, or it omits revenue/churn",
    domainsRequested: ["identity"],
    actorUserId: ownerId,
  });
}

describe("full execution lifecycle happy path", () => {
  it("walks queued -> assigned -> gathering_context -> planning -> reasoning -> executing -> verifying -> completed -> archived", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    await grantAgentCapability(orgId, ownerId, agent.id, "identity", "read");

    const execution = await makeExecution(orgId, ownerId);
    expect(execution.status).toBe("queued");

    const assigned = await assignExecution(db, { organizationId: orgId, executionId: execution.id, assignedAgentId: agent.id, actorUserId: ownerId });
    expect(assigned.status).toBe("assigned");
    expect(assigned.assignedAgentVersionNumber).toBe(1);

    const gathering = await startExecution(db, { organizationId: orgId, executionId: execution.id, actorUserId: ownerId });
    expect(gathering.status).toBe("gathering_context");
    expect(gathering.contextSnapshot).not.toBeNull();
    expect(gathering.contextSnapshot?.assignedAgentId).toBe(agent.id);

    const planning = await advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "planning", actorAgentId: agent.id });
    expect(planning.status).toBe("planning");

    const { plan } = await createPlan(db, { organizationId: orgId, executionId: execution.id, steps: ["Gather Q3 numbers", "Write the summary"], actorAgentId: agent.id });
    expect(plan.versionNumber).toBe(1);

    const reasoning = await advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "reasoning", actorAgentId: agent.id });
    expect(reasoning.status).toBe("reasoning");

    const executing = await advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "executing", actorAgentId: agent.id });
    expect(executing.status).toBe("executing");

    await completePlanStep(db, { organizationId: orgId, executionId: execution.id, planId: plan.id, stepNumber: 1, actorAgentId: agent.id });
    await completePlanStep(db, { organizationId: orgId, executionId: execution.id, planId: plan.id, stepNumber: 2, actorAgentId: agent.id });

    const verifying = await advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "verifying", actorAgentId: agent.id });
    expect(verifying.status).toBe("verifying");

    const completed = await completeExecution(db, { organizationId: orgId, executionId: execution.id, actorAgentId: agent.id });
    expect(completed.status).toBe("completed");
    expect(completed.completedAt).not.toBeNull();

    const archived = await archiveExecution(db, { organizationId: orgId, executionId: execution.id, actorUserId: ownerId });
    expect(archived.status).toBe("archived");
  });
});

describe("completion evidence gate", () => {
  it("refuses to complete while plan steps are still pending — the agent's own claim is never sufficient", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    const execution = await makeExecution(orgId, ownerId);
    await assignExecution(db, { organizationId: orgId, executionId: execution.id, assignedAgentId: agent.id, actorUserId: ownerId });
    await startExecution(db, { organizationId: orgId, executionId: execution.id, actorUserId: ownerId });
    await advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "planning", actorAgentId: agent.id });
    const { plan } = await createPlan(db, { organizationId: orgId, executionId: execution.id, steps: ["Step one", "Step two"], actorAgentId: agent.id });
    await advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "reasoning", actorAgentId: agent.id });
    await advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "executing", actorAgentId: agent.id });
    await completePlanStep(db, { organizationId: orgId, executionId: execution.id, planId: plan.id, stepNumber: 1, actorAgentId: agent.id });
    // Step 2 deliberately left pending.
    await advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "verifying", actorAgentId: agent.id });

    await expect(completeExecution(db, { organizationId: orgId, executionId: execution.id, actorAgentId: agent.id })).rejects.toBeInstanceOf(InsufficientCompletionEvidenceError);
  });
});

describe("invalid transitions", () => {
  it("rejects skipping states (queued directly to executing)", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    const execution = await makeExecution(orgId, ownerId);

    await expect(advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "executing", actorAgentId: agent.id })).rejects.toThrow();
  });

  it("rejects an agent driving a transition on an execution it isn't assigned to", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    const otherAgent = await makeAgent(orgId, ownerId);
    const execution = await makeExecution(orgId, ownerId);
    await assignExecution(db, { organizationId: orgId, executionId: execution.id, assignedAgentId: agent.id, actorUserId: ownerId });
    await startExecution(db, { organizationId: orgId, executionId: execution.id, actorUserId: ownerId });

    await expect(advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "planning", actorAgentId: otherAgent.id })).rejects.toThrow();
  });
});

describe("unregistered / retired agent cannot execute", () => {
  it("rejects assignment to a nonexistent agent id", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const execution = await makeExecution(orgId, ownerId);

    await expect(assignExecution(db, { organizationId: orgId, executionId: execution.id, assignedAgentId: crypto.randomUUID(), actorUserId: ownerId })).rejects.toBeInstanceOf(InvalidExecutionTransitionError);
  });

  it("rejects starting an execution whose assigned agent has since been retired", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    const execution = await makeExecution(orgId, ownerId);
    await assignExecution(db, { organizationId: orgId, executionId: execution.id, assignedAgentId: agent.id, actorUserId: ownerId });
    await retireAgent(db, { organizationId: orgId, agentId: agent.id, reason: "test retirement", actorUserId: ownerId });

    await expect(startExecution(db, { organizationId: orgId, executionId: execution.id, actorUserId: ownerId })).rejects.toThrow();
  });
});

describe("execution context does not override revoked live permissions", () => {
  it("a Brain grant revoked after gathering_context no longer authorizes a later gated action", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    await grantAgentCapability(orgId, ownerId, agent.id, "identity", "draft_write");
    const execution = await makeExecution(orgId, ownerId);
    await assignExecution(db, { organizationId: orgId, executionId: execution.id, assignedAgentId: agent.id, actorUserId: ownerId });
    const gathering = await startExecution(db, { organizationId: orgId, executionId: execution.id, actorUserId: ownerId });

    // Snapshot captured draft_write as granted.
    expect(gathering.contextSnapshot?.grantedCapabilitiesAtAssignment["identity:org"]).toContain("draft_write");

    // Revoke the grant live, after the snapshot was taken.
    const { revokeBrainPermissionGrant, listBrainPermissionGrants } = await import("@/lib/brain/permissions");
    const grants = await listBrainPermissionGrants(db, { organizationId: orgId, actorUserId: ownerId, granteeAgentId: agent.id });
    for (const grant of grants) {
      await revokeBrainPermissionGrant(db, { organizationId: orgId, grantId: grant.id, actorUserId: ownerId });
    }

    const { createDraftKnowledgeItemAsAgent } = await import("@/lib/agents/drafts");
    const principal = { principalType: "agent" as const, agentId: agent.id, organizationId: orgId, permissionLevel: agent.permissionLevel, department: agent.department };
    await expect(
      createDraftKnowledgeItemAsAgent(db, (await import("@/lib/agent-runtime/test-helpers")).rawSql, principal, { domain: "identity", classification: "fact", title: "t", content: "c" })
    ).rejects.toThrow();
  });
});

describe("two workers cannot claim one execution", () => {
  it("of two concurrent assign attempts on the same queued execution, exactly one succeeds", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agentA = await makeAgent(orgId, ownerId);
    const agentB = await makeAgent(orgId, ownerId);
    const execution = await makeExecution(orgId, ownerId);

    const results = await Promise.allSettled([
      assignExecution(db, { organizationId: orgId, executionId: execution.id, assignedAgentId: agentA.id, actorUserId: ownerId }),
      assignExecution(db, { organizationId: orgId, executionId: execution.id, assignedAgentId: agentB.id, actorUserId: ownerId }),
    ]);

    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
  });

  it("of two concurrent start attempts on the same assigned execution, exactly one succeeds (no double transition)", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    const execution = await makeExecution(orgId, ownerId);
    await assignExecution(db, { organizationId: orgId, executionId: execution.id, assignedAgentId: agent.id, actorUserId: ownerId });

    const results = await Promise.allSettled([
      startExecution(db, { organizationId: orgId, executionId: execution.id, actorUserId: ownerId }),
      startExecution(db, { organizationId: orgId, executionId: execution.id, actorUserId: ownerId }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
});

describe("pause / resume", () => {
  it("preserves progress: resuming returns to the exact state it was paused from, with plan steps intact", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    const execution = await makeExecution(orgId, ownerId);
    await assignExecution(db, { organizationId: orgId, executionId: execution.id, assignedAgentId: agent.id, actorUserId: ownerId });
    await startExecution(db, { organizationId: orgId, executionId: execution.id, actorUserId: ownerId });
    await advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "planning", actorAgentId: agent.id });
    const { plan } = await createPlan(db, { organizationId: orgId, executionId: execution.id, steps: ["Step one"], actorAgentId: agent.id });
    await completePlanStep(db, { organizationId: orgId, executionId: execution.id, planId: plan.id, stepNumber: 1, actorAgentId: agent.id });

    const paused = await pauseExecution(db, { organizationId: orgId, executionId: execution.id, actorUserId: ownerId });
    expect(paused.status).toBe("paused");

    const resumed = await resumeExecution(db, { organizationId: orgId, executionId: execution.id, actorUserId: ownerId });
    expect(resumed.status).toBe("planning");

    const { getPlanSteps } = await import("./plans");
    const steps = await getPlanSteps(db, plan.id);
    expect(steps[0].status).toBe("completed");
  });

  it("a cancelled execution cannot be resumed or continued", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    const execution = await makeExecution(orgId, ownerId);
    await assignExecution(db, { organizationId: orgId, executionId: execution.id, assignedAgentId: agent.id, actorUserId: ownerId });
    await startExecution(db, { organizationId: orgId, executionId: execution.id, actorUserId: ownerId });

    const cancelled = await cancelExecution(db, { organizationId: orgId, executionId: execution.id, reason: "no longer needed", actorUserId: ownerId });
    expect(cancelled.status).toBe("cancelled");

    await expect(resumeExecution(db, { organizationId: orgId, executionId: execution.id, actorUserId: ownerId })).rejects.toBeInstanceOf(InvalidExecutionTransitionError);
    await expect(advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "planning", actorAgentId: agent.id })).rejects.toThrow();
  });
});

describe("retry", () => {
  it("is bounded by maxRetries and only allowed for a transient failure class", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    const execution = await createExecution(db, {
      organizationId: orgId,
      ownerUserId: ownerId,
      goal: "test",
      successCriteria: "test",
      failureCriteria: "test",
      domainsRequested: ["identity"],
      maxRetries: 1,
      actorUserId: ownerId,
    });
    await assignExecution(db, { organizationId: orgId, executionId: execution.id, assignedAgentId: agent.id, actorUserId: ownerId });
    await startExecution(db, { organizationId: orgId, executionId: execution.id, actorUserId: ownerId });

    await failExecution(db, { organizationId: orgId, executionId: execution.id, failureClass: "timeout", reason: "timed out", actorAgentId: agent.id });
    const retried = await retryExecution(db, { organizationId: orgId, executionId: execution.id, actorUserId: ownerId });
    expect(retried.status).toBe("queued");
    expect(retried.retryCount).toBe(1);

    await assignExecution(db, { organizationId: orgId, executionId: execution.id, assignedAgentId: agent.id, actorUserId: ownerId });
    await startExecution(db, { organizationId: orgId, executionId: execution.id, actorUserId: ownerId });
    await failExecution(db, { organizationId: orgId, executionId: execution.id, failureClass: "timeout", reason: "timed out again", actorAgentId: agent.id });

    await expect(retryExecution(db, { organizationId: orgId, executionId: execution.id, actorUserId: ownerId })).rejects.toBeInstanceOf(RetryLimitExceededError);
  });

  it("allows a human to retry a bounded runtime error after the underlying configuration is repaired", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    const execution = await makeExecution(orgId, ownerId);
    await assignExecution(db, { organizationId: orgId, executionId: execution.id, assignedAgentId: agent.id, actorUserId: ownerId });
    await startExecution(db, { organizationId: orgId, executionId: execution.id, actorUserId: ownerId });
    await failExecution(db, { organizationId: orgId, executionId: execution.id, failureClass: "runtime_error", reason: "provider configuration failed", actorAgentId: agent.id });

    const retried = await retryExecution(db, { organizationId: orgId, executionId: execution.id, actorUserId: ownerId });
    expect(retried.status).toBe("queued");
    expect(retried.retryCount).toBe(1);
  });

  it("refuses to retry a non-transient failure (permission_failure)", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    const execution = await makeExecution(orgId, ownerId);
    await assignExecution(db, { organizationId: orgId, executionId: execution.id, assignedAgentId: agent.id, actorUserId: ownerId });
    await startExecution(db, { organizationId: orgId, executionId: execution.id, actorUserId: ownerId });
    await failExecution(db, { organizationId: orgId, executionId: execution.id, failureClass: "permission_failure", reason: "missing grant", actorAgentId: agent.id });

    await expect(retryExecution(db, { organizationId: orgId, executionId: execution.id, actorUserId: ownerId })).rejects.toBeInstanceOf(FailureNotRetryableError);
  });
});

describe("cross-tenant access", () => {
  it("returns 404-shaped error for an execution in a different organization", async () => {
    const ownerId = await makeUser();
    const otherOwnerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const otherOrgId = await makeOrgWithOwner(otherOwnerId);
    const execution = await makeExecution(orgId, ownerId);

    const { getExecutionForUser } = await import("./executions");
    await expect(getExecutionForUser(db, { organizationId: otherOrgId, executionId: execution.id, actorUserId: otherOwnerId })).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });
});

describe("runtime management authority", () => {
  it("a plain member (not owner/admin, not the execution's own owner) cannot pause or cancel", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { organizationMemberships } = await import("@/db/schema");
    await db.insert(organizationMemberships).values({ organizationId: orgId, userId: memberId, role: "member" });
    const execution = await makeExecution(orgId, ownerId);

    await expect(pauseExecution(db, { organizationId: orgId, executionId: execution.id, actorUserId: memberId })).rejects.toBeInstanceOf(InsufficientRoleError);
  });
});
