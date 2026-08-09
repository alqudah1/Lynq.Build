# Module 9 — Runtime Recovery, Reconciliation, and Background Worker Foundation

Closes the gap `MODULE_4_AGENT_RUNTIME_ARCHITECTURE.md` §8 already named: "a reconciliation pass finds every task last recorded as 'in progress' with no recent heartbeat, and resumes each from its last durable checkpoint." A durable, Postgres-backed job queue and worker — no second runtime, no external queue dependency, no redesign of the Agent Runtime Core, Tool Runtime, or Company Knowledge Analyst.

## Contradiction reconciliation (pre-implementation review)

None found. §8's own principles — durable checkpoint before every side effect, idempotency keys preventing duplicate side effects on retry, explicit human-pause never auto-resuming, cancellation cascading cleanly — are exactly what this module implements a scheduling layer around, not a departure from them.

## Queue model

`runtime_jobs` (`src/db/schema.ts`). One row persists across every attempt of a logical job — `attemptCount` increments in place, never a new row per retry (unlike `tool_invocations`, which is one row per *attempt*; a queue job is one row per *logical unit of work*, deliberately different shapes for different reasons). 7 job types, exactly the approved narrow list: `execution_run`, `execution_resume`, `execution_retry`, `tool_invocation_reconcile`, `execution_reconcile`, `cleanup_expired_sessions`, `cleanup_rate_limit_counters`. 8-state machine: `queued, leased, running, retry_scheduled, completed, failed, cancelled, dead_lettered`.

`organizationId` is nullable — a deliberate, narrow deviation from the task's own field list (which didn't mark it optional), justified by `cleanup_*` jobs being genuinely platform-wide, belonging to no single organization. Every other job type always sets it.

**Idempotency**: a partial unique index on `(organizationId, jobType, idempotencyKey)` scoped to active statuses (`queued/leased/running/retry_scheduled`) — mirrors Module 8's `tool_invocations` pattern exactly. Once a job reaches any terminal state, the same key is free for a genuinely new job. `enqueueJob` translates a `23505` conflict into "return the existing active job" — idempotent enqueue, not an error.

## Worker authentication

`worker_credentials` (`src/lib/runtime/worker-auth.ts`) — a dedicated, hashed (SHA-256, never plaintext stored) server-to-server credential, structurally separate from both human sessions and agent credentials, per the task's explicit instruction. Issuing one is gated by `WORKER_BOOTSTRAP_SECRET`, a new deploy-time environment secret — the one platform-operational authority in this codebase that isn't org-scoped or human-session-scoped, because worker identity itself isn't a business-data concern. It grants exactly one action (mint a worker credential) and nothing else: no Brain access, no Agent Registry access, no organization visibility. A worker's actual authority over any one call comes entirely from the job it holds a valid lease on, never from the credential table itself.

`leaseOwner` is `${workerCredentialId}:${workerId}` — the credential proves "a legitimate worker," `workerId` (caller-supplied, e.g. a process/instance id) distinguishes concurrent processes sharing one credential, so a heartbeat/complete call is honored only for the exact process that claimed the lease.

## Claiming and leases

`claimJobs` (`src/lib/runtime/queue.ts`) is one atomic SQL statement — a CTE selecting eligible rows with `FOR UPDATE SKIP LOCKED`, then an `UPDATE ... FROM` that marks them `leased` and returns each row's *prior* status in the same round trip (no separate racy read). Eligible rows are freshly `queued`/`retry_scheduled` past `availableAt`, OR `leased`/`running` past `leaseExpiresAt` plus a grace period (a "reclaim"). `attemptCount` increments on every claim, fresh or reclaimed — a reclaimed job consumed a real attempt that never reported back, so it counts toward the retry budget defensively.

**A real bug caught while writing the first concurrency test**: the raw `neon` tagged-template driver returns Postgres's actual snake_case column names, never Drizzle's camelCase-mapped shape — the first draft of `claimJobs` cast the raw result directly as a typed `RuntimeJob[]`, so every field silently came back `undefined` at the call site. Fixed by having the raw statement return only `id`/`previous_status`, then re-fetching the actual rows through Drizzle's normal schema-aware query builder.

## Heartbeats

`heartbeatJob` extends `leaseExpiresAt`, honored only for the exact `leaseOwner` that holds the lease (`LeaseNotHeldError` otherwise — a stale worker that lost its lease to a reclaim can never fool the row into thinking it still owns it). Per the task's own explicit noise policy: heartbeats do **not** write an audit event on every call — `heartbeatAt` on the row itself is the operational record, visible via the status/inspection APIs. `runtime_job_heartbeat` exists in the audit taxonomy for completeness but this module never emits it in a tight loop.

## Recovery

Interruption recovery reduces to the same mechanism §8 describes: `execution_run`/`execution_resume`/`execution_retry` job types all resolve to one call, `continueKnowledgeAnalystExecution` (`src/lib/agents/knowledge-analyst.ts`) — resumable by construction. Every status transition it makes is guarded by re-checking the execution's own current status first (a no-op if already past it), every tool call carries the identical Module 8 idempotency key on every resumption, and `completePlanStep` is only invoked for a step not already `completed`. A crashed worker's next claim (fresh or reclaimed) simply re-enters this same function and picks up exactly where the durable state says it left off — proven directly by a test calling it twice in a row and confirming zero duplicate tool invocations.

## Execution reconciliation

`src/lib/runtime/reconciliation-executions.ts`, `reconcileExecutions`. One deterministic pass, one audited decision per execution:

| Case | Action |
|---|---|
| In-progress, no active job, past the stuck threshold | Enqueue `execution_resume` (also covers "waiting with an expired retry time" — the same underlying condition) |
| `waiting` with unresolved dependencies remaining | None — correctly waiting, not stuck |
| `human_approval`, but the request was already decided `approved` | Enqueue `execution_resume` (§7's transition should have already fired; safe to nudge) |
| `completed` but missing its own `agent_execution_completed` event | Flag for human review — never auto-repaired, since the cause is unknown |
| `cancelled` with queued work remaining | Cancel the orphaned job(s) too |

"Expired approval requests" cleanup is folded into this same pass (`expirePendingApprovals`, Module 7's existing function) rather than a dedicated job type — no slot for it in the approved narrow list. Every action is both an `execution_reconciled` audit event and a real `agent_execution_events` entry — never a silent state change.

## Tool reconciliation

`src/lib/runtime/reconciliation-tool-invocations.ts`, `reconcileToolInvocations` — the explicit Module 8 gap closed. Detects `requested/validating/ready/running/waiting_for_approval` invocations with no active job covering their execution, then:

- **`read_only`** (no side effect at all): always safe to retry — marked `failed` (freeing the idempotency key) and a resume enqueued.
- **`internal_write`**: checked against real evidence, never guessed. If `invocation.artifactId` is already set, or a sibling row under the exact same idempotency key already succeeded, the invocation is reconciled straight to `succeeded` — the write is never repeated. Otherwise, no evidence exists at all (the write and the invocation row share one database — "no artifact" *is* "definitely never happened," not "uncertain"), so it's safe to retry the same way as read-only.
- **`external_write`/`destructive`/`financial`/`permission_changing`** (none implemented yet): always flagged `requiresHumanReview`, never auto-resolved either way — forward-looking policy, fixed now.

Directly exercises `artifact.create_report`'s own crash-recovery check (a test reconciles a stuck row whose own idempotency key already has a succeeded sibling, confirming it resolves to `succeeded` without a second artifact).

## Retry scheduling

`reportJobFailure` (`src/lib/runtime/queue.ts`) is the single entry point every failure goes through — the queue's own failure taxonomy (`transient`, `permission_revoked`, `cancelled`, `permanent`, `unsafe_uncertain`) is deliberately distinct from Agent Runtime Core's `FailureClass` and Tool Runtime's `ToolErrorClass`, since a job wraps either kind of work and its retry-safety question is one level up. Only `transient` may ever schedule a retry (exponential backoff, bounded jitter, `config.ts`'s named constants — never hardcoded inline). `permission_revoked` and `cancelled` never retry. `unsafe_uncertain` always forces `requiresHumanReview` and dead-letters immediately. Retry exhaustion (`attemptCount >= maxAttempts`) always dead-letters, even for an otherwise-retryable classification — no infinite loop, verified directly.

`src/lib/runtime/worker.ts`'s `classifyExecutionError` maps real thrown errors to this taxonomy (a retired agent or revoked Brain grant → `permission_revoked`; a disabled tool → `permanent`; an approval-required pause → `unsafe_uncertain`) — pure-function, unit-tested directly rather than through a shared-global-tool integration test (see Tests, below).

## Dead-letter handling

`src/lib/runtime/dead-letter.ts` — list/inspect/retry/cancel, owner/admin only. A manual retry resets the attempt budget to zero (a human's explicit new decision, not a continuation of the exhausted automatic policy) and is revision-guarded so two concurrent manual retries can only ever have one winner ("dead-letter retry is single-use," verified directly). Never exposes raw tool inputs or secrets — the job row itself never stored them to begin with (bounded `inputMetadata` only, matching Module 8's own rule).

## Cleanup jobs

`src/lib/runtime/cleanup.ts` — only 2 of the 5 requested categories get their own dedicated job type (`cleanup_expired_sessions`, `cleanup_rate_limit_counters`), matching the approved narrow job-type list exactly. "Expired execution leases" needs no separate job at all — `claimJobs` reclaims them lazily, by design, the moment any worker next polls. "Expired approval requests" is folded into execution reconciliation. "Old completed queue jobs" (`cleanupOldCompletedJobs`) is a plain function invoked from the internal reconcile sweep. Never deletes execution events, plans, checkpoints, artifacts, or audit logs — verified directly.

## APIs

Org-facing (human session, org membership or owner/admin per action): `GET/POST .../agent-executions/{id}/enqueue`, `GET .../runtime/jobs[/{id}]`, `POST .../runtime/jobs/{id}/{retry,cancel}`, `GET .../runtime/dead-letter[/{id}]`, `POST .../runtime/dead-letter/{id}/{retry,cancel}`, `GET .../runtime/status`. Internal (worker-credential only): `POST /api/internal/runtime/worker/poll`, `POST /api/internal/runtime/worker/{workerId}/heartbeat`, `POST /api/internal/runtime/worker/credentials` (bootstrap-secret gated), `POST /api/internal/runtime/reconcile`.

## Audit

18 new event types. Bounded metadata only.

## Concurrency

Real tests, against the real database, for every required scenario: two workers can't claim the same job (SKIP LOCKED proven directly), an expired lease is reclaimed exactly once, a valid lease can't be stolen, heartbeat extends only the correct lease, a stale worker can't complete after losing its lease, cancellation racing a claim is deterministic, retry scheduling happens once, reconciliation never enqueues a duplicate resume job (the same partial-unique-index mechanism), cleanup runs are idempotent by nature (delete-what's-eligible, re-run finds nothing), dead-letter retry is single-use, duplicate task requests reuse the existing queued job.

## Deferred external queue providers

Postgres proved fully sufficient for this scale — `SKIP LOCKED` gives atomic, race-free claiming with no additional infrastructure. Redis/Kafka/SQS remain explicitly out of scope, per the task's own instruction, unless a future module demonstrates a real limit this design can't absorb (e.g., claim throughput far beyond what a single `runtime_jobs` table indexed on `(job_type, status, available_at)` can serve).

## Tests

See `MODULE_9_RUNTIME_OPERATIONS.md` for the operational runbook this module also ships, and the final report for exact test counts.

## Update (LYNQ Workflow Engine Core, Module 11, now complete)

The Workflow Engine extends this module's queue and worker directly rather than building a second one: 4 new job types (`workflow_start`, `workflow_node_execute`, `workflow_continue`, `workflow_reconcile`) were added to the same `runtime_jobs` table and the same `RUNTIME_JOB_TYPES`/worker switch this module defined, using this module's own `claimJobs`/`pollAndProcess`/`reportJobFailure`/lease-reclaim mechanisms completely unmodified. `reconcileWorkflows` (`src/lib/workflows/reconciliation.ts`) follows this module's exact reconciliation shape — one deterministic pass, one audited decision per record, idempotent re-enqueue via the same job-idempotency-key mechanism. `runtime_jobs` gained one new nullable `workflow_execution_id` column (indexed) so a workflow's own jobs can be queried directly; every other column and constraint this module defined is unchanged. See `MODULE_11_WORKFLOW_ENGINE_CORE.md` and `MODULE_11_WORKFLOW_EXECUTION_AND_RECOVERY.md`.

## Update (LYNQ Communications & Integrations Core, Module 16, now complete)

Communications OS adds its own 2 job types (`communication_send`, `communication_reconcile`) to this module's exact same `runtime_jobs` table, `RUNTIME_JOB_TYPES` union, and `processClaimedJob` switch — no second queue, no schema change beyond the 2 new enum values. `communication_send`'s own entity reference is folded directly into the job's existing `idempotencyKey` text (`communication_send:{messageId}`) rather than adding a new dedicated reference column — this module's own `runtime_jobs.idempotency_key` doc comment already anticipated exactly this pattern ("callers fold the logical target directly into this key's text") for job types with no natural dedicated column. `communication_reconcile` follows this module's exact reconciliation shape (`reconcileCommunications`, one deterministic pass using `startOperationRun`/`finishOperationRun`) but resolves a genuinely NEW case this module's own reconciliation never had to handle: a claimed external-provider send whose outcome is uncertain (a timeout or ambiguous response), which is deliberately never auto-retried — see `MODULE_16_COMMUNICATIONS_DELIVERY_AND_RECOVERY.md` for the full reasoning. This module's own queue/worker/reconciliation mechanisms are otherwise entirely unchanged. See `MODULE_16_COMMUNICATIONS_CORE.md`.
