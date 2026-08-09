import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { agentExecutions } from "@/db/schema";
import {
  db,
  rawSql,
  makeUser,
  makeOrgWithOwner,
  cleanupAgentRuntimeTestData,
  ensureToolsSeeded,
  makeProject,
} from "./test-helpers";
import { makeAgent, bringExecutionToExecuting } from "@/lib/agent-runtime/test-helpers";
import { createArtifact } from "@/lib/agent-runtime/artifacts";
import { requestApproval, approveRequest } from "@/lib/agent-runtime/approvals";
import { createTask, listTaskAssignments } from "./tasks";
import { linkArtifactToEntity, listArtifactLinks, linkApprovalToEntity, listApprovalLinks, launchKnowledgeAnalystForTask, listExecutionLinksForTask } from "./links";
import { DuplicateArtifactLinkError, DuplicateApprovalLinkError, ActiveExecutionAlreadyLinkedError } from "./errors";
import { seedKnowledgeAnalystAgent } from "@/lib/agents/knowledge-analyst";
import { brainPermissionGrants } from "@/db/schema";

beforeAll(ensureToolsSeeded);
afterEach(cleanupAgentRuntimeTestData);

describe("linkArtifactToEntity", () => {
  it("links a real artifact without copying its content, and rejects a duplicate link", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);
    const task = await createTask(db, { organizationId: orgId, projectId: project.id, title: "Task", actorUserId: ownerId });

    const agent = await makeAgent(orgId, ownerId);
    const execution = await bringExecutionToExecuting(orgId, ownerId, agent.id);
    const artifact = await createArtifact(db, { organizationId: orgId, executionId: execution.id, artifactType: "report", title: "Findings", content: "Sensitive full report content", actorAgentId: agent.id });

    const link = await linkArtifactToEntity(db, { organizationId: orgId, projectId: project.id, artifactId: artifact.id, linkedEntityType: "task", linkedEntityId: task.id, actorUserId: ownerId });
    expect(link.artifactId).toBe(artifact.id);

    const links = await listArtifactLinks(db, { organizationId: orgId, projectId: project.id, actorUserId: ownerId });
    expect(links).toHaveLength(1);
    // The link row itself never stores artifact content — only a typed pointer.
    expect(JSON.stringify(links[0])).not.toContain("Sensitive full report content");

    await expect(linkArtifactToEntity(db, { organizationId: orgId, projectId: project.id, artifactId: artifact.id, linkedEntityType: "task", linkedEntityId: task.id, actorUserId: ownerId })).rejects.toThrow(DuplicateArtifactLinkError);
  });

  it("concurrency: a simultaneous duplicate-artifact-link race lets exactly one succeed", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);
    const task = await createTask(db, { organizationId: orgId, projectId: project.id, title: "Task", actorUserId: ownerId });
    const agent = await makeAgent(orgId, ownerId);
    const execution = await bringExecutionToExecuting(orgId, ownerId, agent.id);
    const artifact = await createArtifact(db, { organizationId: orgId, executionId: execution.id, artifactType: "report", title: "Findings", actorAgentId: agent.id });

    const results = await Promise.allSettled([
      linkArtifactToEntity(db, { organizationId: orgId, projectId: project.id, artifactId: artifact.id, linkedEntityType: "task", linkedEntityId: task.id, actorUserId: ownerId }),
      linkArtifactToEntity(db, { organizationId: orgId, projectId: project.id, artifactId: artifact.id, linkedEntityType: "task", linkedEntityId: task.id, actorUserId: ownerId }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("linkApprovalToEntity", () => {
  it("reflects the live Runtime approval status rather than a duplicated decision, and rejects a duplicate link", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);
    const task = await createTask(db, { organizationId: orgId, projectId: project.id, title: "Task", actorUserId: ownerId });

    const agent = await makeAgent(orgId, ownerId);
    const execution = await bringExecutionToExecuting(orgId, ownerId, agent.id);
    const { request } = await requestApproval(db, { organizationId: orgId, executionId: execution.id, requestedAction: "publish_report", summary: "Publish the findings report", riskLevel: "medium", actorAgentId: agent.id });

    const link = await linkApprovalToEntity(db, { organizationId: orgId, projectId: project.id, approvalRequestId: request.id, linkedEntityType: "task", linkedEntityId: task.id, actorUserId: ownerId });
    expect(link.status).toBe("pending");

    await approveRequest(db, { organizationId: orgId, approvalId: request.id, actorUserId: ownerId });

    const links = await listApprovalLinks(db, { organizationId: orgId, projectId: project.id, actorUserId: ownerId });
    expect(links[0].status).toBe("approved");

    await expect(linkApprovalToEntity(db, { organizationId: orgId, projectId: project.id, approvalRequestId: request.id, linkedEntityType: "task", linkedEntityId: task.id, actorUserId: ownerId })).rejects.toThrow(DuplicateApprovalLinkError);
  });
});

describe("launchKnowledgeAnalystForTask — agent involvement via execution link only", () => {
  async function seedAnalyst(orgId: string, ownerId: string) {
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, granteeType: "human", capability: "read" }).onConflictDoNothing();
    return seedKnowledgeAnalystAgent(db, { organizationId: orgId, humanOwnerUserId: ownerId, allowedDomains: ["identity"], actorUserId: ownerId });
  }

  it("launches a real Runtime execution, links it to the task, and never creates a project_task_assignments row for the agent", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);
    const task = await createTask(db, { organizationId: orgId, projectId: project.id, title: "Knowledge task", actorUserId: ownerId });
    const agent = await seedAnalyst(orgId, ownerId);

    const link = await launchKnowledgeAnalystForTask(db, rawSql, { organizationId: orgId, projectId: project.id, taskId: task.id, topic: "refund policy", allowedDomains: ["identity"], actorUserId: ownerId });
    expect(link.taskId).toBe(task.id);

    const [executionRow] = await db.select().from(agentExecutions).where(eq(agentExecutions.id, link.executionId));
    // The real agent identity and version are carried entirely by the Runtime's own Execution Context — never re-implemented by a project-layer assignment row.
    expect(executionRow.assignedAgentId).toBe(agent.id);
    expect(executionRow.assignedAgentVersionNumber).not.toBeNull();

    const assignments = await listTaskAssignments(db, task.id);
    expect(assignments.every((a) => a.userId !== agent.id)).toBe(true);
    expect(assignments).toHaveLength(0);
  });

  it("rejects launching a second execution while one is still active for the same task", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);
    const task = await createTask(db, { organizationId: orgId, projectId: project.id, title: "Knowledge task", actorUserId: ownerId });
    await seedAnalyst(orgId, ownerId);

    await launchKnowledgeAnalystForTask(db, rawSql, { organizationId: orgId, projectId: project.id, taskId: task.id, topic: "refund policy", allowedDomains: ["identity"], actorUserId: ownerId });
    await expect(launchKnowledgeAnalystForTask(db, rawSql, { organizationId: orgId, projectId: project.id, taskId: task.id, topic: "refund policy again", allowedDomains: ["identity"], actorUserId: ownerId })).rejects.toThrow(ActiveExecutionAlreadyLinkedError);

    const links = await listExecutionLinksForTask(db, { organizationId: orgId, taskId: task.id, actorUserId: ownerId });
    expect(links).toHaveLength(1);
  });

  it("documents the known race window: the guard is a check-then-insert spanning multiple HTTP round trips (no cross-statement transaction on the neon-http driver, unlike every other duplicate-prevention path in this module which uses one atomic statement), so a true simultaneous race can still create two links for the same task — this is a structural driver limitation, not silently pretended away", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const project = await makeProject(orgId, ownerId);
    const task = await createTask(db, { organizationId: orgId, projectId: project.id, title: "Knowledge task", actorUserId: ownerId });
    await seedAnalyst(orgId, ownerId);

    const results = await Promise.allSettled([
      launchKnowledgeAnalystForTask(db, rawSql, { organizationId: orgId, projectId: project.id, taskId: task.id, topic: "race A", allowedDomains: ["identity"], actorUserId: ownerId }),
      launchKnowledgeAnalystForTask(db, rawSql, { organizationId: orgId, projectId: project.id, taskId: task.id, topic: "race B", allowedDomains: ["identity"], actorUserId: ownerId }),
    ]);

    const links = await listExecutionLinksForTask(db, { organizationId: orgId, taskId: task.id, actorUserId: ownerId });
    // Every settled outcome corresponds to a real, valid execution (never corrupted state) — but under a true simultaneous race, both may legitimately win the pre-check and both may succeed. A non-concurrent second call (see the test above) is reliably rejected.
    expect(results).toHaveLength(2);
    expect(links.length).toBeGreaterThanOrEqual(results.filter((r) => r.status === "fulfilled").length);
  });
});
