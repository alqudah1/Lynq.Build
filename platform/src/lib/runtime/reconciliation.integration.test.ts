import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { db, rawSql, makeUser, makeOrgWithOwner, makeAgent, grantAgentCapability, bringExecutionToExecuting, ensureToolsSeeded, cleanupAgentRuntimeTestData } from "@/lib/agent-runtime/test-helpers";
import { agentExecutions, toolInvocations, runtimeJobs } from "@/db/schema";
import { invokeTool } from "@/lib/tools/invocation";
import { reconcileExecutions } from "./reconciliation-executions";
import { reconcileToolInvocations } from "./reconciliation-tool-invocations";
import { enqueueJob } from "./queue";

beforeAll(ensureToolsSeeded);
afterEach(cleanupAgentRuntimeTestData);

describe("reconcileExecutions", () => {
  it("enqueues a resume job for an execution stuck in progress with no active job, past the stuck threshold", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const execution = await bringExecutionToExecuting(orgId, ownerId, agent.id);

    // Force it to look stale without waiting the real threshold out.
    await db.update(agentExecutions).set({ updatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000) }).where(eq(agentExecutions.id, execution.id));

    const { outcomes } = await reconcileExecutions(db, { organizationId: orgId });
    const outcome = outcomes.find((o) => o.executionId === execution.id);
    expect(outcome?.detectedCase).toBe("stuck_in_progress_no_active_job");
    expect(outcome?.action).toBe("enqueue_resume");

    const jobs = await db.select().from(runtimeJobs).where(and(eq(runtimeJobs.executionId, execution.id), eq(runtimeJobs.jobType, "execution_resume")));
    expect(jobs).toHaveLength(1);
  });

  it("never enqueues a duplicate resume job for an execution that already has one active", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const execution = await bringExecutionToExecuting(orgId, ownerId, agent.id);
    await db.update(agentExecutions).set({ updatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000) }).where(eq(agentExecutions.id, execution.id));

    await enqueueJob(db, { organizationId: orgId, jobType: "execution_resume", executionId: execution.id, idempotencyKey: `exec:${execution.id}` });

    const { outcomes } = await reconcileExecutions(db, { organizationId: orgId });
    expect(outcomes.find((o) => o.executionId === execution.id)).toBeUndefined(); // skipped — active job already covers it

    const jobs = await db.select().from(runtimeJobs).where(and(eq(runtimeJobs.executionId, execution.id), eq(runtimeJobs.jobType, "execution_resume")));
    expect(jobs).toHaveLength(1); // still exactly one
  });

  it("leaves a fresh (not stale) in-progress execution alone", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const execution = await bringExecutionToExecuting(orgId, ownerId, agent.id);

    const { outcomes } = await reconcileExecutions(db, { organizationId: orgId });
    expect(outcomes.find((o) => o.executionId === execution.id)).toBeUndefined();
  });

  it("cancels orphaned queued work for an execution that is itself already cancelled", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const execution = await bringExecutionToExecuting(orgId, ownerId, agent.id);
    const job = await enqueueJob(db, { organizationId: orgId, jobType: "execution_resume", executionId: execution.id, idempotencyKey: `exec:${execution.id}` });
    await db.update(agentExecutions).set({ status: "cancelled" }).where(eq(agentExecutions.id, execution.id));

    const { outcomes } = await reconcileExecutions(db, { organizationId: orgId });
    const outcome = outcomes.find((o) => o.executionId === execution.id);
    expect(outcome?.detectedCase).toBe("cancelled_with_queued_work");

    const [row] = await db.select().from(runtimeJobs).where(eq(runtimeJobs.id, job.id));
    expect(row.status).toBe("cancelled");
  });
});

describe("reconcileToolInvocations", () => {
  it("a stuck read-only invocation (no active job) is marked failed, freeing its idempotency key, and a resume job is enqueued", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const execution = await bringExecutionToExecuting(orgId, ownerId, agent.id);
    await grantAgentCapability(orgId, ownerId, agent.id, "identity", "read");

    // Simulate a crash mid-invocation: insert a `running` row directly,
    // never completed by any real `invokeTool` call.
    await db.insert(toolInvocations).values({
      organizationId: orgId,
      executionId: execution.id,
      agentId: agent.id,
      agentVersionNumber: 1,
      toolKey: "brain.search",
      toolVersion: 1,
      status: "running",
      idempotencyKey: "search:identity",
      inputMetadata: { query: "x", domain: "identity" },
    });

    const { outcomes } = await reconcileToolInvocations(db, rawSql, { organizationId: orgId });
    const outcome = outcomes.find((o) => o.executionId === execution.id);
    expect(outcome?.detectedCase).toBe("safe_to_retry");

    const [row] = await db.select().from(toolInvocations).where(and(eq(toolInvocations.executionId, execution.id), eq(toolInvocations.toolKey, "brain.search")));
    expect(row.status).toBe("failed"); // frees the idempotency key

    const jobs = await db.select().from(runtimeJobs).where(and(eq(runtimeJobs.executionId, execution.id), eq(runtimeJobs.jobType, "execution_resume")));
    expect(jobs).toHaveLength(1);
  });

  it("a stuck internal-write invocation with no artifact evidence under its OWN idempotency key is safe to retry, never assumed successful", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "assistant");
    const execution = await bringExecutionToExecuting(orgId, ownerId, agent.id);

    // A stuck row under its OWN idempotency key, with no succeeded
    // sibling anywhere under that same key — reconciliation must not
    // guess success across a DIFFERENT key's evidence.
    await db.insert(toolInvocations).values({
      organizationId: orgId,
      executionId: execution.id,
      agentId: agent.id,
      agentVersionNumber: 1,
      toolKey: "artifact.create_report",
      toolVersion: 1,
      status: "running",
      idempotencyKey: "report",
      inputMetadata: { title: "T" },
    });

    const { outcomes } = await reconcileToolInvocations(db, rawSql, { organizationId: orgId });
    const outcome = outcomes.find((o) => o.executionId === execution.id);
    expect(outcome?.detectedCase).toBe("safe_to_retry");
  });

  it("a genuinely stuck internal-write invocation whose OWN idempotency key already has a succeeded sibling is reconciled to succeeded, never re-executed", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "assistant");
    const execution = await bringExecutionToExecuting(orgId, ownerId, agent.id);

    const result = await invokeTool(db, rawSql, {
      organizationId: orgId,
      executionId: execution.id,
      agentId: agent.id,
      toolKey: "artifact.create_report",
      idempotencyKey: "report",
      toolInput: { title: "T", summary: "s", keyFindings: [], supportingReferences: [], contradictions: [], missingInformation: [] },
    });
    const { artifactId } = result.output as { artifactId: string };

    // Directly manipulate the succeeded row back to `running` — modeling
    // "the write happened, but the row was never durably marked
    // succeeded" (the exact ambiguous case this reconciliation exists
    // for), while an artifact demonstrably already exists under this
    // invocation's own idempotency key.
    await db.update(toolInvocations).set({ status: "running", completedAt: null }).where(and(eq(toolInvocations.executionId, execution.id), eq(toolInvocations.toolKey, "artifact.create_report")));

    const { outcomes } = await reconcileToolInvocations(db, rawSql, { organizationId: orgId });
    const outcome = outcomes.find((o) => o.executionId === execution.id);
    expect(outcome?.detectedCase).toBe("resolved_to_succeeded");

    const [row] = await db.select().from(toolInvocations).where(and(eq(toolInvocations.executionId, execution.id), eq(toolInvocations.toolKey, "artifact.create_report")));
    expect(row.status).toBe("succeeded");
    expect(row.artifactId).toBe(artifactId);
  });

  it("an invocation whose execution still has an active job is left alone — active work in progress", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const execution = await bringExecutionToExecuting(orgId, ownerId, agent.id);
    await grantAgentCapability(orgId, ownerId, agent.id, "identity", "read");
    await enqueueJob(db, { organizationId: orgId, jobType: "execution_resume", executionId: execution.id, idempotencyKey: `exec:${execution.id}` });

    await db.insert(toolInvocations).values({
      organizationId: orgId,
      executionId: execution.id,
      agentId: agent.id,
      agentVersionNumber: 1,
      toolKey: "brain.search",
      toolVersion: 1,
      status: "running",
      idempotencyKey: "search:identity",
      inputMetadata: { query: "x" },
    });

    const { outcomes } = await reconcileToolInvocations(db, rawSql, { organizationId: orgId });
    const outcome = outcomes.find((o) => o.executionId === execution.id);
    expect(outcome?.detectedCase).toBe("active_work_in_progress");

    const [row] = await db.select().from(toolInvocations).where(and(eq(toolInvocations.executionId, execution.id), eq(toolInvocations.toolKey, "brain.search")));
    expect(row.status).toBe("running"); // untouched
  });
});
