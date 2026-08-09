import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, ensureToolsSeeded } from "./test-helpers";
import { createWorkflowDefinition } from "./definitions";
import { createWorkflowVersion, validateWorkflowVersionAndPersist, publishWorkflowVersion } from "./versions";
import { createWorkflowNode } from "./nodes";
import { createWorkflowEdge } from "./edges";
import { startWorkflowExecution, transitionWorkflowExecutionStatus } from "./executions";
import { createNodeExecution, NodeAlreadyActiveError, transitionNodeExecution } from "./node-executions";
import { completeWorkflowHumanTask } from "./human-tasks";
import { reconcileWorkflows } from "./reconciliation";
import { runtimeJobs, workflowExecutions } from "@/db/schema";

beforeAll(ensureToolsSeeded);
afterEach(cleanupAgentRuntimeTestData);

async function publishSimpleHumanTaskWorkflow(orgId: string, ownerId: string, key: string) {
  const definition = await createWorkflowDefinition(db, { organizationId: orgId, name: key, workflowKey: key, actorUserId: ownerId });
  const version = await createWorkflowVersion(db, { organizationId: orgId, definitionId: definition.id, actorUserId: ownerId });
  const start = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "start", nodeType: "start", name: "Start", actorUserId: ownerId });
  const task = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "task", nodeType: "human_task", name: "Task", configuration: { assignedUserId: ownerId, title: "Do it" }, actorUserId: ownerId });
  const end = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "end", nodeType: "end", name: "End", actorUserId: ownerId });
  await createWorkflowEdge(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, sourceNodeId: start.id, targetNodeId: task.id, actorUserId: ownerId });
  await createWorkflowEdge(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, sourceNodeId: task.id, targetNodeId: end.id, actorUserId: ownerId });
  await validateWorkflowVersionAndPersist(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, actorUserId: ownerId });
  await publishWorkflowVersion(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, expectedRevision: 2, actorUserId: ownerId });
  return { definition, taskNodeId: task.id };
}

describe("node execution concurrency — 'two workers cannot execute the same node'", () => {
  it("the active-partial-unique-index rejects a second concurrent attempt for the same (execution, node) pair", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const definition = await createWorkflowDefinition(db, { organizationId: orgId, name: "ACTNODE", workflowKey: "ACTNODE", actorUserId: ownerId });
    const version = await createWorkflowVersion(db, { organizationId: orgId, definitionId: definition.id, actorUserId: ownerId });
    const start = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "start", nodeType: "start", name: "Start", actorUserId: ownerId });
    const end = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "end", nodeType: "end", name: "End", actorUserId: ownerId });
    await createWorkflowEdge(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, sourceNodeId: start.id, targetNodeId: end.id, actorUserId: ownerId });
    await validateWorkflowVersionAndPersist(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, actorUserId: ownerId });
    await publishWorkflowVersion(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, expectedRevision: 2, actorUserId: ownerId });

    const execution = await startWorkflowExecution(db, { organizationId: orgId, definitionId: definition.id, actorUserId: ownerId });

    const results = await Promise.allSettled([
      createNodeExecution(db, { organizationId: orgId, workflowExecutionId: execution.id, workflowNodeId: start.id, attemptNumber: 1 }),
      createNodeExecution(db, { organizationId: orgId, workflowExecutionId: execution.id, workflowNodeId: start.id, attemptNumber: 1 }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(NodeAlreadyActiveError);
  });

  it("a stale node-execution revision fails the transition rather than silently overwriting", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const definition = await createWorkflowDefinition(db, { organizationId: orgId, name: "STALENODE", workflowKey: "STALENODE", actorUserId: ownerId });
    const version = await createWorkflowVersion(db, { organizationId: orgId, definitionId: definition.id, actorUserId: ownerId });
    const start = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "start", nodeType: "start", name: "Start", actorUserId: ownerId });
    const end = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "end", nodeType: "end", name: "End", actorUserId: ownerId });
    await createWorkflowEdge(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, sourceNodeId: start.id, targetNodeId: end.id, actorUserId: ownerId });
    await validateWorkflowVersionAndPersist(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, actorUserId: ownerId });
    await publishWorkflowVersion(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, expectedRevision: 2, actorUserId: ownerId });
    const execution = await startWorkflowExecution(db, { organizationId: orgId, definitionId: definition.id, actorUserId: ownerId });

    const nodeExecution = await createNodeExecution(db, { organizationId: orgId, workflowExecutionId: execution.id, workflowNodeId: start.id, attemptNumber: 1 });
    const first = await transitionNodeExecution(db, { organizationId: orgId, nodeExecutionId: nodeExecution.id, expectedRevision: nodeExecution.revision, fromStatuses: ["pending"], toStatus: "succeeded" });
    expect(first).not.toBeNull();

    // Same (now-stale) revision again — must fail, not double-apply.
    const second = await transitionNodeExecution(db, { organizationId: orgId, nodeExecutionId: nodeExecution.id, expectedRevision: nodeExecution.revision, fromStatuses: ["pending"], toStatus: "succeeded" });
    expect(second).toBeNull();
  });
});

describe("workflow human task completion — single-use", () => {
  it("a simultaneous double-completion race lets exactly one attempt succeed", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { definition } = await publishSimpleHumanTaskWorkflow(orgId, ownerId, "HUMANRACE");
    const execution = await startWorkflowExecution(db, { organizationId: orgId, definitionId: definition.id, actorUserId: ownerId });

    // Drive to the human task via the real engine.
    const { driveWorkflowForward, executeWorkflowNodeJob } = await import("./engine");
    const { neon } = await import("@neondatabase/serverless");
    const { loadEnv } = await import("@/lib/env");
    const rawSql = neon(loadEnv().DATABASE_URL);
    await driveWorkflowForward(db, rawSql, { organizationId: orgId, workflowExecutionId: execution.id });
    await executeWorkflowNodeJob(db, rawSql, { organizationId: orgId, workflowExecutionId: execution.id });

    const { listMyWorkflowHumanTasks } = await import("./human-tasks");
    const tasks = await listMyWorkflowHumanTasks(db, { organizationId: orgId, actorUserId: ownerId, status: "pending" });
    expect(tasks).toHaveLength(1);

    const results = await Promise.allSettled([
      completeWorkflowHumanTask(db, { organizationId: orgId, taskId: tasks[0].id, expectedRevision: tasks[0].revision, actorUserId: ownerId }),
      completeWorkflowHumanTask(db, { organizationId: orgId, taskId: tasks[0].id, expectedRevision: tasks[0].revision, actorUserId: ownerId }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
});

describe("workflow execution completion — single-use", () => {
  it("two concurrent attempts to complete the same execution at the same revision let exactly one succeed", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const definition = await createWorkflowDefinition(db, { organizationId: orgId, name: "COMPLETERACE", workflowKey: "COMPLETERACE", actorUserId: ownerId });
    const version = await createWorkflowVersion(db, { organizationId: orgId, definitionId: definition.id, actorUserId: ownerId });
    const start = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "start", nodeType: "start", name: "Start", actorUserId: ownerId });
    const end = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "end", nodeType: "end", name: "End", actorUserId: ownerId });
    await createWorkflowEdge(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, sourceNodeId: start.id, targetNodeId: end.id, actorUserId: ownerId });
    await validateWorkflowVersionAndPersist(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, actorUserId: ownerId });
    await publishWorkflowVersion(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, expectedRevision: 2, actorUserId: ownerId });
    const execution = await startWorkflowExecution(db, { organizationId: orgId, definitionId: definition.id, actorUserId: ownerId });

    // Force it into "running" at a known revision, simulating two racing workers both about to mark it completed.
    const [row] = await db.select().from(workflowExecutions).where(eq(workflowExecutions.id, execution.id));
    const results = await Promise.allSettled([
      transitionWorkflowExecutionStatus(db, execution.id, orgId, row.revision, ["queued", "running"], "completed", { completedAt: new Date() }),
      transitionWorkflowExecutionStatus(db, execution.id, orgId, row.revision, ["queued", "running"], "completed", { completedAt: new Date() }),
    ]);
    const succeeded = results.filter((r) => r.status === "fulfilled" && r.value !== null);
    expect(succeeded).toHaveLength(1);
  });
});

describe("workflow reconciliation — does not enqueue duplicate continuations", () => {
  it("running reconciliation twice against the same stuck execution results in at most one active workflow_continue job", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { definition } = await publishSimpleHumanTaskWorkflow(orgId, ownerId, "RECONCILERACE");
    const execution = await startWorkflowExecution(db, { organizationId: orgId, definitionId: definition.id, actorUserId: ownerId });

    // Force the execution to look stuck: running, stale `updatedAt`, no active job.
    await db.update(workflowExecutions).set({ status: "running", updatedAt: new Date(Date.now() - 24 * 3600 * 1000) }).where(eq(workflowExecutions.id, execution.id));

    await Promise.all([reconcileWorkflows(db, { organizationId: orgId }), reconcileWorkflows(db, { organizationId: orgId })]);

    const activeJobs = await db.select().from(runtimeJobs).where(and(eq(runtimeJobs.workflowExecutionId, execution.id), inArray(runtimeJobs.status, ["queued", "leased", "running", "retry_scheduled"])));
    expect(activeJobs.length).toBeLessThanOrEqual(1);
  });
});
