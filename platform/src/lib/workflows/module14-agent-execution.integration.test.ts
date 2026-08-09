import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db, rawSql, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, ensureToolsSeeded, seedAnalystForWorkflowTests, makeAgent } from "./test-helpers";
import { createWorkflowDefinition } from "./definitions";
import { createWorkflowVersion, validateWorkflowVersionAndPersist, publishWorkflowVersion } from "./versions";
import { createWorkflowNode } from "./nodes";
import { createWorkflowEdge } from "./edges";
import { startWorkflowExecution, resolveWorkflowExecutionById } from "./executions";
import { listNodeExecutionsForExecution } from "./node-executions";
import { executeWorkflowNodeJob } from "./engine";
import { reconcileWorkflows } from "./reconciliation";
import { pollAndProcess } from "@/lib/runtime/worker";
import { workflowNodes, workflowNodeExecutions, runtimeJobs } from "@/db/schema";
import { seedSalesAgents } from "@/lib/sales-os/agents";
import { createLead } from "@/lib/crm/leads";

// Module 17 hardening: every test in this file drives a real generic
// `agent_execution` workflow node end-to-end (definition → version → node
// → edge → publish → start → dispatch → Runtime execution lifecycle),
// each many sequential real Neon HTTP round trips. The suite-wide default
// (20s, `vitest.integration.config.mts`) is intentionally NOT raised
// globally — these round trips legitimately take 20–30s+ under normal
// Neon HTTP latency, which the global default was never meant to absorb.
// Scoped to this file only via `vi.setConfig`, not the shared config.
vi.setConfig({ testTimeout: 45000 });

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
 * Like `engine.integration.test.ts`'s own `driveToStatus`, but ALSO polls
 * whatever separate `execution_run` job a `company_knowledge_report`
 * `agent_execution` node's linked Runtime execution is running under —
 * that job is queued against `executionId` (the Runtime execution), not
 * `workflowExecutionId`, since Knowledge Analyst tasks are launched and
 * driven through the ordinary Agent Runtime job path, not a
 * workflow-specific one (see `notifyLinkedWorkflowNodeIfAny` in
 * `worker.ts` for how the workflow itself gets nudged once that job
 * completes).
 */
async function driveToStatus(orgId: string, executionId: string, targetStatuses: string[], maxAttempts = 30) {
  let execution = await resolveWorkflowExecutionById(db, orgId, executionId);
  for (let i = 0; i < maxAttempts && !targetStatuses.includes(execution.status); i++) {
    const linkedRuntimeExecutionIds = (await db.select({ id: workflowNodeExecutions.runtimeExecutionId }).from(workflowNodeExecutions).where(eq(workflowNodeExecutions.workflowExecutionId, executionId)))
      .map((r) => r.id)
      .filter((id): id is string => id !== null);

    const jobIds = new Set<string>();
    const wfJobs = await db.select({ id: runtimeJobs.id }).from(runtimeJobs).where(and(eq(runtimeJobs.workflowExecutionId, executionId), inArray(runtimeJobs.status, ["queued", "retry_scheduled"])));
    wfJobs.forEach((j) => jobIds.add(j.id));
    if (linkedRuntimeExecutionIds.length > 0) {
      const runtimeExecJobs = await db.select({ id: runtimeJobs.id }).from(runtimeJobs).where(and(inArray(runtimeJobs.executionId, linkedRuntimeExecutionIds), inArray(runtimeJobs.status, ["queued", "retry_scheduled"])));
      runtimeExecJobs.forEach((j) => jobIds.add(j.id));
    }
    if (jobIds.size > 0) {
      await pollAndProcess(db, rawSql, { leaseOwner: `test-worker:${executionId}:${i}`, onlyJobIds: [...jobIds] });
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    execution = await resolveWorkflowExecutionById(db, orgId, executionId);
  }
  return execution;
}

/** Builds start -> agent_execution -> end, publishes it, and returns the definition + agent node id. */
async function publishAgentExecutionGraph(orgId: string, ownerId: string, workflowKey: string, agentConfig: Record<string, unknown>, inputMapping: Record<string, unknown> = {}) {
  let agentNodeId = "";
  const definition = await publishGraph(orgId, ownerId, workflowKey, async (definitionId, versionId) => {
    const start = await createWorkflowNode(db, { organizationId: orgId, definitionId, versionId, nodeKey: "start", nodeType: "start", name: "Start", actorUserId: ownerId });
    const agentNode = await createWorkflowNode(db, { organizationId: orgId, definitionId, versionId, nodeKey: "agent", nodeType: "agent_execution", name: "Agent", configuration: agentConfig, inputMapping, actorUserId: ownerId });
    agentNodeId = agentNode.id;
    const end = await createWorkflowNode(db, { organizationId: orgId, definitionId, versionId, nodeKey: "end", nodeType: "end", name: "End", actorUserId: ownerId });
    await createWorkflowEdge(db, { organizationId: orgId, definitionId, versionId, sourceNodeId: start.id, targetNodeId: agentNode.id, actorUserId: ownerId });
    await createWorkflowEdge(db, { organizationId: orgId, definitionId, versionId, sourceNodeId: agentNode.id, targetNodeId: end.id, actorUserId: ownerId });
  });
  return { definition, agentNodeId };
}

describe("Module 14 — generic agent_execution node", () => {
  it("the new generic shape (agentTaskType: company_knowledge_report) completes through the real Knowledge Analyst, same as before", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const analyst = await seedAnalystForWorkflowTests(orgId, ownerId, ["identity"]);

    const { definition } = await publishAgentExecutionGraph(orgId, ownerId, "GENERICKA", { agentId: analyst.id, agentTaskType: "company_knowledge_report" }, { topic: { source: "literal", value: "Generic shape topic" }, allowedDomains: { source: "literal", value: ["identity"] } });

    const execution = await startWorkflowExecution(db, { organizationId: orgId, definitionId: definition.id, actorUserId: ownerId });
    const finalExecution = await driveToStatus(orgId, execution.id, ["completed", "failed"]);
    expect(finalExecution.status).toBe("completed");

    const nodeExecutions = await listNodeExecutionsForExecution(db, execution.id);
    const agentNodeExecution = nodeExecutions.find((ne) => ne.runtimeExecutionId !== null);
    expect(agentNodeExecution?.status).toBe("succeeded");
    expect((agentNodeExecution?.output as { reportArtifactId?: string } | null)?.reportArtifactId).toBeTruthy();
  });

  it("a legacy-shape node (no agentTaskType, published before Module 14) still resolves to company_knowledge_report and completes — never rewritten in place", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const analyst = await seedAnalystForWorkflowTests(orgId, ownerId, ["identity"]);

    const { definition, agentNodeId } = await publishAgentExecutionGraph(orgId, ownerId, "LEGACYSHAPE", { agentId: analyst.id, agentTaskType: "company_knowledge_report" });
    // Simulate a historically-published row: overwrite `configuration` directly with the pre-Module-14 shape, bypassing `createWorkflowNode`'s (current-schema) validation — exactly like a row that was published before this schema changed and is never rewritten.
    await db.update(workflowNodes).set({ configuration: { agentId: analyst.id, topic: "Legacy topic", allowedDomains: ["identity"] } }).where(eq(workflowNodes.id, agentNodeId));

    const execution = await startWorkflowExecution(db, { organizationId: orgId, definitionId: definition.id, actorUserId: ownerId });
    const finalExecution = await driveToStatus(orgId, execution.id, ["completed", "failed"]);
    expect(finalExecution.status).toBe("completed");

    const nodeExecutions = await listNodeExecutionsForExecution(db, execution.id);
    const agentNodeExecution = nodeExecutions.find((ne) => ne.runtimeExecutionId !== null);
    expect(agentNodeExecution?.status).toBe("succeeded");
    expect((agentNodeExecution?.output as { reportArtifactId?: string } | null)?.reportArtifactId).toBeTruthy();
  });

  it("sales_lead_research resolves and completes synchronously through the Lead Research Assistant", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { leadResearchAgent } = await seedSalesAgents(db, { organizationId: orgId, humanOwnerUserId: ownerId, actorUserId: ownerId });
    const lead = await createLead(db, { organizationId: orgId, actorUserId: ownerId });

    const { definition } = await publishAgentExecutionGraph(orgId, ownerId, "GENERICLEADRESEARCH", { agentId: leadResearchAgent.id, agentTaskType: "sales_lead_research" }, { leadId: { source: "workflow_input", path: "leadId" } });

    const execution = await startWorkflowExecution(db, { organizationId: orgId, definitionId: definition.id, input: { leadId: lead.id }, actorUserId: ownerId });
    const finalExecution = await driveToStatus(orgId, execution.id, ["completed", "failed"]);
    expect(finalExecution.status).toBe("completed");

    const nodeExecutions = await listNodeExecutionsForExecution(db, execution.id);
    const agentNodeExecution = nodeExecutions.find((ne) => ne.runtimeExecutionId !== null);
    expect(agentNodeExecution?.status).toBe("succeeded");
    expect((agentNodeExecution?.output as { reportArtifactId?: string } | null)?.reportArtifactId).toBeTruthy();
  });

  it("sales_opportunity_summary resolves and completes synchronously through the Opportunity Summary Assistant", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { opportunitySummaryAgent } = await seedSalesAgents(db, { organizationId: orgId, humanOwnerUserId: ownerId, actorUserId: ownerId });
    const { createOpportunity } = await import("@/lib/crm/opportunities");
    const { makeTestPipeline } = await import("@/lib/crm/test-helpers");
    const { pipeline, newStage } = await makeTestPipeline(orgId, ownerId);
    const opportunity = await createOpportunity(db, { organizationId: orgId, pipelineId: pipeline.id, stageId: newStage.id, name: "Test Opp", actorUserId: ownerId });

    const { definition } = await publishAgentExecutionGraph(orgId, ownerId, "GENERICOPPSUMMARY", { agentId: opportunitySummaryAgent.id, agentTaskType: "sales_opportunity_summary" }, { opportunityId: { source: "workflow_input", path: "opportunityId" } });

    const execution = await startWorkflowExecution(db, { organizationId: orgId, definitionId: definition.id, input: { opportunityId: opportunity.id }, actorUserId: ownerId });
    const finalExecution = await driveToStatus(orgId, execution.id, ["completed", "failed"]);
    expect(finalExecution.status).toBe("completed");
  });

  it("an expectedOutputKey missing from the task's structured output fails the node deterministically", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const analyst = await seedAnalystForWorkflowTests(orgId, ownerId, ["identity"]);

    const { definition } = await publishAgentExecutionGraph(
      orgId,
      ownerId,
      "BADOUTPUTKEY",
      { agentId: analyst.id, agentTaskType: "company_knowledge_report", expectedOutputKey: "somethingThatWillNeverExist" },
      { topic: { source: "literal", value: "topic" }, allowedDomains: { source: "literal", value: ["identity"] } }
    );

    const execution = await startWorkflowExecution(db, { organizationId: orgId, definitionId: definition.id, actorUserId: ownerId });
    const finalExecution = await driveToStatus(orgId, execution.id, ["completed", "failed"]);
    expect(finalExecution.status).toBe("failed");
    expect(finalExecution.failureClassification).toBe("invalid_agent_task_output");
  });

  it("an agent that is not eligible for the declared agentTaskType fails the node deterministically, never launching a Runtime execution", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const analyst = await seedAnalystForWorkflowTests(orgId, ownerId, ["identity"]);
    const otherAgent = await makeAgent(orgId, ownerId);

    // A graph with a genuinely-ineligible agent can never pass publish-time
    // validation (`graph-validation.ts` already checks `isAgentEligible`) —
    // publish normally with the real, eligible agent, then simulate a
    // configuration that has since drifted from what was valid at publish
    // time (e.g. a direct data fix, or an assumption that changed) by
    // updating the published node's `agentId` directly.
    const { definition, agentNodeId } = await publishAgentExecutionGraph(orgId, ownerId, "INELIGIBLEAGENT", { agentId: analyst.id, agentTaskType: "company_knowledge_report" }, { topic: { source: "literal", value: "topic" }, allowedDomains: { source: "literal", value: ["identity"] } });
    await db.update(workflowNodes).set({ configuration: { agentId: otherAgent.id, agentTaskType: "company_knowledge_report" } }).where(eq(workflowNodes.id, agentNodeId));

    const execution = await startWorkflowExecution(db, { organizationId: orgId, definitionId: definition.id, actorUserId: ownerId });
    const finalExecution = await driveToStatus(orgId, execution.id, ["completed", "failed"]);
    expect(finalExecution.status).toBe("failed");
    expect(finalExecution.failureClassification).toBe("agent_task_ineligible");

    const nodeExecutions = await listNodeExecutionsForExecution(db, execution.id);
    expect(nodeExecutions.every((ne) => ne.runtimeExecutionId === null)).toBe(true);
  });

  it("two concurrent dispatch attempts for the same node execution never launch two Runtime executions — one claims, the other is a safe no-op", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const analyst = await seedAnalystForWorkflowTests(orgId, ownerId, ["identity"]);

    const { definition } = await publishAgentExecutionGraph(orgId, ownerId, "CLAIMRACE", { agentId: analyst.id, agentTaskType: "company_knowledge_report" }, { topic: { source: "literal", value: "race topic" }, allowedDomains: { source: "literal", value: ["identity"] } });

    const execution = await startWorkflowExecution(db, { organizationId: orgId, definitionId: definition.id, actorUserId: ownerId });
    // Process exactly the `workflow_start` job (creates the "pending" agent node execution row + queues, but does not yet run, `workflow_node_execute`) — then race two direct dispatch attempts against that same "pending" row exactly as two competing workers claiming the same lease-expired job would.
    await driveToStatus(orgId, execution.id, [], 1);

    await Promise.all([executeWorkflowNodeJob(db, rawSql, { organizationId: orgId, workflowExecutionId: execution.id }), executeWorkflowNodeJob(db, rawSql, { organizationId: orgId, workflowExecutionId: execution.id })]);

    const finalExecution = await driveToStatus(orgId, execution.id, ["completed", "failed"]);
    expect(finalExecution.status).toBe("completed");

    const nodeExecutions = await listNodeExecutionsForExecution(db, execution.id);
    const runtimeExecutionIds = new Set(nodeExecutions.map((ne) => ne.runtimeExecutionId).filter(Boolean));
    expect(runtimeExecutionIds.size).toBe(1);
  });

  it("reconciliation recovers a node execution stuck at claimed 'running' with no runtimeExecutionId, without duplicating the workflow's progress", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const analyst = await seedAnalystForWorkflowTests(orgId, ownerId, ["identity"]);

    const { definition } = await publishAgentExecutionGraph(orgId, ownerId, "STUCKCLAIM", { agentId: analyst.id, agentTaskType: "company_knowledge_report" }, { topic: { source: "literal", value: "stuck topic" }, allowedDomains: { source: "literal", value: ["identity"] } });
    const execution = await startWorkflowExecution(db, { organizationId: orgId, definitionId: definition.id, actorUserId: ownerId });
    // Real claim+launch happen synchronously within one `workflow_node_execute` job — drive to "waiting" first (a real runtimeExecutionId gets set), then revert the row to simulate a process that claimed the attempt and died before `handler.launch` ever persisted that id.
    await driveToStatus(orgId, execution.id, ["waiting", "completed", "failed"], 10);

    const [nodeExecutionRow] = await db.select().from(workflowNodeExecutions).where(and(eq(workflowNodeExecutions.workflowExecutionId, execution.id), eq(workflowNodeExecutions.status, "waiting")));
    expect(nodeExecutionRow).toBeTruthy();
    await db.update(workflowNodeExecutions).set({ status: "running", runtimeExecutionId: null, updatedAt: new Date(Date.now() - 24 * 3600 * 1000) }).where(eq(workflowNodeExecutions.id, nodeExecutionRow.id));
    await db.update(runtimeJobs).set({ status: "completed" }).where(eq(runtimeJobs.workflowExecutionId, execution.id));

    const { outcomes } = await reconcileWorkflows(db, { organizationId: orgId });
    expect(outcomes.some((o) => o.detectedCase === "stuck_node_claim_no_active_job" && o.workflowExecutionId === execution.id)).toBe(true);

    const finalExecution = await driveToStatus(orgId, execution.id, ["completed", "failed"]);
    expect(finalExecution.status).toBe("completed");

    const nodeExecutions = await listNodeExecutionsForExecution(db, execution.id);
    const failedClaim = nodeExecutions.find((ne) => ne.status === "failed" && ne.failureClassification === "claim_timeout");
    expect(failedClaim).toBeTruthy();
    const succeeded = nodeExecutions.filter((ne) => ne.status === "succeeded" && ne.runtimeExecutionId !== null);
    expect(succeeded).toHaveLength(1);
  });
});
