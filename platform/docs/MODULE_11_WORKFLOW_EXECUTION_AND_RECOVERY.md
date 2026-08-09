# Module 11 — Workflow Execution and Recovery

Companion to `MODULE_11_WORKFLOW_ENGINE_CORE.md`, detailing the execution model, node-execution model, queue/worker integration, pause/resume/cancellation, failure and retry policy, reconciliation, and concurrency guarantees. Extends Module 9's durable job queue and worker foundation directly — no second queue, no second worker, no new recovery mechanism.

## Workflow execution model

`workflow_executions`: `id, organizationId, workspaceId?, workflowDefinitionId, workflowVersionId, status, initiatorUserId?, projectId?, projectTaskId?, input (bounded structured JSON, capped at 20,000 bytes), currentNodeId?, startedAt?, completedAt?, cancelledAt?, failureClassification?, revision, createdAt, updatedAt`.

States: `queued, running, waiting, waiting_for_approval, paused, completed, failed, cancelled` — the smallest set consistent with existing Runtime terminology. `workflowVersionId` is captured at start time and never changes — an execution always runs against the exact published version it started with, even if a newer version is published later (verified directly: publishing a new version does not affect in-flight executions of the old one).

Every workflow execution is processed entirely through the existing queue/worker foundation — `startWorkflowExecution` enqueues a `workflow_start` job and returns immediately; the full workflow never runs synchronously inside an HTTP route.

## Node execution model

`workflow_node_executions`: `workflowExecutionId, workflowNodeId, status, attemptNumber, input?, output?, runtimeExecutionId?, toolInvocationId?, approvalRequestId?, projectTaskId?, artifactId?, startedAt?, completedAt?, failureClassification?, revision`.

States: `pending, ready, running, waiting, succeeded, failed, skipped, cancelled`. Invalid transitions fail (the same revision-guarded atomic-`UPDATE ... WHERE status IN (...) AND revision = expected` pattern every prior module uses). One logical node execution can never run twice — enforced by two independent, real Postgres mechanisms: `workflow_node_executions_attempt_unique (workflowExecutionId, workflowNodeId, attemptNumber)` prevents two rows claiming the same attempt number, and `workflow_node_executions_active_unique` (a partial unique index on `(workflowExecutionId, workflowNodeId)` scoped to non-terminal statuses) prevents two *simultaneously active* attempts for the same node regardless of attempt number. Idempotency keys for any downstream Tool/Runtime call are scoped to `(organizationId, workflowExecutionId, workflowVersionId, nodeKey, attemptNumber)`.

## Node behavior summary

Full per-node-type behavior is documented in `MODULE_11_WORKFLOW_ENGINE_CORE.md`'s Node types table. The cross-cutting rules every node type honors: never treat the Runtime execution as the project task; never mutate a historical artifact — a transform always produces a new one; read results only from real artifacts or structured output, never assumed from narrative text; never duplicate an approval decision, only read it live; never impersonate a project task unless explicitly linked via the owning node execution's own `projectTaskId`.

## Execution engine (`engine.ts`)

`driveWorkflowForward` is the core loop: resolve the current node, run it (synchronously for `start`/`end`/`condition`, or dispatch asynchronously via `dispatchAsyncNode` for every other type), and on success call the single shared `advanceAfterNodeSuccess` helper — the **one place** `currentNodeId` is ever advanced after any node succeeds, used identically by the main loop, `dispatchAsyncNode`'s rare-synchronous-completion branch, and `checkAndContinueWorkflow`. This consolidation exists because an earlier draft advanced `currentNodeId` in multiple call sites independently and produced a real duplicate-attempt bug — see "Bugs discovered" in the final report.

`executeWorkflowNodeJob` is the crash-safe, independently-claimable dispatch for one asynchronous node (its own `workflow_node_execute` job). `continueWorkflowExecution` re-enters an execution after an external resolution (an approval decided, a human task completed, a project task changed, a wait's `availableAt` passed) or a fresh retry attempt, routing internally based on the current node execution's own status — it never assumes what triggered the re-entry.

## Queue and worker integration

4 new job types, added to Module 9's existing `runtime_jobs` table and `RUNTIME_JOB_TYPES` list — no second queue:

| Job type | Purpose |
|---|---|
| `workflow_start` | Kicks off a freshly created execution — resolves the start node and begins the loop. |
| `workflow_node_execute` | One asynchronous node's own dispatch — independently claimable and lease-recoverable, so a crash mid-node doesn't strand the whole execution. |
| `workflow_continue` | Re-entry after an external resolution or a retry attempt. |
| `workflow_reconcile` | Periodic stuck-execution sweep (see Reconciliation below). |

The existing worker (`src/lib/runtime/worker.ts`) dispatches all four through its normal registered-handler switch — same lease/claim/heartbeat mechanism Module 9 built, same `pollAndProcess`/`claimJobs` (`FOR UPDATE SKIP LOCKED`) atomic claiming, same `reportJobFailure` single failure-policy entry point. A worker claiming a workflow job: validates its lease, loads the latest workflow state fresh (never trusts anything cached from claim time), revalidates authorization/eligibility for the node about to run, determines the next executable node, executes or enqueues it, persists progress, and schedules the next continuation — deterministically ending in queued/waiting/completed/failed/paused, never left ambiguous.

## Failures and retries

Each node's `retryPolicy` defines: retryable failure classes, max attempts, backoff, timeout, and one of four failure-handling modes — `fail_workflow`, `pause_for_human`, `retry`, `continue_to_failure_branch`. Failure classification reuses Module 9's own queue-failure taxonomy (`transient, permission_revoked, cancelled, permanent, unsafe_uncertain`) plus workflow-specific cases mapped onto it: validation failure and invalid mapping → `permanent`; permission revocation and agent retirement and tool disabled → `permission_revoked`; approval rejection and human-task timeout → routed to the node's own configured `failure_handling`, never silently dropped; node timeout and transient Runtime failure → `transient` (retryable up to the node's own bound); worker interruption → recovered via lease reclaim (Module 9's existing mechanism), never a distinct workflow-level failure at all. No node ever fails silently — `handleNodeFailure` always writes a node-execution failure record, a `workflow_node_failed` audit event, and a `workflow_node_execution_events` row before applying the node's configured policy.

## Pause, resume, cancellation, and recovery

- **Manual pause** (`pauseWorkflowExecution`): revision-guarded transition from any in-progress status to `paused`. A paused execution starts no new nodes — the engine checks execution status before dispatching every node, not only at loop entry.
- **Resume** (`resumeWorkflowExecution`): revalidates live permissions and current resource eligibility before re-entering the loop — never blindly continues on stale authority captured at pause time.
- **Cancellation** (`cancelWorkflowExecution`): propagates to queued child work where safe (cancels queued/leased jobs tied to this execution); active external work (an in-flight approval, an in-flight human task) is left to its own subsystem's rules rather than force-cancelled, since this module never owns that state. Completed side effects are never undone automatically.
- **Retry** (`retryWorkflowExecution`): retries the current failed node from a safe checkpoint (the last successfully persisted node execution), never replays already-succeeded nodes.
- **Stale workers**: cannot continue after losing their lease — Module 9's own lease-expiry/reclaim mechanism applies identically to `workflow_node_execute`/`workflow_continue` jobs as to every other job type; no workflow-specific exception exists.

## Reconciliation

`reconcileWorkflows` (`reconciliation.ts`) extends Module 9's exact reconciliation pattern — one deterministic pass, one audited decision per execution, never a silent fix:

| Case | Action |
|---|---|
| `running`/`waiting`/`waiting_for_approval`, stale (past the stuck threshold), no active job | Enqueue a continuation. This single case covers a decided approval, a completed human task, a completed linked agent/tool execution, a completed project task, and an expired wait all at once — `continueWorkflowExecution` re-checks live state regardless of *why* it was invoked, so one detection path is sufficient. |
| `cancelled` with queued/leased work still active | Cancel the orphaned job(s) too. |
| `completed` but missing its own `workflow_execution_completed` event | Flagged for human review — never auto-repaired, since the cause is unknown. |

Re-enqueuing a continuation for an execution that already has one in flight is a guaranteed no-op — the same job-idempotency-key mechanism Module 9 established de-duplicates it, verified directly (see Concurrency).

## Concurrency

Real tests against the real database, `Promise.allSettled`/direct-DB-state assertions, for every required scenario:

- Two users cannot publish conflicting versions, and published versions are immutable — `workflow_versions_one_published_unique`.
- Duplicate workflow keys and duplicate node keys fail safely — real unique constraints.
- Unsupported cycles are rejected at validation, deterministically.
- Two workers cannot execute the same node — `workflow_node_executions_active_unique` rejects a second concurrent attempt for the same `(execution, node)` pair, verified directly.
- A stale node-execution revision fails its transition rather than silently overwriting.
- A simultaneous double-completion race on the same node lets exactly one attempt succeed.
- Two concurrent attempts to complete the same execution at the same revision let exactly one succeed (the loser's `WHERE revision = ?` simply matches nothing).
- Duplicate continuation jobs do not duplicate work — the queue's own idempotency key.
- Running reconciliation twice against the same stuck execution results in at most one active `workflow_continue` job, verified directly.
- Approval decisions, agent-execution results, and tool-invocation results are each consumed exactly once — read live from their owning record, never cached or re-applied.
- Human task completion is single-use (revision-guarded).
- Cancellation racing node completion is deterministic — whichever atomic transition commits first wins; the loser's guarded `WHERE` clause matches nothing.

5 dedicated concurrency tests (`concurrency.integration.test.ts`) plus concurrency assertions embedded directly in `definitions-versions`/`graph-validation`/`nodes-edges` where a DB constraint is the thing actually being proven.

## Update (Generic Agent Execution, Module 14, now complete)

Two additions, both scoped to `agent_execution` nodes:

- **A new concurrency guarantee**: two workers can no longer both launch a real Runtime execution for the same node attempt. `dispatchAsyncNode`'s `agent_execution` case now performs an atomic compare-and-set claim (`transitionNodeExecution`, `"pending" → "running"`) before calling the agent task handler's `launch`; the loser of a race is a safe no-op. This closes a real gap in the lease-based exactly-once-active-worker guarantee described above (a lease is time-based, not a true mutual-exclusion lock).
- **A new reconciliation case**: `reconcileWorkflows` now also detects a node execution claimed (`"running"`) but never actually launched (no `runtimeExecutionId`, past the staleness threshold, no active job) — the exact state a process dying between the claim and the launch would leave behind — and recovers it via the same fail-and-open-a-fresh-attempt pattern `handleNodeFailure`'s own retry path already uses.

See `MODULE_14_GENERIC_AGENT_EXECUTION.md` for full detail, including a related fix (`handleNodeFailure` is now called from inside `dispatchAsyncNode` using its own up-to-date node-execution reference, not the caller's potentially-stale one) made necessary by the claim step but applying to every async node type.
