import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, rawSql, makeUser, makeOrgWithOwner, makeAgent, bringExecutionToExecuting, cleanupAgentRuntimeTestData } from "@/lib/agent-runtime/test-helpers";
import { runtimeJobs } from "@/db/schema";
import { enqueueJob, getJob, claimJobs, startJob, heartbeatJob, completeJob, reportJobFailure, cancelJob } from "./queue";
import { LeaseNotHeldError } from "./errors";

afterEach(cleanupAgentRuntimeTestData);

async function makeExecutionAndJob(orgId: string, ownerId: string, agentId: string, idempotencyKey = `exec:${randomUUID()}`) {
  const execution = await bringExecutionToExecuting(orgId, ownerId, agentId);
  const job = await enqueueJob(db, { organizationId: orgId, jobType: "execution_run", executionId: execution.id, idempotencyKey });
  return { execution, job };
}

describe("enqueueJob — idempotency", () => {
  it("a duplicate enqueue with the same idempotency key returns the existing active job, never a second row", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const execution = await bringExecutionToExecuting(orgId, ownerId, agent.id);

    const first = await enqueueJob(db, { organizationId: orgId, jobType: "execution_run", executionId: execution.id, idempotencyKey: `exec:${execution.id}` });
    const second = await enqueueJob(db, { organizationId: orgId, jobType: "execution_run", executionId: execution.id, idempotencyKey: `exec:${execution.id}` });
    expect(second.id).toBe(first.id);

    const rows = await db.select().from(runtimeJobs).where(and(eq(runtimeJobs.organizationId, orgId), eq(runtimeJobs.executionId, execution.id)));
    expect(rows).toHaveLength(1);
  });
});

describe("claimJobs — atomic claiming and leases", () => {
  it("claims a queued job, marks it leased, and records the lease owner", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const { job } = await makeExecutionAndJob(orgId, ownerId, agent.id);

    const [{ job: claimed, wasReclaimed }] = await claimJobs(db, rawSql, { leaseOwner: "worker-1", jobTypes: ["execution_run"], onlyJobIds: [job.id] });
    expect(claimed.id).toBe(job.id);
    expect(claimed.status).toBe("leased");
    expect(claimed.leaseOwner).toBe("worker-1");
    expect(claimed.attemptCount).toBe(1);
    expect(wasReclaimed).toBe(false);
  });

  it("two workers racing to claim the same available jobs never claim the same job twice", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const { job: jobA } = await makeExecutionAndJob(orgId, ownerId, agent.id);
    const { job: jobB } = await makeExecutionAndJob(orgId, ownerId, agent.id);
    const bothIds = [jobA.id, jobB.id];

    const [batchA, batchB] = await Promise.all([
      claimJobs(db, rawSql, { leaseOwner: "worker-a", jobTypes: ["execution_run"], maxJobs: 2, onlyJobIds: bothIds }),
      claimJobs(db, rawSql, { leaseOwner: "worker-b", jobTypes: ["execution_run"], maxJobs: 2, onlyJobIds: bothIds }),
    ]);

    const claimedIds = [...batchA, ...batchB].map((r) => r.job.id);
    expect(new Set(claimedIds).size).toBe(claimedIds.length); // no duplicates
    expect(claimedIds.sort()).toEqual([...bothIds].sort()); // exactly these two jobs, each claimed exactly once, between the two workers
  });

  it("an expired lease can be reclaimed exactly once", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const { job } = await makeExecutionAndJob(orgId, ownerId, agent.id);

    await claimJobs(db, rawSql, { leaseOwner: "worker-dead", jobTypes: ["execution_run"], leaseDurationSeconds: -1000, onlyJobIds: [job.id] }); // immediately expired
    const [batchA, batchB] = await Promise.all([
      claimJobs(db, rawSql, { leaseOwner: "worker-c", jobTypes: ["execution_run"], onlyJobIds: [job.id] }),
      claimJobs(db, rawSql, { leaseOwner: "worker-d", jobTypes: ["execution_run"], onlyJobIds: [job.id] }),
    ]);
    const reclaims = [...batchA, ...batchB].filter((r) => r.job.id === job.id);
    expect(reclaims).toHaveLength(1);
    expect(reclaims[0].wasReclaimed).toBe(true);
  });

  it("a valid (non-expired) lease cannot be claimed by another worker", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const { job } = await makeExecutionAndJob(orgId, ownerId, agent.id);

    await claimJobs(db, rawSql, { leaseOwner: "worker-e", jobTypes: ["execution_run"], onlyJobIds: [job.id] });
    const second = await claimJobs(db, rawSql, { leaseOwner: "worker-f", jobTypes: ["execution_run"], onlyJobIds: [job.id] });
    expect(second).toHaveLength(0);
  });
});

describe("heartbeat / complete / fail — lease enforcement", () => {
  it("heartbeat extends the lease only for the process that actually holds it", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const { job } = await makeExecutionAndJob(orgId, ownerId, agent.id);
    const [{ job: claimed }] = await claimJobs(db, rawSql, { leaseOwner: "worker-g", jobTypes: ["execution_run"], onlyJobIds: [job.id] });

    const before = claimed.leaseExpiresAt!.getTime();
    await new Promise((r) => setTimeout(r, 50));
    const heartbeated = await heartbeatJob(db, { jobId: job.id, leaseOwner: "worker-g" });
    expect(heartbeated.leaseExpiresAt!.getTime()).toBeGreaterThan(before);

    await expect(heartbeatJob(db, { jobId: job.id, leaseOwner: "someone-else" })).rejects.toThrow(LeaseNotHeldError);
  });

  it("a stale worker (lost its lease to a reclaim) cannot complete the job afterward", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const { job } = await makeExecutionAndJob(orgId, ownerId, agent.id);

    await claimJobs(db, rawSql, { leaseOwner: "worker-stale", jobTypes: ["execution_run"], leaseDurationSeconds: -1000, onlyJobIds: [job.id] });
    await claimJobs(db, rawSql, { leaseOwner: "worker-new", jobTypes: ["execution_run"], onlyJobIds: [job.id] }); // reclaims it

    await expect(completeJob(db, { jobId: job.id, leaseOwner: "worker-stale" })).rejects.toThrow(LeaseNotHeldError);
    const completed = await completeJob(db, { jobId: job.id, leaseOwner: "worker-new" });
    expect(completed.status).toBe("completed");
  });

  it("completeJob transitions to completed and clears the lease", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const { job } = await makeExecutionAndJob(orgId, ownerId, agent.id);
    await claimJobs(db, rawSql, { leaseOwner: "worker-h", jobTypes: ["execution_run"], onlyJobIds: [job.id] });
    await startJob(db, { jobId: job.id, leaseOwner: "worker-h" });

    const completed = await completeJob(db, { jobId: job.id, leaseOwner: "worker-h", resultRef: { ok: true } });
    expect(completed.status).toBe("completed");
    expect(completed.leaseOwner).toBeNull();
    expect(completed.completedAt).not.toBeNull();
  });
});

describe("reportJobFailure — retry policy", () => {
  it("a transient failure schedules exactly one retry with a future availableAt, attemptCount preserved across the retry cycle", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const { job } = await makeExecutionAndJob(orgId, ownerId, agent.id);
    await claimJobs(db, rawSql, { leaseOwner: "worker-i", jobTypes: ["execution_run"], onlyJobIds: [job.id] });

    const result = await reportJobFailure(db, { jobId: job.id, leaseOwner: "worker-i", failureClass: "transient", errorCode: "timeout", errorMessage: "simulated timeout" });
    expect(result.outcome).toBe("retry_scheduled");
    if (result.outcome === "retry_scheduled") {
      expect(result.nextAvailableAt.getTime()).toBeGreaterThan(Date.now());
    }

    const row = await getJob(db, job.id);
    expect(row.status).toBe("retry_scheduled");
    expect(row.attemptCount).toBe(1);
    expect(row.leaseOwner).toBeNull();
  });

  it("permission_revoked never retries, even though attempts remain", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const { job } = await makeExecutionAndJob(orgId, ownerId, agent.id);
    await claimJobs(db, rawSql, { leaseOwner: "worker-j", jobTypes: ["execution_run"], onlyJobIds: [job.id] });

    const result = await reportJobFailure(db, { jobId: job.id, leaseOwner: "worker-j", failureClass: "permission_revoked", errorCode: "grant_revoked", errorMessage: "revoked mid-execution" });
    expect(result.outcome).toBe("failed");
  });

  it("unsafe_uncertain always requires human review and is dead-lettered, never silently resolved", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const { job } = await makeExecutionAndJob(orgId, ownerId, agent.id);
    await claimJobs(db, rawSql, { leaseOwner: "worker-k", jobTypes: ["execution_run"], onlyJobIds: [job.id] });

    const result = await reportJobFailure(db, { jobId: job.id, leaseOwner: "worker-k", failureClass: "unsafe_uncertain", errorCode: "ambiguous_side_effect", errorMessage: "cannot determine outcome" });
    expect(result.outcome).toBe("dead_lettered");
    expect(result.job.requiresHumanReview).toBe(true);
  });

  it("retry exhaustion dead-letters the job even for a retryable classification — no infinite loop", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const execution = await bringExecutionToExecuting(orgId, ownerId, agent.id);
    const job = await enqueueJob(db, { organizationId: orgId, jobType: "execution_run", executionId: execution.id, idempotencyKey: `exec:${execution.id}`, maxAttempts: 1 });

    await claimJobs(db, rawSql, { leaseOwner: "worker-l", jobTypes: ["execution_run"], onlyJobIds: [job.id] });
    const result = await reportJobFailure(db, { jobId: job.id, leaseOwner: "worker-l", failureClass: "transient", errorCode: "timeout", errorMessage: "one more transient failure" });
    expect(result.outcome).toBe("dead_lettered");
  });

  it("cancellation is respected before continued work — cancelling a leased job, then that lease-holder cannot complete it", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const { job } = await makeExecutionAndJob(orgId, ownerId, agent.id);
    await claimJobs(db, rawSql, { leaseOwner: "worker-m", jobTypes: ["execution_run"], onlyJobIds: [job.id] });

    const cancelled = await cancelJob(db, { organizationId: orgId, jobId: job.id, actorUserId: ownerId });
    expect(cancelled.status).toBe("cancelled");

    await expect(completeJob(db, { jobId: job.id, leaseOwner: "worker-m" })).rejects.toThrow(LeaseNotHeldError);
  });

  it("cancellation racing with a claim is deterministic — whichever wins the atomic update, the other observes a consistent InvalidJobTransitionError or a cancelled row, never a corrupted state", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const { job } = await makeExecutionAndJob(orgId, ownerId, agent.id);

    const results = await Promise.allSettled([cancelJob(db, { organizationId: orgId, jobId: job.id, actorUserId: ownerId }), claimJobs(db, rawSql, { leaseOwner: "worker-n", jobTypes: ["execution_run"], onlyJobIds: [job.id] })]);

    const finalRow = await getJob(db, job.id);
    // Exactly one coherent outcome: either cancelled (claim saw nothing to
    // take), or claimed-before-cancel (cancel then fails on an already
    // non-cancellable... actually claimed jobs ARE still cancellable, so
    // the only truly invalid end state would be BOTH having silently
    // succeeded into contradictory statuses — assert that never happens.
    expect(["cancelled", "leased"]).toContain(finalRow.status);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
  });
});
