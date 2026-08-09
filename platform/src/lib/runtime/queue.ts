import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { runtimeJobs } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { requireOrganizationMembership, requireOrganizationRole } from "@/lib/authz/helpers";
import { RUNTIME_CONFIG } from "./config";
import { RETRYABLE_JOB_FAILURE_CLASSES, type JobFailureClass, type RuntimeJobType } from "./validation";
import { RuntimeJobNotFoundError, LeaseNotHeldError, InvalidJobTransitionError } from "./errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;
type RawSql = NeonQueryFunction<false, false>;

/**
 * ============================================================================
 * Durable Postgres-backed job queue — Module 9
 * ============================================================================
 * One row persists across every attempt of a logical job; `attemptCount`
 * increments in place rather than a new row per retry. Claiming uses a
 * single atomic `UPDATE ... FROM (SELECT ... FOR UPDATE SKIP LOCKED)`
 * statement — no in-memory lock, no second queue architecture.
 */

export type RuntimeJob = typeof runtimeJobs.$inferSelect;

async function recordWorkerDenied(db: Db, detail: string, jobId?: string): Promise<void> {
  await recordAuditEvent(db, { eventType: "runtime_worker_permission_denied", targetType: "runtime_job", targetId: jobId ?? null, metadata: { detail } });
}

export interface EnqueueJobInput {
  organizationId: string | null;
  workspaceId?: string | null;
  jobType: RuntimeJobType;
  executionId?: string | null;
  toolInvocationId?: string | null;
  /** Module 11 — set for the 4 `workflow_*` job types; null for every other job type. */
  workflowExecutionId?: string | null;
  idempotencyKey: string;
  priority?: number;
  availableAt?: Date;
  maxAttempts?: number;
}

/**
 * Enqueues one job. If an active job already exists under the same
 * (organizationId, jobType, idempotencyKey) — the partial unique index's
 * exact scope — the existing row is returned instead of erroring
 * (idempotent enqueue: "duplicate task requests reuse the existing
 * queued execution when idempotency matches").
 */
export async function enqueueJob(db: Db, input: EnqueueJobInput): Promise<RuntimeJob> {
  const id = randomUUID();
  try {
    const [row] = await db
      .insert(runtimeJobs)
      .values({
        id,
        organizationId: input.organizationId,
        workspaceId: input.workspaceId ?? null,
        jobType: input.jobType,
        executionId: input.executionId ?? null,
        toolInvocationId: input.toolInvocationId ?? null,
        workflowExecutionId: input.workflowExecutionId ?? null,
        idempotencyKey: input.idempotencyKey,
        priority: input.priority ?? 0,
        availableAt: input.availableAt ?? new Date(),
        maxAttempts: input.maxAttempts ?? RUNTIME_CONFIG.defaultMaxAttempts,
      })
      .returning();

    await recordAuditEvent(db, {
      eventType: "runtime_job_enqueued",
      organizationId: input.organizationId ?? undefined,
      targetType: "runtime_job",
      targetId: row.id,
      metadata: { jobType: input.jobType, executionId: input.executionId ?? null, idempotencyKey: input.idempotencyKey },
    });

    return row;
  } catch (err) {
    if (!isPostgresUniqueViolation(err)) throw err;

    const [existing] = await db
      .select()
      .from(runtimeJobs)
      .where(
        input.organizationId
          ? and(eq(runtimeJobs.organizationId, input.organizationId), eq(runtimeJobs.jobType, input.jobType), eq(runtimeJobs.idempotencyKey, input.idempotencyKey))
          : and(eq(runtimeJobs.jobType, input.jobType), eq(runtimeJobs.idempotencyKey, input.idempotencyKey))
      );
    if (!existing) throw err;
    return existing;
  }
}

export async function getJob(db: Db, jobId: string): Promise<RuntimeJob> {
  const [row] = await db.select().from(runtimeJobs).where(eq(runtimeJobs.id, jobId));
  if (!row) throw new RuntimeJobNotFoundError();
  return row;
}

/**
 * The one atomic claim operation every worker call goes through. A
 * single statement does three things at once: (1) selects eligible rows
 * — freshly `queued`/`retry_scheduled` with `availableAt` passed, OR
 * `leased`/`running` with an expired lease (past `leaseExpiresAt` +
 * `reclaimGraceSeconds`) — with `FOR UPDATE SKIP LOCKED` so two
 * concurrent claim calls can never select the same row; (2) marks them
 * `leased` under the caller's own `leaseOwner`; (3) returns each row's
 * PRIOR status via a CTE, letting the caller distinguish a fresh claim
 * from a reclaim for audit purposes without a second round trip (and
 * without a second, racy query).
 */
export async function claimJobs(
  db: Db,
  rawSql: RawSql,
  input: { leaseOwner: string; jobTypes: RuntimeJobType[]; maxJobs?: number; leaseDurationSeconds?: number; onlyJobIds?: string[] }
): Promise<Array<{ job: RuntimeJob; wasReclaimed: boolean }>> {
  const maxJobs = input.maxJobs ?? RUNTIME_CONFIG.maxJobsPerPoll;
  const leaseDurationSeconds = input.leaseDurationSeconds ?? RUNTIME_CONFIG.leaseDurationSeconds;
  const graceSeconds = RUNTIME_CONFIG.reclaimGraceSeconds;
  // Real workers never set this — they poll broadly, by design. It
  // exists so a caller that already knows exactly which job(s) it wants
  // (a targeted "process this one now" action, or a test asserting on
  // its own job under heavy concurrent queue activity from unrelated
  // work) can claim deterministically without racing everything else
  // currently eligible. `null` (never an empty array) means "no filter."
  const onlyJobIds = input.onlyJobIds && input.onlyJobIds.length > 0 ? input.onlyJobIds : null;

  // The raw statement's only job is the atomic claim itself plus each
  // row's PRIOR status (for the reclaim-vs-fresh distinction below) — it
  // deliberately returns only `id`/`previous_status`, not `rj.*`.
  // `neon`'s tagged-template driver returns raw Postgres column names
  // (snake_case), never Drizzle's camelCase-mapped shape, so the actual
  // typed rows are re-fetched immediately after via the normal
  // schema-aware query builder instead of hand-casting a raw result.
  const claimed = (await rawSql`
    WITH candidates AS (
      SELECT id, status AS previous_status
      FROM runtime_jobs
      WHERE job_type = ANY(${input.jobTypes})
        AND attempt_count < max_attempts
        AND (${onlyJobIds}::uuid[] IS NULL OR id = ANY(${onlyJobIds}::uuid[]))
        AND (
          (status IN ('queued', 'retry_scheduled') AND available_at <= now())
          OR (status IN ('leased', 'running') AND lease_expires_at < now() - (${graceSeconds} || ' seconds')::interval)
        )
      ORDER BY priority DESC, available_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${maxJobs}
    )
    UPDATE runtime_jobs rj
    SET status = 'leased',
        lease_owner = ${input.leaseOwner},
        lease_expires_at = now() + (${leaseDurationSeconds} || ' seconds')::interval,
        heartbeat_at = now(),
        attempt_count = rj.attempt_count + 1,
        revision = rj.revision + 1,
        updated_at = now()
    FROM candidates c
    WHERE rj.id = c.id
    RETURNING rj.id, c.previous_status
  `) as Array<{ id: string; previous_status: string }>;

  if (claimed.length === 0) return [];

  const previousStatusById = new Map(claimed.map((row) => [row.id, row.previous_status]));
  const jobRows = await db.select().from(runtimeJobs).where(
    inArray(
      runtimeJobs.id,
      claimed.map((row) => row.id)
    )
  );

  const results = jobRows.map((job) => ({ job, wasReclaimed: previousStatusById.get(job.id) === "leased" || previousStatusById.get(job.id) === "running" }));

  for (const { job, wasReclaimed } of results) {
    await recordAuditEvent(db, {
      eventType: wasReclaimed ? "runtime_job_reclaimed" : "runtime_job_leased",
      organizationId: job.organizationId ?? undefined,
      targetType: "runtime_job",
      targetId: job.id,
      metadata: { jobType: job.jobType, leaseOwner: input.leaseOwner, attemptCount: job.attemptCount, wasReclaimed },
    });
  }

  return results;
}

function requireLeaseHeld(job: RuntimeJob, leaseOwner: string): void {
  if (job.leaseOwner !== leaseOwner || job.status === "completed" || job.status === "failed" || job.status === "cancelled" || job.status === "dead_lettered") {
    throw new LeaseNotHeldError();
  }
}

/** `leased -> running` — the worker has actually begun processing (as opposed to merely holding a fresh lease). */
export async function startJob(db: Db, input: { jobId: string; leaseOwner: string }): Promise<RuntimeJob> {
  const job = await getJob(db, input.jobId);
  requireLeaseHeld(job, input.leaseOwner);
  if (job.status !== "leased") throw new InvalidJobTransitionError(job.status, "running");

  const [updated] = await db
    .update(runtimeJobs)
    .set({ status: "running", revision: job.revision + 1, updatedAt: new Date() })
    .where(and(eq(runtimeJobs.id, job.id), eq(runtimeJobs.leaseOwner, input.leaseOwner), eq(runtimeJobs.revision, job.revision)))
    .returning();
  if (!updated) throw new LeaseNotHeldError();

  await recordAuditEvent(db, { eventType: "runtime_job_started", organizationId: job.organizationId ?? undefined, targetType: "runtime_job", targetId: job.id, metadata: { jobType: job.jobType } });
  return updated;
}

/**
 * Extends the lease — only honored for the exact process that holds it.
 * Deliberately does NOT write an audit event on every call (task's own
 * "avoid logging every heartbeat into the global audit table" policy) —
 * `heartbeatAt` on the row itself, visible via the status/inspection
 * APIs, is the operational record; see `MODULE_9_RUNTIME_OPERATIONS.md`
 * for the documented policy.
 */
export async function heartbeatJob(db: Db, input: { jobId: string; leaseOwner: string; leaseDurationSeconds?: number }): Promise<RuntimeJob> {
  const job = await getJob(db, input.jobId);
  requireLeaseHeld(job, input.leaseOwner);

  const [updated] = await db
    .update(runtimeJobs)
    .set({ heartbeatAt: new Date(), leaseExpiresAt: new Date(Date.now() + (input.leaseDurationSeconds ?? RUNTIME_CONFIG.leaseDurationSeconds) * 1000), updatedAt: new Date() })
    .where(and(eq(runtimeJobs.id, job.id), eq(runtimeJobs.leaseOwner, input.leaseOwner)))
    .returning();
  if (!updated) throw new LeaseNotHeldError();
  return updated;
}

export async function completeJob(db: Db, input: { jobId: string; leaseOwner: string; resultRef?: unknown }): Promise<RuntimeJob> {
  const job = await getJob(db, input.jobId);
  requireLeaseHeld(job, input.leaseOwner);

  const [updated] = await db
    .update(runtimeJobs)
    .set({
      status: "completed",
      completedAt: new Date(),
      resultRef: (input.resultRef ?? null) as object | null,
      leaseOwner: null,
      leaseExpiresAt: null,
      revision: job.revision + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(runtimeJobs.id, job.id), eq(runtimeJobs.leaseOwner, input.leaseOwner)))
    .returning();
  if (!updated) throw new LeaseNotHeldError();

  await recordAuditEvent(db, { eventType: "runtime_job_completed", organizationId: job.organizationId ?? undefined, targetType: "runtime_job", targetId: job.id, metadata: { jobType: job.jobType, attemptCount: job.attemptCount } });
  return updated;
}

function computeBackoffSeconds(attemptCount: number): number {
  const exponential = Math.min(RUNTIME_CONFIG.retryBaseDelaySeconds * 2 ** Math.max(0, attemptCount - 1), RUNTIME_CONFIG.retryMaxDelaySeconds);
  const jitter = Math.floor(Math.random() * RUNTIME_CONFIG.retryJitterSeconds);
  return exponential + jitter;
}

export interface ReportJobFailureInput {
  jobId: string;
  leaseOwner: string;
  failureClass: JobFailureClass;
  errorCode: string;
  errorMessage: string;
  requiresHumanReview?: boolean;
}

export type ReportJobFailureResult = { outcome: "retry_scheduled"; job: RuntimeJob; nextAvailableAt: Date } | { outcome: "failed" | "dead_lettered"; job: RuntimeJob };

/**
 * The single entry point a worker calls on any failure — decides retry
 * vs. permanent failure vs. dead-letter, so this policy lives in exactly
 * one place. Only `transient` may ever schedule a retry; permission
 * revocation, cancellation, and uncertain/unsafe outcomes NEVER retry
 * automatically (`unsafe_uncertain` also forces `requiresHumanReview`).
 * Retry exhaustion (`attemptCount >= maxAttempts`) always dead-letters,
 * even for an otherwise-retryable classification — no infinite loops.
 */
export async function reportJobFailure(db: Db, input: ReportJobFailureInput): Promise<ReportJobFailureResult> {
  const job = await getJob(db, input.jobId);
  requireLeaseHeld(job, input.leaseOwner);

  const requiresHumanReview = input.requiresHumanReview ?? input.failureClass === "unsafe_uncertain";
  const isRetryable = RETRYABLE_JOB_FAILURE_CLASSES.has(input.failureClass);
  const attemptsExhausted = job.attemptCount >= job.maxAttempts;

  if (isRetryable && !attemptsExhausted && !requiresHumanReview) {
    const delaySeconds = computeBackoffSeconds(job.attemptCount);
    const nextAvailableAt = new Date(Date.now() + delaySeconds * 1000);

    const [updated] = await db
      .update(runtimeJobs)
      .set({
        status: "retry_scheduled",
        availableAt: nextAvailableAt,
        failureClassification: input.failureClass,
        lastErrorCode: input.errorCode,
        lastErrorMessage: input.errorMessage.slice(0, 1000),
        leaseOwner: null,
        leaseExpiresAt: null,
        revision: job.revision + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(runtimeJobs.id, job.id), eq(runtimeJobs.leaseOwner, input.leaseOwner)))
      .returning();
    if (!updated) throw new LeaseNotHeldError();

    await recordAuditEvent(db, {
      eventType: "runtime_job_retry_scheduled",
      organizationId: job.organizationId ?? undefined,
      targetType: "runtime_job",
      targetId: job.id,
      metadata: { jobType: job.jobType, attemptCount: job.attemptCount, nextAvailableAt: nextAvailableAt.toISOString(), errorCode: input.errorCode },
    });

    return { outcome: "retry_scheduled", job: updated, nextAvailableAt };
  }

  const terminalStatus = attemptsExhausted && isRetryable ? "dead_lettered" : requiresHumanReview ? "dead_lettered" : "failed";

  const [updated] = await db
    .update(runtimeJobs)
    .set({
      status: terminalStatus,
      completedAt: new Date(),
      failureClassification: input.failureClass,
      lastErrorCode: input.errorCode,
      lastErrorMessage: input.errorMessage.slice(0, 1000),
      requiresHumanReview,
      leaseOwner: null,
      leaseExpiresAt: null,
      revision: job.revision + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(runtimeJobs.id, job.id), eq(runtimeJobs.leaseOwner, input.leaseOwner)))
    .returning();
  if (!updated) throw new LeaseNotHeldError();

  await recordAuditEvent(db, {
    eventType: terminalStatus === "dead_lettered" ? "runtime_job_dead_lettered" : "runtime_job_failed",
    organizationId: job.organizationId ?? undefined,
    targetType: "runtime_job",
    targetId: job.id,
    metadata: { jobType: job.jobType, attemptCount: job.attemptCount, failureClass: input.failureClass, errorCode: input.errorCode, requiresHumanReview },
  });

  return { outcome: terminalStatus, job: updated };
}

/** Human-initiated cancellation — legal from any non-terminal state. Respected BEFORE any side effect continues: a worker checks the job's status is still `leased`/`running` (not `cancelled`) at each safe boundary before proceeding, exactly like Agent Runtime Core's own `cancelExecution` cascade. */
export async function cancelJob(db: Db, input: { jobId: string; organizationId: string; actorUserId: string }): Promise<RuntimeJob> {
  const membership = await requireOrganizationMembership(db, input.organizationId, input.actorUserId);
  requireOrganizationRole(membership, ["owner", "admin"]);

  const job = await getJob(db, input.jobId);
  if (job.organizationId !== input.organizationId) throw new RuntimeJobNotFoundError();
  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled" || job.status === "dead_lettered") {
    throw new InvalidJobTransitionError(job.status, "cancelled");
  }

  const [updated] = await db
    .update(runtimeJobs)
    .set({ status: "cancelled", completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, revision: job.revision + 1, updatedAt: new Date() })
    .where(and(eq(runtimeJobs.id, job.id), eq(runtimeJobs.revision, job.revision)))
    .returning();
  if (!updated) {
    await recordWorkerDenied(db, "cancel_race_lost", job.id);
    throw new InvalidJobTransitionError(job.status, "cancelled");
  }

  await recordAuditEvent(db, { eventType: "runtime_job_cancelled", actorUserId: input.actorUserId, organizationId: input.organizationId ?? undefined, targetType: "runtime_job", targetId: job.id, metadata: { jobType: job.jobType } });
  return updated;
}
