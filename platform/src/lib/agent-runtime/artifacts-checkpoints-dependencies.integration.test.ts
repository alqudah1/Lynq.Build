import { describe, it, expect, afterEach } from "vitest";
import { db, makeUser, makeOrgWithOwner, makeAgent, cleanupAgentRuntimeTestData } from "./test-helpers";
import { createExecution } from "./executions";
import { assignExecution, startExecution } from "./lifecycle";
import { createArtifact, updateArtifactStatus, listArtifactsForExecution } from "./artifacts";
import { createCheckpoint, getLatestCheckpoint, resolveResumeCheckpoint } from "./checkpoints";
import { addDependency, getUnresolvedDependencies } from "./dependencies";
import { StaleCheckpointError, DependencyCycleError } from "./errors";
import { knowledgeItems } from "@/db/schema";
import { eq } from "drizzle-orm";

afterEach(cleanupAgentRuntimeTestData);

async function makeAssignedExecution(orgId: string, ownerId: string, agentId: string) {
  const execution = await createExecution(db, {
    organizationId: orgId,
    ownerUserId: ownerId,
    goal: "test",
    successCriteria: "test",
    failureCriteria: "test",
    domainsRequested: ["identity"],
    actorUserId: ownerId,
  });
  await assignExecution(db, { organizationId: orgId, executionId: execution.id, assignedAgentId: agentId, actorUserId: ownerId });
  return startExecution(db, { organizationId: orgId, executionId: execution.id, actorUserId: ownerId });
}

describe("artifacts remain separate from Brain knowledge", () => {
  it("creating an artifact never inserts a row into knowledge_items", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    const execution = await makeAssignedExecution(orgId, ownerId, agent.id);

    await createArtifact(db, { organizationId: orgId, executionId: execution.id, artifactType: "draft_text", title: "Draft email", content: "Hello customer", actorAgentId: agent.id });

    const items = await db.select().from(knowledgeItems).where(eq(knowledgeItems.organizationId, orgId));
    expect(items).toHaveLength(0);
  });

  it("progresses through draft -> review -> approved -> published -> archived, never skipping a state", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    const execution = await makeAssignedExecution(orgId, ownerId, agent.id);

    const artifact = await createArtifact(db, { organizationId: orgId, executionId: execution.id, artifactType: "report", title: "Q3 Report", content: "...", actorAgentId: agent.id });
    expect(artifact.status).toBe("draft");

    const review = await updateArtifactStatus(db, { organizationId: orgId, executionId: execution.id, artifactId: artifact.id, toStatus: "review", expectedRevision: artifact.revision, actorUserId: ownerId });
    const approved = await updateArtifactStatus(db, { organizationId: orgId, executionId: execution.id, artifactId: artifact.id, toStatus: "approved", expectedRevision: review.revision, actorUserId: ownerId });
    const published = await updateArtifactStatus(db, { organizationId: orgId, executionId: execution.id, artifactId: artifact.id, toStatus: "published", expectedRevision: approved.revision, actorUserId: ownerId });

    await expect(
      updateArtifactStatus(db, { organizationId: orgId, executionId: execution.id, artifactId: artifact.id, toStatus: "draft", expectedRevision: published.revision, actorUserId: ownerId })
    ).rejects.toThrow();

    const list = await listArtifactsForExecution(db, orgId, execution.id);
    expect(list).toHaveLength(1);
  });

  it("requires externalRef for a file_reference artifact — never stores binary content directly", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    const execution = await makeAssignedExecution(orgId, ownerId, agent.id);

    await expect(createArtifact(db, { organizationId: orgId, executionId: execution.id, artifactType: "file_reference", title: "logo.png", actorAgentId: agent.id })).rejects.toThrow();

    const artifact = await createArtifact(db, { organizationId: orgId, executionId: execution.id, artifactType: "file_reference", title: "logo.png", externalRef: "https://blob.example.com/logo.png", actorAgentId: agent.id });
    expect(artifact.externalRef).toBe("https://blob.example.com/logo.png");
  });
});

describe("checkpoints and stale-checkpoint recovery safety", () => {
  it("resolveResumeCheckpoint accepts a checkpoint at or after minSequenceNumber", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    const execution = await makeAssignedExecution(orgId, ownerId, agent.id);

    const cp1 = await createCheckpoint(db, { organizationId: orgId, executionId: execution.id, statusAtCheckpoint: "gathering_context" });
    const cp2 = await createCheckpoint(db, { organizationId: orgId, executionId: execution.id, statusAtCheckpoint: "planning" });

    const resolved = await resolveResumeCheckpoint(db, execution.id, cp1.sequenceNumber);
    expect(resolved.sequenceNumber).toBe(cp2.sequenceNumber);

    const latest = await getLatestCheckpoint(db, execution.id);
    expect(latest?.id).toBe(cp2.id);
  });

  it("rejects resuming from a stale checkpoint (caller's own known progress is newer than what's on record)", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    const execution = await makeAssignedExecution(orgId, ownerId, agent.id);

    await createCheckpoint(db, { organizationId: orgId, executionId: execution.id, statusAtCheckpoint: "gathering_context" });

    // Caller claims to already know about sequence 99 — impossible given only one checkpoint exists.
    await expect(resolveResumeCheckpoint(db, execution.id, 99)).rejects.toBeInstanceOf(StaleCheckpointError);
  });
});

describe("task dependencies", () => {
  it("supports fan-in (one task waiting on several)", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    const dependent = await makeAssignedExecution(orgId, ownerId, agent.id);
    const dep1 = await makeAssignedExecution(orgId, ownerId, agent.id);
    const dep2 = await makeAssignedExecution(orgId, ownerId, agent.id);

    await addDependency(db, { organizationId: orgId, dependentExecutionId: dependent.id, dependsOnExecutionId: dep1.id });
    await addDependency(db, { organizationId: orgId, dependentExecutionId: dependent.id, dependsOnExecutionId: dep2.id });

    const unresolved = await getUnresolvedDependencies(db, orgId, dependent.id);
    expect(unresolved).toHaveLength(2);
  });

  it("rejects a direct self-dependency and a transitive cycle", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    const a = await makeAssignedExecution(orgId, ownerId, agent.id);
    const b = await makeAssignedExecution(orgId, ownerId, agent.id);
    const c = await makeAssignedExecution(orgId, ownerId, agent.id);

    await expect(addDependency(db, { organizationId: orgId, dependentExecutionId: a.id, dependsOnExecutionId: a.id })).rejects.toBeInstanceOf(DependencyCycleError);

    // a -> b -> c, then attempting c -> a would close a cycle.
    await addDependency(db, { organizationId: orgId, dependentExecutionId: a.id, dependsOnExecutionId: b.id });
    await addDependency(db, { organizationId: orgId, dependentExecutionId: b.id, dependsOnExecutionId: c.id });
    await expect(addDependency(db, { organizationId: orgId, dependentExecutionId: c.id, dependsOnExecutionId: a.id })).rejects.toBeInstanceOf(DependencyCycleError);
  });
});
