import "server-only";
import { and, eq, desc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { runtimeJobs } from "@/db/schema";
import { requireOrganizationMembership, requireOrganizationRole } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { getJob, type RuntimeJob } from "./queue";
import { DeadLetterJobNotRetryableError, InvalidJobTransitionError, RuntimeJobNotFoundError } from "./errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;

async function requireDeadLetterManageAuthority(db: Db, organizationId: string, actorUserId: string): Promise<void> {
  const membership = await requireOrganizationMembership(db, organizationId, actorUserId);
  requireOrganizationRole(membership, ["owner", "admin"]);
}

export async function listDeadLetteredJobs(db: Db, input: { organizationId: string; actorUserId: string }): Promise<RuntimeJob[]> {
  await requireDeadLetterManageAuthority(db, input.organizationId, input.actorUserId);
  return db
    .select()
    .from(runtimeJobs)
    .where(and(eq(runtimeJobs.organizationId, input.organizationId), eq(runtimeJobs.status, "dead_lettered")))
    .orderBy(desc(runtimeJobs.updatedAt));
}

export async function getDeadLetteredJob(db: Db, input: { organizationId: string; jobId: string; actorUserId: string }): Promise<RuntimeJob> {
  await requireDeadLetterManageAuthority(db, input.organizationId, input.actorUserId);
  const job = await getJob(db, input.jobId);
  if (job.organizationId !== input.organizationId || job.status !== "dead_lettered") throw new RuntimeJobNotFoundError();
  return job;
}

/**
 * A human explicitly authorizing a fresh attempt — resets the attempt
 * budget rather than continuing the exhausted one, since a human
 * deciding "try again" after inspecting the failure is a deliberate new
 * decision, not a continuation of the automatic retry policy that gave
 * up. Revision-guarded so two concurrent manual retries on the same
 * dead-lettered job can only ever have one winner ("dead-letter retry is
 * single-use").
 */
export async function retryDeadLetteredJob(db: Db, input: { organizationId: string; jobId: string; actorUserId: string }): Promise<RuntimeJob> {
  await requireDeadLetterManageAuthority(db, input.organizationId, input.actorUserId);
  const job = await getJob(db, input.jobId);
  if (job.organizationId !== input.organizationId) throw new RuntimeJobNotFoundError();
  if (job.status !== "dead_lettered") throw new DeadLetterJobNotRetryableError(`job is "${job.status}", not dead-lettered`);
  if (job.failureClassification === "cancelled") throw new DeadLetterJobNotRetryableError("the underlying work was cancelled — retrying is not safe");

  const [updated] = await db
    .update(runtimeJobs)
    .set({
      status: "queued",
      attemptCount: 0,
      availableAt: new Date(),
      failureClassification: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      requiresHumanReview: false,
      leaseOwner: null,
      leaseExpiresAt: null,
      revision: job.revision + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(runtimeJobs.id, job.id), eq(runtimeJobs.revision, job.revision), eq(runtimeJobs.status, "dead_lettered")))
    .returning();

  if (!updated) throw new DeadLetterJobNotRetryableError("this job was already retried or modified concurrently");

  await recordAuditEvent(db, { eventType: "runtime_job_enqueued", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "runtime_job", targetId: job.id, metadata: { jobType: job.jobType, manualDeadLetterRetry: true } });
  return updated;
}

export async function cancelDeadLetteredJob(db: Db, input: { organizationId: string; jobId: string; actorUserId: string }): Promise<RuntimeJob> {
  await requireDeadLetterManageAuthority(db, input.organizationId, input.actorUserId);
  const job = await getJob(db, input.jobId);
  if (job.organizationId !== input.organizationId) throw new RuntimeJobNotFoundError();
  if (job.status !== "dead_lettered") throw new InvalidJobTransitionError(job.status, "cancelled");

  const [updated] = await db
    .update(runtimeJobs)
    .set({ status: "cancelled", completedAt: new Date(), revision: job.revision + 1, updatedAt: new Date() })
    .where(and(eq(runtimeJobs.id, job.id), eq(runtimeJobs.revision, job.revision)))
    .returning();
  if (!updated) throw new InvalidJobTransitionError(job.status, "cancelled");

  await recordAuditEvent(db, { eventType: "runtime_job_cancelled", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "runtime_job", targetId: job.id, metadata: { jobType: job.jobType, fromDeadLetter: true } });
  return updated;
}
