import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, ensureToolsSeeded, seedAnalystForWorkflowTests } from "./test-helpers";
import { createWorkflowDefinition } from "./definitions";
import { createWorkflowVersion } from "./versions";
import { createWorkflowNode } from "./nodes";
import { createWorkflowEdge } from "./edges";
import { validateWorkflowGraph } from "./graph-validation";

beforeAll(ensureToolsSeeded);
afterEach(cleanupAgentRuntimeTestData);

async function setup(name: string) {
  const ownerId = await makeUser();
  const orgId = await makeOrgWithOwner(ownerId);
  const definition = await createWorkflowDefinition(db, { organizationId: orgId, name, workflowKey: name.toUpperCase().replace(/[^A-Z0-9]/g, "_").slice(0, 30), actorUserId: ownerId });
  const version = await createWorkflowVersion(db, { organizationId: orgId, definitionId: definition.id, actorUserId: ownerId });
  return { ownerId, orgId, definition, version };
}

describe("validateWorkflowGraph", () => {
  it("fails when the version has no nodes at all", async () => {
    const { orgId, version } = await setup("no-nodes");
    const result = await validateWorkflowGraph(db, { organizationId: orgId, versionId: version.id });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => /no nodes/.test(i.message))).toBe(true);
  });

  it("fails when there is no start node (but other nodes exist)", async () => {
    const { orgId, ownerId, definition, version } = await setup("no-start");
    await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "end", nodeType: "end", name: "End", actorUserId: ownerId });
    const result = await validateWorkflowGraph(db, { organizationId: orgId, versionId: version.id });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => /exactly one start node/.test(i.message))).toBe(true);
  });

  it("fails when there is no end node", async () => {
    const { orgId, ownerId, definition, version } = await setup("no-end");
    await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "start", nodeType: "start", name: "Start", actorUserId: ownerId });
    const result = await validateWorkflowGraph(db, { organizationId: orgId, versionId: version.id });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => /at least one end node/.test(i.message))).toBe(true);
  });

  it("fails when a node is unreachable from start", async () => {
    const { orgId, ownerId, definition, version } = await setup("unreachable");
    const start = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "start", nodeType: "start", name: "Start", actorUserId: ownerId });
    const end = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "end", nodeType: "end", name: "End", actorUserId: ownerId });
    await createWorkflowEdge(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, sourceNodeId: start.id, targetNodeId: end.id, actorUserId: ownerId });
    // Orphan node with no incoming edge from start.
    await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "orphan", nodeType: "wait", name: "Orphan", configuration: { durationSeconds: 10 }, actorUserId: ownerId });

    const result = await validateWorkflowGraph(db, { organizationId: orgId, versionId: version.id });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.nodeKey === "orphan" && /unreachable/.test(i.message))).toBe(true);
  });

  it("fails on an unsupported graph cycle", async () => {
    const { orgId, ownerId, definition, version } = await setup("cycle");
    const start = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "start", nodeType: "start", name: "Start", actorUserId: ownerId });
    const wait1 = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "wait1", nodeType: "wait", name: "Wait 1", configuration: { durationSeconds: 10 }, actorUserId: ownerId });
    const wait2 = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "wait2", nodeType: "wait", name: "Wait 2", configuration: { durationSeconds: 10 }, actorUserId: ownerId });
    await createWorkflowEdge(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, sourceNodeId: start.id, targetNodeId: wait1.id, actorUserId: ownerId });
    await createWorkflowEdge(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, sourceNodeId: wait1.id, targetNodeId: wait2.id, actorUserId: ownerId });
    await createWorkflowEdge(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, sourceNodeId: wait2.id, targetNodeId: wait1.id, actorUserId: ownerId });

    const result = await validateWorkflowGraph(db, { organizationId: orgId, versionId: version.id });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => /cycle/.test(i.message))).toBe(true);
  });

  it("fails when a condition node's configuration is invalid (defense in depth — validated independently of node-creation-time validation)", async () => {
    const { orgId, ownerId, definition, version } = await setup("bad-condition");
    const start = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "start", nodeType: "start", name: "Start", actorUserId: ownerId });
    const end = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "end", nodeType: "end", name: "End", actorUserId: ownerId });

    // `createWorkflowNode` itself already rejects this at creation time (proven by its own service-layer test) — inserted directly here to exercise `validateWorkflowGraph`'s OWN independent re-check against whatever is actually stored, not merely trusting that every row was written through the one service function that validates on the way in.
    const { workflowNodes } = await import("@/db/schema");
    const { randomUUID } = await import("node:crypto");
    const [cond] = await db
      .insert(workflowNodes)
      .values({ id: randomUUID(), organizationId: orgId, workflowVersionId: version.id, nodeKey: "cond", nodeType: "condition", name: "Cond", configuration: { notBranches: true } })
      .returning();

    await createWorkflowEdge(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, sourceNodeId: start.id, targetNodeId: cond.id, actorUserId: ownerId });
    await createWorkflowEdge(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, sourceNodeId: cond.id, targetNodeId: end.id, conditionKey: "default", actorUserId: ownerId });

    const result = await validateWorkflowGraph(db, { organizationId: orgId, versionId: version.id });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.nodeKey === "cond" && /invalid configuration/.test(i.message))).toBe(true);
  });

  it("fails when an input mapping references a node that is not a predecessor", async () => {
    const { orgId, ownerId, definition, version } = await setup("bad-mapping");
    const start = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "start", nodeType: "start", name: "Start", actorUserId: ownerId });
    const end = await createWorkflowNode(db, {
      organizationId: orgId,
      definitionId: definition.id,
      versionId: version.id,
      nodeKey: "end",
      nodeType: "end",
      name: "End",
      inputMapping: { x: { source: "node_output", nodeKey: "does_not_exist", path: "y" } },
      actorUserId: ownerId,
    });
    await createWorkflowEdge(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, sourceNodeId: start.id, targetNodeId: end.id, actorUserId: ownerId });

    const result = await validateWorkflowGraph(db, { organizationId: orgId, versionId: version.id });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.nodeKey === "end" && /references unknown node/.test(i.message))).toBe(true);
  });

  it("requires a referenced agent to exist and be eligible", async () => {
    const { orgId, ownerId, definition, version } = await setup("bad-agent");
    const start = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "start", nodeType: "start", name: "Start", actorUserId: ownerId });
    const tool = await createWorkflowNode(db, {
      organizationId: orgId,
      definitionId: definition.id,
      versionId: version.id,
      nodeKey: "tool",
      nodeType: "tool_invocation",
      name: "Tool",
      configuration: { agentId: "00000000-0000-0000-0000-000000000000", toolKey: "brain.search" },
      actorUserId: ownerId,
    });
    const end = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "end", nodeType: "end", name: "End", actorUserId: ownerId });
    await createWorkflowEdge(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, sourceNodeId: start.id, targetNodeId: tool.id, actorUserId: ownerId });
    await createWorkflowEdge(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, sourceNodeId: tool.id, targetNodeId: end.id, actorUserId: ownerId });

    const result = await validateWorkflowGraph(db, { organizationId: orgId, versionId: version.id });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.nodeKey === "tool" && /referenced agent does not exist/.test(i.message))).toBe(true);
  });

  it("requires a referenced tool to exist and be enabled", async () => {
    const { orgId, ownerId, definition, version } = await setup("bad-tool");
    const analyst = await seedAnalystForWorkflowTests(orgId, ownerId);
    const start = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "start", nodeType: "start", name: "Start", actorUserId: ownerId });
    const tool = await createWorkflowNode(db, {
      organizationId: orgId,
      definitionId: definition.id,
      versionId: version.id,
      nodeKey: "tool",
      nodeType: "tool_invocation",
      name: "Tool",
      configuration: { agentId: analyst.id, toolKey: "does.not.exist" },
      actorUserId: ownerId,
    });
    const end = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "end", nodeType: "end", name: "End", actorUserId: ownerId });
    await createWorkflowEdge(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, sourceNodeId: start.id, targetNodeId: tool.id, actorUserId: ownerId });
    await createWorkflowEdge(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, sourceNodeId: tool.id, targetNodeId: end.id, actorUserId: ownerId });

    const result = await validateWorkflowGraph(db, { organizationId: orgId, versionId: version.id });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.nodeKey === "tool" && /does not exist or is disabled/.test(i.message))).toBe(true);
  });

  it("rejects an agent_execution node whose configured agent is not eligible for its resolved task type (Module 14)", async () => {
    const { orgId, ownerId, definition, version } = await setup("wrong-agent-driver");
    await seedAnalystForWorkflowTests(orgId, ownerId);
    const { makeAgent } = await import("./test-helpers");
    const otherAgent = await makeAgent(orgId, ownerId);

    const start = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "start", nodeType: "start", name: "Start", actorUserId: ownerId });
    const agentNode = await createWorkflowNode(db, {
      organizationId: orgId,
      definitionId: definition.id,
      versionId: version.id,
      nodeKey: "agent",
      nodeType: "agent_execution",
      name: "Agent",
      configuration: { agentId: otherAgent.id, agentTaskType: "company_knowledge_report" },
      actorUserId: ownerId,
    });
    // Module 14 — a config with a genuinely-ineligible agent can never pass
    // THIS SAME validation function at write time, so this exercises the
    // legacy (pre-Module-14) config shape instead: no `agentTaskType`,
    // which resolves to `company_knowledge_report` and must still be
    // rejected when the referenced agent isn't Company Knowledge Analyst.
    const { workflowNodes } = await import("@/db/schema");
    await db.update(workflowNodes).set({ configuration: { agentId: otherAgent.id, topic: "x", allowedDomains: ["identity"] } }).where(eq(workflowNodes.id, agentNode.id));
    const end = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "end", nodeType: "end", name: "End", actorUserId: ownerId });
    await createWorkflowEdge(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, sourceNodeId: start.id, targetNodeId: agentNode.id, actorUserId: ownerId });
    await createWorkflowEdge(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, sourceNodeId: agentNode.id, targetNodeId: end.id, actorUserId: ownerId });

    const result = await validateWorkflowGraph(db, { organizationId: orgId, versionId: version.id });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.nodeKey === "agent" && /not eligible for agent task type "company_knowledge_report"/.test(i.message))).toBe(true);
  });

  it("passes for a minimal, correct start -> end graph", async () => {
    const { orgId, ownerId, definition, version } = await setup("minimal-valid");
    const start = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "start", nodeType: "start", name: "Start", actorUserId: ownerId });
    const end = await createWorkflowNode(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, nodeKey: "end", nodeType: "end", name: "End", actorUserId: ownerId });
    await createWorkflowEdge(db, { organizationId: orgId, definitionId: definition.id, versionId: version.id, sourceNodeId: start.id, targetNodeId: end.id, actorUserId: ownerId });

    const result = await validateWorkflowGraph(db, { organizationId: orgId, versionId: version.id });
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});
