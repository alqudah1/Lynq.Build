import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { db, rawSql, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, ensureToolsSeeded, seedAnalystForWorkflowTests, makeKnowledgeItem, makeProject } from "./test-helpers";
import { createWorkflowDefinition } from "./definitions";
import { createWorkflowVersion, validateWorkflowVersionAndPersist, publishWorkflowVersion } from "./versions";
import { createWorkflowNode } from "./nodes";
import { createWorkflowEdge } from "./edges";
import { startWorkflowExecution, resolveWorkflowExecutionById } from "./executions";
import { listNodeExecutionsForExecution } from "./node-executions";
import { completeWorkflowHumanTask } from "./human-tasks";
import { transitionTaskStatus } from "@/lib/projects/tasks";
import { approveRequest, rejectRequest } from "@/lib/agent-runtime/approvals";
import { notifyApprovalDecided, notifyProjectTaskChanged } from "./scheduling";
import { pollAndProcess } from "@/lib/runtime/worker";
import { workflowNodeExecutions, runtimeJobs, brainPermissionGrants } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";

async function grantOwnerCapability(orgId: string, ownerId: string, capability: "read" | "draft_write") {
  await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, granteeType: "human", capability }).onConflictDoNothing();
}

beforeAll(ensureToolsSeeded);
afterEach(cleanupAgentRuntimeTestData);

async function publishGraph(orgId: string, ownerId: string, workflowKey: string, build: (definitionId: string, versionId: string) => Promise<void>) {
  const definition = await createWorkflowDefinition(db, { organizationId: orgId, name: workflowKey, workflowKey, actorUserId: ownerId });
  const version = await createWorkflowVersion(db, { organizationId: orgId, definitionId: definition.id, actorUserId: ownerId });
  await build(definition.id, version.id);
  await validateWorkflowVersionAndPersist(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, actorUserId: ownerId });
  await publishWorkflowVersion(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, expectedRevision: 2, actorUserId: ownerId });
  return definition;
}

/**
 * Drains the real runtime queue for this org until the execution reaches
 * a terminal or waiting state, or the attempt budget runs out — the same
 * "drive the real worker forward" pattern Module 9's own worker tests
 * use, never a synthetic shortcut. Targets `onlyJobIds` at whichever job
 * is actually queued for THIS execution (via `runtimeJobs.workflowExecutionId`)
 * on each poll — the same `onlyJobIds`-targeting Module 9 already
 * established for exactly this reason: under full-suite parallelism, an
 * untargeted `pollAndProcess` can claim a different test file's job
 * instead of (or as well as) this execution's own.
 */
async function driveToStatus(orgId: string, executionId: string, targetStatuses: string[], maxAttempts = 30): Promise<Awaited<ReturnType<typeof resolveWorkflowExecutionById>>> {
  let execution = await resolveWorkflowExecutionById(db, orgId, executionId);
  for (let i = 0; i < maxAttempts && !targetStatuses.includes(execution.status); i++) {
    const queued = await db
      .select({ id: runtimeJobs.id })
      .from(runtimeJobs)
      .where(and(eq(runtimeJobs.workflowExecutionId, executionId), inArray(runtimeJobs.status, ["queued", "retry_scheduled"])));
    if (queued.length > 0) {
      await pollAndProcess(db, rawSql, { leaseOwner: `test-worker:${executionId}:${i}`, onlyJobIds: queued.map((j) => j.id) });
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    execution = await resolveWorkflowExecutionById(db, orgId, executionId);
  }
  return execution;
}

describe("end-to-end workflow execution — real Runtime and Tool Runtime operations", () => {
  it("start -> tool_invocation (brain.search) -> end completes through the real worker, recording a real tool invocation id", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const analyst = await seedAnalystForWorkflowTests(orgId, ownerId, ["identity"]);
    await grantOwnerCapability(orgId, ownerId, "draft_write");
    await makeKnowledgeItem(orgId, ownerId, "identity", "Refund Policy", "Customers may request a refund within 30 days of purchase");

    const definition = await publishGraph(orgId, ownerId, "TOOLWF", async (definitionId, versionId) => {
      const start = await createWorkflowNode(db, { organizationId: orgId, definitionId, versionId, nodeKey: "start", nodeType: "start", name: "Start", actorUserId: ownerId });
      const tool = await createWorkflowNode(db, {
        organizationId: orgId,
        definitionId,
        versionId,
        nodeKey: "search",
        nodeType: "tool_invocation",
        name: "Search Brain",
        configuration: { agentId: analyst.id, toolKey: "brain.search" },
        inputMapping: { domain: { source: "literal", value: "identity" }, query: { source: "literal", value: "refund" } },
        actorUserId: ownerId,
      });
      const end = await createWorkflowNode(db, { organizationId: orgId, definitionId, versionId, nodeKey: "end", nodeType: "end", name: "End", actorUserId: ownerId });
      await createWorkflowEdge(db, { organizationId: orgId, definitionId, versionId, sourceNodeId: start.id, targetNodeId: tool.id, actorUserId: ownerId });
      await createWorkflowEdge(db, { organizationId: orgId, definitionId, versionId, sourceNodeId: tool.id, targetNodeId: end.id, actorUserId: ownerId });
    });

    const execution = await startWorkflowExecution(db, { organizationId: orgId, definitionId: definition.id, actorUserId: ownerId });
    const finalExecution = await driveToStatus(orgId, execution.id, ["completed", "failed"]);

    expect(finalExecution.status).toBe("completed");
    const nodeExecutions = await listNodeExecutionsForExecution(db, execution.id);
    const toolNodeExecution = nodeExecutions.find((ne) => ne.toolInvocationId !== null);
    expect(toolNodeExecution?.toolInvocationId).toBeTruthy();
    expect(toolNodeExecution?.status).toBe("succeeded");
  });

  it("start -> condition -> end selects the branch matching the workflow input, deterministically", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);

    const definition = await publishGraph(orgId, ownerId, "CONDWF", async (definitionId, versionId) => {
      const start = await createWorkflowNode(db, { organizationId: orgId, definitionId, versionId, nodeKey: "start", nodeType: "start", name: "Start", actorUserId: ownerId });
      const cond = await createWorkflowNode(db, {
        organizationId: orgId,
        definitionId,
        versionId,
        nodeKey: "cond",
        nodeType: "condition",
        name: "Check flag",
        configuration: { branches: [{ branchKey: "yes", operator: "equals", left: { source: "workflow_input", path: "flag" }, right: true }], defaultBranchKey: "no" },
        actorUserId: ownerId,
      });
      const yesEnd = await createWorkflowNode(db, { organizationId: orgId, definitionId, versionId, nodeKey: "yes_end", nodeType: "end", name: "Yes End", actorUserId: ownerId });
      const noEnd = await createWorkflowNode(db, { organizationId: orgId, definitionId, versionId, nodeKey: "no_end", nodeType: "end", name: "No End", actorUserId: ownerId });
      await createWorkflowEdge(db, { organizationId: orgId, definitionId, versionId, sourceNodeId: start.id, targetNodeId: cond.id, actorUserId: ownerId });
      await createWorkflowEdge(db, { organizationId: orgId, definitionId, versionId, sourceNodeId: cond.id, targetNodeId: yesEnd.id, conditionKey: "yes", actorUserId: ownerId });
      await createWorkflowEdge(db, { organizationId: orgId, definitionId, versionId, sourceNodeId: cond.id, targetNodeId: noEnd.id, conditionKey: "no", actorUserId: ownerId });
    });

    const trueExecution = await startWorkflowExecution(db, { organizationId: orgId, definitionId: definition.id, input: { flag: true }, actorUserId: ownerId });
    const trueFinal = await driveToStatus(orgId, trueExecution.id, ["completed", "failed"]);
    expect(trueFinal.status).toBe("completed");

    const falseExecution = await startWorkflowExecution(db, { organizationId: orgId, definitionId: definition.id, input: { flag: false }, actorUserId: ownerId });
    const falseFinal = await driveToStatus(orgId, falseExecution.id, ["completed", "failed"]);
    expect(falseFinal.status).toBe("completed");

    const trueNodeExecutions = await db.select().from(workflowNodeExecutions).where(and(eq(workflowNodeExecutions.workflowExecutionId, trueExecution.id), eq(workflowNodeExecutions.status, "succeeded")));
    const conditionResult = trueNodeExecutions.find((ne) => (ne.output as { selectedBranch?: string } | null)?.selectedBranch);
    expect((conditionResult?.output as { selectedBranch?: string } | undefined)?.selectedBranch).toBe("yes");
  });

  it("start -> human_task -> end waits for explicit human completion, never auto-completing", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);

    const definition = await publishGraph(orgId, ownerId, "HUMANWF", async (definitionId, versionId) => {
      const start = await createWorkflowNode(db, { organizationId: orgId, definitionId, versionId, nodeKey: "start", nodeType: "start", name: "Start", actorUserId: ownerId });
      const task = await createWorkflowNode(db, { organizationId: orgId, definitionId, versionId, nodeKey: "task", nodeType: "human_task", name: "Review", configuration: { assignedUserId: ownerId, title: "Review this" }, actorUserId: ownerId });
      const end = await createWorkflowNode(db, { organizationId: orgId, definitionId, versionId, nodeKey: "end", nodeType: "end", name: "End", actorUserId: ownerId });
      await createWorkflowEdge(db, { organizationId: orgId, definitionId, versionId, sourceNodeId: start.id, targetNodeId: task.id, actorUserId: ownerId });
      await createWorkflowEdge(db, { organizationId: orgId, definitionId, versionId, sourceNodeId: task.id, targetNodeId: end.id, actorUserId: ownerId });
    });

    const execution = await startWorkflowExecution(db, { organizationId: orgId, definitionId: definition.id, actorUserId: ownerId });
    const waiting = await driveToStatus(orgId, execution.id, ["waiting", "completed", "failed"], 10);
    expect(waiting.status).toBe("waiting");

    const { listMyWorkflowHumanTasks } = await import("./human-tasks");
    const tasks = await listMyWorkflowHumanTasks(db, { organizationId: orgId, actorUserId: ownerId, status: "pending" });
    expect(tasks).toHaveLength(1);

    await completeWorkflowHumanTask(db, { organizationId: orgId, taskId: tasks[0].id, expectedRevision: tasks[0].revision, actorUserId: ownerId });

    const finalExecution = await driveToStatus(orgId, execution.id, ["completed", "failed"]);
    expect(finalExecution.status).toBe("completed");
  });

  it("start -> approval -> end waits for a real Runtime approval decision; rejection fails the workflow", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const analyst = await seedAnalystForWorkflowTests(orgId, ownerId, ["identity"]);

    const definition = await publishGraph(orgId, ownerId, "APPROVEWF", async (definitionId, versionId) => {
      const start = await createWorkflowNode(db, { organizationId: orgId, definitionId, versionId, nodeKey: "start", nodeType: "start", name: "Start", actorUserId: ownerId });
      const approval = await createWorkflowNode(db, { organizationId: orgId, definitionId, versionId, nodeKey: "approve", nodeType: "approval", name: "Approve", configuration: { agentId: analyst.id, requestedAction: "publish", summary: "Approve this", riskLevel: "low" }, actorUserId: ownerId });
      const end = await createWorkflowNode(db, { organizationId: orgId, definitionId, versionId, nodeKey: "end", nodeType: "end", name: "End", actorUserId: ownerId });
      await createWorkflowEdge(db, { organizationId: orgId, definitionId, versionId, sourceNodeId: start.id, targetNodeId: approval.id, actorUserId: ownerId });
      await createWorkflowEdge(db, { organizationId: orgId, definitionId, versionId, sourceNodeId: approval.id, targetNodeId: end.id, actorUserId: ownerId });
    });

    // Approved path.
    const approvedExecution = await startWorkflowExecution(db, { organizationId: orgId, definitionId: definition.id, actorUserId: ownerId });
    await driveToStatus(orgId, approvedExecution.id, ["waiting_for_approval", "completed", "failed"], 10);
    const approvedNodeExecutions = await listNodeExecutionsForExecution(db, approvedExecution.id);
    const approvalRequestId = approvedNodeExecutions.find((ne) => ne.approvalRequestId)?.approvalRequestId;
    expect(approvalRequestId).toBeTruthy();
    await approveRequest(db, { organizationId: orgId, approvalId: approvalRequestId!, actorUserId: ownerId });
    await notifyApprovalDecided(db, { organizationId: orgId, approvalRequestId: approvalRequestId! });
    const approvedFinal = await driveToStatus(orgId, approvedExecution.id, ["completed", "failed"]);
    expect(approvedFinal.status).toBe("completed");

    // Rejected path.
    const rejectedExecution = await startWorkflowExecution(db, { organizationId: orgId, definitionId: definition.id, actorUserId: ownerId });
    await driveToStatus(orgId, rejectedExecution.id, ["waiting_for_approval", "completed", "failed"], 10);
    const rejectedNodeExecutions = await listNodeExecutionsForExecution(db, rejectedExecution.id);
    const rejectedApprovalId = rejectedNodeExecutions.find((ne) => ne.approvalRequestId)?.approvalRequestId;
    await rejectRequest(db, { organizationId: orgId, approvalId: rejectedApprovalId!, actorUserId: ownerId, severe: true });
    await notifyApprovalDecided(db, { organizationId: orgId, approvalRequestId: rejectedApprovalId! });
    const rejectedFinal = await driveToStatus(orgId, rejectedExecution.id, ["completed", "failed"]);
    expect(rejectedFinal.status).toBe("failed");
  }, 30000);

  it("start -> project_task -> end links a real Projects Core task and never auto-completes it — human project status remains authoritative", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);

    const definition = await publishGraph(orgId, ownerId, "PROJTASKWF", async (definitionId, versionId) => {
      const start = await createWorkflowNode(db, { organizationId: orgId, definitionId, versionId, nodeKey: "start", nodeType: "start", name: "Start", actorUserId: ownerId });
      const task = await createWorkflowNode(db, { organizationId: orgId, definitionId, versionId, nodeKey: "task", nodeType: "project_task", name: "Research task", configuration: { createNew: true, title: "Research from workflow" }, actorUserId: ownerId });
      const end = await createWorkflowNode(db, { organizationId: orgId, definitionId, versionId, nodeKey: "end", nodeType: "end", name: "End", actorUserId: ownerId });
      await createWorkflowEdge(db, { organizationId: orgId, definitionId, versionId, sourceNodeId: start.id, targetNodeId: task.id, actorUserId: ownerId });
      await createWorkflowEdge(db, { organizationId: orgId, definitionId, versionId, sourceNodeId: task.id, targetNodeId: end.id, actorUserId: ownerId });
    });

    const execution = await startWorkflowExecution(db, { organizationId: orgId, definitionId: definition.id, projectId: project.id, actorUserId: ownerId });
    const waiting = await driveToStatus(orgId, execution.id, ["waiting", "completed", "failed"], 10);
    expect(waiting.status).toBe("waiting");

    const nodeExecutions = await listNodeExecutionsForExecution(db, execution.id);
    const projectTaskId = nodeExecutions.find((ne) => ne.projectTaskId)?.projectTaskId;
    expect(projectTaskId).toBeTruthy();

    // Still waiting — the workflow never completed the task on its own.
    const stillWaiting = await resolveWorkflowExecutionById(db, orgId, execution.id);
    expect(stillWaiting.status).toBe("waiting");

    // A human explicitly completes the task through Projects Core's own API — not the workflow.
    const { resolveTaskById, transitionTaskStatus: transition } = await import("@/lib/projects/tasks");
    const task = await resolveTaskById(db, orgId, projectTaskId!);
    let current = await transition(db, { organizationId: orgId, taskId: projectTaskId!, toStatus: "ready", expectedRevision: task.revision, actorUserId: ownerId });
    current = await transitionTaskStatus(db, { organizationId: orgId, taskId: projectTaskId!, toStatus: "in_progress", expectedRevision: current.revision, actorUserId: ownerId });
    await transitionTaskStatus(db, { organizationId: orgId, taskId: projectTaskId!, toStatus: "completed", expectedRevision: current.revision, actorUserId: ownerId });
    await notifyProjectTaskChanged(db, { organizationId: orgId, projectTaskId: projectTaskId! });

    const finalExecution = await driveToStatus(orgId, execution.id, ["completed", "failed"]);
    expect(finalExecution.status).toBe("completed");
  });
});
