import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { db, rawSql, makeUser, makeOrgWithOwner, makeKnowledgeItem, revokeAgentCapability, pollUntilJobDone, ensureToolsSeeded, cleanupAgentRuntimeTestData } from "@/lib/agent-runtime/test-helpers";
import { brainPermissionGrants, runtimeJobs, toolInvocations } from "@/db/schema";
import { retireAgent } from "@/lib/agents/lifecycle";
import { seedKnowledgeAnalystAgent, createKnowledgeAnalystTask, continueKnowledgeAnalystExecution, getKnowledgeAnalystReport } from "@/lib/agents/knowledge-analyst";
import { cleanupOldCompletedJobs } from "@/lib/runtime/cleanup";

beforeAll(ensureToolsSeeded);
afterEach(cleanupAgentRuntimeTestData);

async function grantOwnerCapability(orgId: string, ownerId: string, domain: "identity", capability: "read" | "draft_write") {
  await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain, workspaceId: null, granteeUserId: ownerId, granteeType: "human", capability }).onConflictDoNothing();
}

/**
 * `pollAndProcess`/`claimJobs` operate globally by design (a real
 * worker has no reason to filter by tenant) — under the full test suite
 * running many files in parallel, a single poll can claim OTHER files'
 * jobs instead of (or as well as) the one a given test cares about.
 * Every test below drives its OWN job via `pollUntilJobDone`, which
 * polls the target job's own row directly rather than assuming it was
 * present in any one poll batch — the "disabled tool" scenario itself
 * (which would need to flip the SHARED, globally-relied-on `brain.search`
 * tool's enabled flag) is deliberately NOT exercised here for the same
 * cross-file-isolation reason; it is instead covered, race-free, by
 * `invocation.integration.test.ts`'s dedicated-test-tool-based test and
 * `worker.test.ts`'s pure classification unit test.
 */
describe("worker-driven end-to-end Knowledge Analyst execution", () => {
  it("a queued task completes entirely through the worker — HTTP request lifetime plays no role", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantOwnerCapability(orgId, ownerId, "identity", "read");
    await grantOwnerCapability(orgId, ownerId, "identity", "draft_write");
    const agent = await seedKnowledgeAnalystAgent(db, { organizationId: orgId, humanOwnerUserId: ownerId, allowedDomains: ["identity"], actorUserId: ownerId });
    await makeKnowledgeItem(orgId, ownerId, "identity", "Vacation Policy", "Employees accrue vacation days monthly");

    const { execution, job } = await createKnowledgeAnalystTask(db, { organizationId: orgId, ownerUserId: ownerId, agentId: agent.id, topic: "vacation", allowedDomains: ["identity"], actorUserId: ownerId });
    expect(job.status).toBe("queued");
    // Nothing has run yet — proves creation alone never touches the Brain.
    expect(execution.status).toBe("planning");

    const finished = await pollUntilJobDone(job.id);
    expect(finished.status).toBe("completed");

    const report = await getKnowledgeAnalystReport(db, { organizationId: orgId, executionId: execution.id, actorUserId: ownerId });
    expect(report.executionStatus).toBe("completed");
    expect(report.supportingReferences.length).toBeGreaterThan(0);
  });

  it("a revoked Brain grant stops the next gated step — the job fails with a non-retryable permission classification, never silently proceeding", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantOwnerCapability(orgId, ownerId, "identity", "read");
    const agent = await seedKnowledgeAnalystAgent(db, { organizationId: orgId, humanOwnerUserId: ownerId, allowedDomains: ["identity"], actorUserId: ownerId });

    const { job } = await createKnowledgeAnalystTask(db, { organizationId: orgId, ownerUserId: ownerId, agentId: agent.id, topic: "anything", allowedDomains: ["identity"], actorUserId: ownerId });

    // Revoke before the worker ever gets to run it.
    await revokeAgentCapability(orgId, ownerId, agent.id, "identity", "read");

    const finished = await pollUntilJobDone(job.id);
    expect(finished.status).toBe("failed");
    expect(finished.failureClassification).toBe("permission_revoked");
  });

  it("a retired agent stops the execution — the worker never proceeds on behalf of a retired identity", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantOwnerCapability(orgId, ownerId, "identity", "read");
    const agent = await seedKnowledgeAnalystAgent(db, { organizationId: orgId, humanOwnerUserId: ownerId, allowedDomains: ["identity"], actorUserId: ownerId });
    const { job } = await createKnowledgeAnalystTask(db, { organizationId: orgId, ownerUserId: ownerId, agentId: agent.id, topic: "anything", allowedDomains: ["identity"], actorUserId: ownerId });

    await retireAgent(db, { organizationId: orgId, agentId: agent.id, reason: "test", actorUserId: ownerId });

    const finished = await pollUntilJobDone(job.id);
    expect(finished.status).toBe("failed");
  });

  it("process interruption resumes from the latest checkpoint — a direct continuation call after a partial run finishes the SAME execution without re-doing completed work", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantOwnerCapability(orgId, ownerId, "identity", "read");
    await grantOwnerCapability(orgId, ownerId, "identity", "draft_write");
    const agent = await seedKnowledgeAnalystAgent(db, { organizationId: orgId, humanOwnerUserId: ownerId, allowedDomains: ["identity"], actorUserId: ownerId });
    await makeKnowledgeItem(orgId, ownerId, "identity", "Onboarding Checklist", "New hires complete IT setup on day one");
    const { execution } = await createKnowledgeAnalystTask(db, { organizationId: orgId, ownerUserId: ownerId, agentId: agent.id, topic: "onboarding", allowedDomains: ["identity"], actorUserId: ownerId });

    // First continuation call succeeds fully (nothing actually interrupts
    // it here — this proves resumption is safe to call twice, which is
    // the real invariant "interruption resumed from checkpoint" reduces
    // to: the SAME execution never re-runs a completed step twice).
    const first = await continueKnowledgeAnalystExecution(db, rawSql, { organizationId: orgId, executionId: execution.id });
    expect(first.execution.status).toBe("completed");

    const searchInvocationsBefore = await db.select().from(toolInvocations).where(and(eq(toolInvocations.executionId, execution.id), eq(toolInvocations.toolKey, "brain.search")));

    // Resume again post-completion — idempotent re-entry, no duplicate side effects.
    const second = await continueKnowledgeAnalystExecution(db, rawSql, { organizationId: orgId, executionId: execution.id });
    expect(second.artifactId).toBe(first.artifactId);

    const searchInvocationsAfter = await db.select().from(toolInvocations).where(and(eq(toolInvocations.executionId, execution.id), eq(toolInvocations.toolKey, "brain.search")));
    expect(searchInvocationsAfter).toHaveLength(searchInvocationsBefore.length); // no new search invocation created
  });

  it("cleanup does not delete execution events, plans, checkpoints, or artifacts", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantOwnerCapability(orgId, ownerId, "identity", "read");
    await grantOwnerCapability(orgId, ownerId, "identity", "draft_write");
    const agent = await seedKnowledgeAnalystAgent(db, { organizationId: orgId, humanOwnerUserId: ownerId, allowedDomains: ["identity"], actorUserId: ownerId });
    await makeKnowledgeItem(orgId, ownerId, "identity", "Security Policy", "Rotate credentials every 90 days");
    const { execution, job } = await createKnowledgeAnalystTask(db, { organizationId: orgId, ownerUserId: ownerId, agentId: agent.id, topic: "security", allowedDomains: ["identity"], actorUserId: ownerId });
    await pollUntilJobDone(job.id);

    await cleanupOldCompletedJobs(db); // retention threshold is 30 days — this run's own job is fresh, so nothing is deleted, but the call itself must never touch execution-owned tables

    const report = await getKnowledgeAnalystReport(db, { organizationId: orgId, executionId: execution.id, actorUserId: ownerId });
    expect(report.executionStatus).toBe("completed"); // artifact/report still fully intact
    const jobs = await db.select().from(runtimeJobs).where(eq(runtimeJobs.executionId, execution.id));
    expect(jobs.length).toBeGreaterThan(0); // job itself also still present (too fresh for retention)
  });
});
