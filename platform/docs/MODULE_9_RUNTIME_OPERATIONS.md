# Module 9 — Runtime Operations Runbook

Operational companion to `MODULE_9_RUNTIME_RECOVERY_AND_WORKERS.md` (architecture/design). This is the "how do I actually run this" doc.

## Bootstrapping a worker

1. Set `WORKER_BOOTSTRAP_SECRET` in the deployment environment — a long random string, treated exactly like a database credential (never committed, never logged).
2. Mint a worker credential:
   ```
   POST /api/internal/runtime/worker/credentials
   { "workerName": "prod-worker-1", "bootstrapSecret": "<WORKER_BOOTSTRAP_SECRET>" }
   ```
   The response's `secret` field is shown exactly once — store it wherever the worker process reads its own credentials from (the same discipline as every other credential in this codebase).
3. Point a worker process (or a scheduled job — this phase has no long-running daemon, only a poll endpoint suited to being triggered on an interval) at:
   ```
   POST /api/internal/runtime/worker/poll
   Authorization: Bearer <worker secret>
   { "workerId": "<stable-per-process-id>" }
   ```
   Repeat on an interval — `RUNTIME_CONFIG.pollIntervalSeconds` (5s) is the suggested starting cadence.
4. While processing a long-running job, call `POST /api/internal/runtime/worker/{workerId}/heartbeat` with `{ "jobId": "..." }` roughly every `RUNTIME_CONFIG.heartbeatIntervalSeconds` (20s) — in practice, this phase's own `execution_run` jobs complete in a handful of seconds, so heartbeating is defensive rather than load-bearing today.
5. Trigger `POST /api/internal/runtime/reconcile` on a slower schedule (e.g. every few minutes) — runs execution reconciliation, tool-invocation reconciliation, and every cleanup job in one call, worker-authenticated.

## Configuration

All tunables live in `src/lib/runtime/config.ts` (`RUNTIME_CONFIG`), never hardcoded through business logic:

| Key | Default | Meaning |
|---|---|---|
| `leaseDurationSeconds` | 60 | How long a claim is valid before reclaim-eligible |
| `heartbeatIntervalSeconds` | 20 | Suggested worker heartbeat cadence |
| `reclaimGraceSeconds` | 15 | Extra grace beyond lease expiry before reclaim, absorbing clock/network skew |
| `pollIntervalSeconds` | 5 | Suggested idle-poll cadence |
| `maxJobsPerPoll` | 5 | Upper bound on jobs claimed in one poll call |
| `retryBaseDelaySeconds` / `retryMaxDelaySeconds` / `retryJitterSeconds` | 30 / 1800 / 10 | Exponential backoff shape |
| `defaultMaxAttempts` | 5 | Default retry budget for a freshly enqueued job |
| `executionStuckThresholdSeconds` | 600 | How stale an in-progress execution must be before reconciliation treats it as stuck |
| `completedJobRetentionSeconds` | 2,592,000 (30 days) | How long a terminal `runtime_jobs` row survives before cleanup may remove it |

None of these are empirically tuned — starting points, honestly documented as such, the same posture this codebase already takes with its rate limits.

## Operational status

`GET /api/organizations/{organizationId}/runtime/status` — any org member. Returns job counts by status, expired-but-not-yet-reclaimed lease count, jobs flagged `requiresHumanReview`, average completed-job processing duration (last 24h), and the 10 most recent reconciliation/cleanup runs (type, timing, records examined/affected, success). No external observability provider — deterministic, bounded, direct aggregate queries against `runtime_jobs`/`runtime_operation_runs`.

## Dead-letter management

`GET /api/organizations/{organizationId}/runtime/dead-letter` (list) / `/{jobId}` (inspect) — owner/admin only. Inspect the job's `failureClassification`, `lastErrorCode`/`lastErrorMessage` (bounded, never raw tool input or secrets), and `requiresHumanReview`. Two actions:
- `POST .../dead-letter/{jobId}/retry` — resets the attempt budget and re-queues. Refused if the underlying work was itself cancelled (never resurrect cancelled work).
- `POST .../dead-letter/{jobId}/cancel` — permanent, no further retry possible.

## Cleanup jobs and retention

| What | Mechanism | Retention |
|---|---|---|
| Expired sessions | `cleanup_expired_sessions` job / `cleanupExpiredSessions` | Deleted once `expiresAt` has passed |
| Stale rate-limit counters | `cleanup_rate_limit_counters` job / `cleanupStaleRateLimitCounters` | Deleted once `windowStart` is >1h old (every window in this codebase is far shorter) |
| Expired approval requests | Folded into execution reconciliation | Expired immediately upon detection (Module 7's own `expirePendingApprovals`) |
| Expired execution leases | Handled by `claimJobs` itself | Reclaimed lazily on next poll — no standalone cleanup |
| Old completed `runtime_jobs` rows | `cleanupOldCompletedJobs`, via the internal reconcile sweep | 30 days after `completedAt`, terminal states only |

**Never deleted by any cleanup job**: `agent_execution_events`, `agent_plans`/`agent_plan_steps`, `agent_checkpoints`, `agent_artifacts`, `audit_logs` — verified directly by a test that runs cleanup after a full completed execution and confirms the report/artifact and execution history are still fully intact.

Every cleanup and reconciliation run is recorded in `runtime_operation_runs` (operation type, started/completed timestamps, records examined/affected, success, bounded error message) — the shared observability table `GET .../runtime/status` surfaces the most recent 10 of.

## Worker credential lifecycle

Revocation (`revokeWorkerCredential`, same bootstrap-secret gate) is immediate — the very next authenticated call with a revoked credential is refused, verified directly. Revoking a credential does **not** by itself release any leases that credential's processes currently hold; those leases expire and are reclaimed by `claimJobs` in the ordinary course, the same recovery path any crashed worker goes through.

## Troubleshooting

- **A job is stuck `leased`/`running` with no progress**: check `leaseExpiresAt` — it will be reclaimed automatically once expired (plus the grace period). To force it sooner, wait for the next `POST /api/internal/runtime/reconcile` sweep or a worker's own next poll.
- **A job is `dead_lettered` and `requiresHumanReview` is true**: this means the failure was classified `unsafe_uncertain` — a non-idempotent side effect whose completion state could not be determined with certainty. Inspect it via the dead-letter API before deciding to retry or cancel; retrying an uncertain external action is never automatic in this system, by design.
- **Reconciliation reports `completed_missing_final_event`**: an execution reached `completed` without its own `agent_execution_completed` event — this is flagged for human review, never auto-repaired, because the underlying cause (a partial write, a bug, manual DB intervention) can't be safely guessed.
