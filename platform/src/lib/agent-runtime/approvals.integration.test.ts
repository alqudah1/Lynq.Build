import { describe, it, expect, afterEach } from "vitest";
import { db, makeUser, makeOrgWithOwner, makeAgent, cleanupAgentRuntimeTestData } from "./test-helpers";
import { createExecution } from "./executions";
import { assignExecution, startExecution, advanceExecution, completeExecution } from "./lifecycle";
import { requestApproval, approveRequest, rejectRequest, requestRevision } from "./approvals";
import { ApprovalAlreadyDecidedError, InsufficientCompletionEvidenceError } from "./errors";

afterEach(cleanupAgentRuntimeTestData);

async function makeExecutingExecution(orgId: string, ownerId: string, agentId: string) {
  const execution = await createExecution(db, {
    organizationId: orgId,
    ownerUserId: ownerId,
    goal: "Send a customer email",
    successCriteria: "Email sent and logged",
    failureCriteria: "Email not sent or contains an error",
    domainsRequested: ["identity"],
    actorUserId: ownerId,
  });
  await assignExecution(db, { organizationId: orgId, executionId: execution.id, assignedAgentId: agentId, actorUserId: ownerId });
  await startExecution(db, { organizationId: orgId, executionId: execution.id, actorUserId: ownerId });
  await advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "planning", actorAgentId: agentId });
  await advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "reasoning", actorAgentId: agentId });
  return advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "executing", actorAgentId: agentId });
}

describe("approval-gated actions", () => {
  it("pauses the execution at human_approval, and the action cannot proceed without a resolved approval", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    const executing = await makeExecutingExecution(orgId, ownerId, agent.id);

    const { request, execution } = await requestApproval(db, {
      organizationId: orgId,
      executionId: executing.id,
      requestedAction: "send_email",
      summary: "Send the drafted email to the customer",
      riskLevel: "high",
      actorAgentId: agent.id,
    });

    expect(request.status).toBe("pending");
    expect(execution.status).toBe("human_approval");

    // Cannot advance past it — the execution is not `executing`, so the agent's own attempt to move forward fails.
    await expect((await import("./lifecycle")).advanceExecution(db, { organizationId: orgId, executionId: executing.id, toStatus: "verifying", actorAgentId: agent.id })).rejects.toThrow();
  });

  it("approved -> execution resumes to executing", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    const executing = await makeExecutingExecution(orgId, ownerId, agent.id);
    const { request } = await requestApproval(db, { organizationId: orgId, executionId: executing.id, requestedAction: "send_email", summary: "s", riskLevel: "high", actorAgentId: agent.id });

    const decided = await approveRequest(db, { organizationId: orgId, approvalId: request.id, actorUserId: ownerId });
    expect(decided.status).toBe("approved");

    const { getExecutionForUser } = await import("./executions");
    const refreshed = await getExecutionForUser(db, { organizationId: orgId, executionId: executing.id, actorUserId: ownerId });
    expect(refreshed.status).toBe("executing");
  });

  it("approval is single-use — deciding twice fails", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    const executing = await makeExecutingExecution(orgId, ownerId, agent.id);
    const { request } = await requestApproval(db, { organizationId: orgId, executionId: executing.id, requestedAction: "send_email", summary: "s", riskLevel: "high", actorAgentId: agent.id });

    await approveRequest(db, { organizationId: orgId, approvalId: request.id, actorUserId: ownerId });
    await expect(approveRequest(db, { organizationId: orgId, approvalId: request.id, actorUserId: ownerId })).rejects.toBeInstanceOf(ApprovalAlreadyDecidedError);
  });

  it("rejection (non-severe) returns the execution to planning, preventing completion until re-planned", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    const executing = await makeExecutingExecution(orgId, ownerId, agent.id);
    const { request } = await requestApproval(db, { organizationId: orgId, executionId: executing.id, requestedAction: "send_email", summary: "s", riskLevel: "critical", actorAgentId: agent.id });

    const decided = await rejectRequest(db, { organizationId: orgId, approvalId: request.id, actorUserId: ownerId });
    expect(decided.status).toBe("rejected");

    const { getExecutionForUser } = await import("./executions");
    const refreshed = await getExecutionForUser(db, { organizationId: orgId, executionId: executing.id, actorUserId: ownerId });
    expect(refreshed.status).toBe("planning");

    // Cannot be completed — it's not even verifying yet, let alone evidenced.
    await expect(completeExecution(db, { organizationId: orgId, executionId: executing.id, actorAgentId: agent.id })).rejects.toThrow();
  });

  it("severe rejection cancels the execution outright", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    const executing = await makeExecutingExecution(orgId, ownerId, agent.id);
    const { request } = await requestApproval(db, { organizationId: orgId, executionId: executing.id, requestedAction: "delete_customer_data", summary: "s", riskLevel: "critical", actorAgentId: agent.id });

    await rejectRequest(db, { organizationId: orgId, approvalId: request.id, actorUserId: ownerId, severe: true });

    const { getExecutionForUser } = await import("./executions");
    const refreshed = await getExecutionForUser(db, { organizationId: orgId, executionId: executing.id, actorUserId: ownerId });
    expect(refreshed.status).toBe("cancelled");
  });

  it("revision-requested returns to executing with the decision note attached, not a full restart", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    const executing = await makeExecutingExecution(orgId, ownerId, agent.id);
    const { request } = await requestApproval(db, { organizationId: orgId, executionId: executing.id, requestedAction: "send_email", summary: "s", riskLevel: "medium", actorAgentId: agent.id });

    const decided = await requestRevision(db, { organizationId: orgId, approvalId: request.id, decisionNote: "Change paragraph 2", actorUserId: ownerId });
    expect(decided.status).toBe("revision_requested");
    expect(decided.decisionNote).toBe("Change paragraph 2");

    const { getExecutionForUser } = await import("./executions");
    const refreshed = await getExecutionForUser(db, { organizationId: orgId, executionId: executing.id, actorUserId: ownerId });
    expect(refreshed.status).toBe("executing");
  });
});

describe("agent cannot self-declare completion", () => {
  it("there is no field or path anywhere in completeExecution's own input that accepts a narrative claim of success — only objective plan-step evidence", async () => {
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
      actorUserId: ownerId,
    });
    await assignExecution(db, { organizationId: orgId, executionId: execution.id, assignedAgentId: agent.id, actorUserId: ownerId });
    await startExecution(db, { organizationId: orgId, executionId: execution.id, actorUserId: ownerId });
    await advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "planning", actorAgentId: agent.id });
    const { createPlan } = await import("./plans");
    await createPlan(db, { organizationId: orgId, executionId: execution.id, steps: ["Do the thing"], actorAgentId: agent.id });
    await advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "reasoning", actorAgentId: agent.id });
    await advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "executing", actorAgentId: agent.id });
    await advanceExecution(db, { organizationId: orgId, executionId: execution.id, toStatus: "verifying", actorAgentId: agent.id });

    // The step was never marked completed — the agent cannot simply assert "I finished."
    await expect(completeExecution(db, { organizationId: orgId, executionId: execution.id, actorAgentId: agent.id })).rejects.toBeInstanceOf(InsufficientCompletionEvidenceError);
  });
});
