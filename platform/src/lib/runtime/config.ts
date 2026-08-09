/**
 * Module 9 — every tunable value the queue/worker/reconciliation system
 * needs, named in one place rather than hardcoded through business
 * logic (task's own explicit instruction). Concrete starting values, not
 * empirically tuned — the same "a starting point, not a proven figure"
 * honesty this codebase already applies to its rate limits.
 */
export const RUNTIME_CONFIG = {
  /** How long a claimed lease is valid before it's eligible for reclaim. */
  leaseDurationSeconds: 60,
  /** How often a worker should call `heartbeat` while still processing a job. */
  heartbeatIntervalSeconds: 20,
  /** Extra grace beyond `leaseExpiresAt` before reconciliation treats a job as truly abandoned, absorbing normal clock/network skew. */
  reclaimGraceSeconds: 15,
  /** How often a worker polls for new work when idle. */
  pollIntervalSeconds: 5,
  /** Upper bound on jobs claimed in a single poll call. */
  maxJobsPerPoll: 5,
  /** Base delay for exponential backoff between retry attempts. */
  retryBaseDelaySeconds: 30,
  /** Ceiling on backoff delay, regardless of attempt number. */
  retryMaxDelaySeconds: 60 * 30,
  /** Bounded random jitter added to every scheduled retry, to avoid a thundering herd of jobs all becoming available at once. */
  retryJitterSeconds: 10,
  /** Default max attempts for a freshly enqueued job (overridable per-enqueue). */
  defaultMaxAttempts: 5,
  /** Threshold beyond which a `running`/`waiting` execution with no matching active job is considered "stuck" by reconciliation. */
  executionStuckThresholdSeconds: 60 * 10,
  /** Retention window for terminal (completed/failed/cancelled/dead_lettered) queue jobs before a cleanup pass may remove them. */
  completedJobRetentionSeconds: 60 * 60 * 24 * 30,
} as const;

export type RuntimeConfig = typeof RUNTIME_CONFIG;
