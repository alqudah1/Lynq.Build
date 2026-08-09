# Module 7 — Agent Runtime Core

Turns a registered agent (Agent Registry) into a durable, permission-aware worker, per `MODULE_4_AGENT_RUNTIME_ARCHITECTURE.md`. Foundation only: internal actions and deterministic test-executors, no LLM provider, no external tools, no workflow engine, no business agents.

> **Reused by Module 13 (Sales OS)**: two narrow agents (Lead Research Assistant, Opportunity Summary Assistant) are driven through this exact execution lifecycle (`createExecution` → `assignExecution` → `startExecution` → `advanceExecution` → `completeExecution`), synchronously rather than via the job queue — `src/lib/runtime/worker.ts`'s `execution_run` handler is hard-wired to Knowledge Analyst's own driver, so Sales OS deliberately does not enqueue a real job for these agents. Approval-gated Sales actions use the existing `requestApproval`/`approveRequest`/`rejectRequest` primitives unmodified. See `MODULE_13_SALES_OS.md` and `MODULE_13_SALES_AUTHORIZATION.md`.

## Contradiction reconciliation (pre-implementation review)

Your message's own "candidate execution states" list didn't match §1's approved state diagram. Per your explicit instruction to use the architecture's exact states where they differ, this module uses §1's names (`queued, assigned, gathering_context, planning, reasoning, waiting, executing, delegating, human_approval, verifying, paused, completed, failed, cancelled, archived`), with two narrow additions the diagram omits but the prose requires: `queued` (the diagram's `Idle → Assigned` already assumes an agent exists; §2's Task Model and the `createExecution`/`assignExecution` split imply a real pre-assignment gap) and `paused` (§8 calls it "an explicit, first-class control," never drawn as a node). Retry-waiting and dependency-waiting are NOT separate states — §1 itself says "distinct sub-reasons are always recorded even though 'Waiting' is the single visible state," so both fold into `waiting` + `waitReason`.

## Schema (`drizzle/0019_confused_hiroim.sql`)

9 tables (not 10 — Task and Execution merged into one `agent_executions` row per "do not create unnecessary tables if a smaller normalized model satisfies the approved architecture"; a Subtask is just another row with `parentExecutionId` set, exactly matching §2's "structurally identical to a Task"): `agent_executions`, `agent_task_dependencies`, `agent_plans`, `agent_plan_steps`, `agent_checkpoints`, `agent_execution_events`, `agent_approval_requests`, `agent_artifacts`, `agent_delegations`.

Key design decisions:
- **Concurrency**: a plain-integer `revision` counter on `agent_executions`/`agent_approval_requests`/`agent_artifacts`, guarding one atomic `UPDATE ... WHERE status IN (...) AND revision = expected` per transition — this codebase's own established pattern (Brain Module 7), not a new lease/worker-id system.
- **Self-referencing tenant safety**: `agent_executions_id_org_unique` enables composite FKs for `parentExecutionId`/`rootExecutionId`, so a subtask/delegation can never point outside its own organization.
- **Delegation depth**: hard-capped at 5 via a CHECK constraint — this implementation's own concrete resolution of architecture §16 Open Question #2 ("where those ceilings sit is not decided").
- **Attribution**: plans/artifacts reuse Brain Module 17's exact `createdByUserId`/`createdByAgentId`/`createdByType` pattern — no new attribution model invented.
- **Checkpoints/events**: append-only, no update/delete path anywhere in this module — the same "absence of a mutating code path is the immutability guarantee" already established for `knowledge_item_versions`.

## Execution lifecycle

`src/lib/agent-runtime/lifecycle.ts`. One shared primitive (`transitionExecutionStatus`, `executions.ts`) underlies every named transition (`assignExecution`, `startExecution`, `advanceExecution`, `completeExecution`, `failExecution`, `retryExecution`, `pauseExecution`, `resumeExecution`, `cancelExecution`, `archiveExecution`). `advanceExecution` validates every agent-driven move against an explicit adjacency map matching §1's diagram exactly — no transition reaches `completed`/`cancelled`/`failed` through it; those have their own dedicated, evidence/reason-carrying functions.

## Context model

`src/lib/agent-runtime/context.ts`. Assembled once, at `startExecution`, and persisted into `agent_executions.context_snapshot` — organization/workspace, initiating human, owner, assigned agent + its version/permission-level/department snapshot, goal, requested domains, and a **snapshot-only** capability map. The snapshot is never authoritative for a gated action: every Brain read/draft-write inside this runtime goes through Brain Module 16/17's own `requireAgentBrainReadAccess`/`requireAgentBrainCreateAccess` fresh, every call, with no caching — proven directly by a test that revokes a grant mid-execution and confirms the snapshot's own recorded capability no longer authorizes anything.

## Task and plan model

Goal/Objective folded into plain text fields on the execution row (no separate tables — nothing in this phase needs them addressed independently). Plans are versioned exactly like Brain's `knowledge_item_versions` (`agent_plans`, new row per revision, `changeReason` mandatory for a re-plan); steps (`agent_plan_steps`) track pending/completed/failed/skipped, bounded to 50 per plan.

## Checkpoint / recovery design

`src/lib/agent-runtime/checkpoints.ts`. `createCheckpoint` is called before pausing and at `startExecution`; `resolveResumeCheckpoint` refuses to resume from anything older than the caller's own known progress (`StaleCheckpointError`). Pause/resume reuses this mechanism directly rather than a dedicated "paused-from" column: `pauseExecution` writes a checkpoint recording the current status, `resumeExecution` reads it back to know exactly where to return.

## Failure / retry behavior

12 failure classes (`src/lib/agent-runtime/validation.ts`'s `FAILURE_CLASSES`). Only `timeout`, `provider_unavailable`, `transient_tool_failure` are retryable — `retryExecution` reads the classification back from the most recent `agent_execution_failed` event (never re-guessed) and refuses anything else (`FailureNotRetryableError`), bounded by `maxRetries` (`RetryLimitExceededError`).

## Approval model

`src/lib/agent-runtime/approvals.ts`, §7's exact 5-state machine. `requestApproval` pauses the execution at `human_approval` in the same call a gated action is reached — never a separate, skippable step. Decide-once enforced by the same revision-counter pattern (`ApprovalAlreadyDecidedError`). Approver authority today is the same interim owner/admin-or-execution-owner fallback used everywhere else a department-lead model doesn't exist yet (Brain Module 7, Agent Registry) — not a dedicated "approver" role.

## Artifact model

`src/lib/agent-runtime/artifacts.ts`. Structurally separate storage from `knowledge_items` — verified directly by a test asserting artifact creation never writes a `knowledge_items` row. `file_reference` artifacts require `externalRef`; this table never stores binary content.

Module 10 (LYNQ Projects Core) links existing `agent_artifacts` rows to project entities via a typed pointer table (`project_artifact_links`) — a project link never copies artifact content and never makes an artifact Brain knowledge. This table (and its access rules) is untouched by that module; see `MODULE_10_PROJECTS_CORE.md`.

## Delegation model

`src/lib/agent-runtime/delegation.ts`. Creates a genuine new `agent_executions` row (never a hidden sub-process), starting at `assigned` (not `queued`, since the delegate is already known). Cycle detection is O(1) — the parent's own `ancestryPath` (an ordered array of agent ids) is checked with a simple `includes`, never a recursive query per attempt. The delegating agent must independently hold `read` on every requested domain before it may delegate (`DelegatorLacksCapabilityError`) — delegation transfers work, never permission; the child re-validates its own grants on every gated action exactly like any other agent, proven by a test where a delegate with no grant of its own is denied even though its delegator held one.

## Completion evidence

`completeExecution` refuses `verifying → completed` unless every step of the execution's current plan has reached `completed` or `skipped` — never `pending`/`failed`. An execution with no plan at all passes vacuously (nothing was ever required); one with an unresolved plan is refused outright (`InsufficientCompletionEvidenceError`). There is no field anywhere in this API that accepts a narrative "I'm done" claim.

## Authorization

Two distinct gates (`src/lib/agent-runtime/authz.ts`), never conflated: `requireExecutionManageAuthority` (human — organization owner/admin, or the execution's own accountable `ownerUserId`, the same interim fallback used throughout this codebase) for create/assign/start/pause/resume/cancel/retry/approve; `requireAssignedAgent` + `revalidateAgentEligibility` (agent — must be the execution's actual assigned agent, and not retired, re-checked live on every call) for advance/complete/fail/plan/artifact/delegate. No global administrator exists anywhere in this module.

## APIs

17 routes under `/api/organizations/{organizationId}/agent-executions/...`. Human-driven routes use the existing session-cookie path; agent-driven routes reuse Brain Module 16's exact `Authorization: Bearer <agent credential>` mechanism unchanged, with the path's own `organizationId` checked against the credential-resolved agent's real organization (mismatch → 404, never 403 — cross-tenant existence is never confirmed).

## Audit

27 new event types in `audit_logs`, plus the richer, execution-scoped `agent_execution_events` timeline stream (§10's "Events" — one underlying append-only source every other observability view projects from). Both are written together from one call site (`events.ts`'s `recordExecutionEvent`), so they can never drift apart.

## Concurrency

Verified directly: two workers racing to `assignExecution`/`startExecution` on the same row — exactly one succeeds, the loser gets `InvalidExecutionTransitionError`, never a silent double-claim or double-start.

## Tests

41 new integration tests across 5 files (`lifecycle` 15, `approvals` 7, `delegation` 7, `artifacts-checkpoints-dependencies` 7, route-level 5), covering every scenario this module's own task explicitly required, plus two real bugs caught before they shipped (see below).

## Verification

Unit 189/189 (unchanged), integration [see final report for the confirmed count], a11y 52/52 (unchanged, no UI), typecheck/lint/build/db:check clean, DB confirmed empty after tests via direct row-count query.

## Bugs found and fixed during this module

1. `delegateExecution` returned the parent's post-transition state as BOTH `child` and `parent` in its result — the actual child execution was never returned. Caught by a lint warning on an unused variable before any test ran against it.
2. `timeoutExpiredDelegations` initially marked EVERY active delegation as timed out regardless of whether it was actually past its deadline (the `WHERE` clause was missing the timeout comparison). Caught during self-review before writing its test.

## Deferred (explicitly, per this phase's own scope)

LLM provider integration, a generic external tool marketplace, Gmail/Slack/WhatsApp/CRM/browser/calendar/payment tools, the visual workflow builder, scheduled workflows, Marketing/Sales agents, customer-facing autonomous execution, unrestricted multi-agent orchestration, a dedicated "approver" role distinct from organization owner/admin, and automatic wake-up when a delegated child completes (checked explicitly via `checkDelegationResult`, matching this phase's "deterministic, test-executor-driven" requirement rather than an event-driven notification system).

## Update (Tool Runtime Foundation, Module 8, now complete)

This module's `executing` state now does something real: `invokeTool` (`src/lib/tools/invocation.ts`) reuses `requireAssignedAgent`/`revalidateAgentEligibility`/`resolveExecutionById`/`transitionExecutionStatus` exactly as designed here — no second execution-authorization path. The completion-evidence gate (`completeExecution`) is exercised for the first time by a real, non-test-executor agent (the Company Knowledge Analyst) whose plan steps are only resolved once actual tool calls actually succeed — proving the gate holds under a genuine, non-synthetic workload. `requestApproval`/`approveRequest` are likewise exercised for the first time by a real gated tool call rather than a direct test call. See `MODULE_8_TOOL_RUNTIME_FOUNDATION.md` and `MODULE_8_FIRST_WORKING_AGENT.md`.

## Update (Runtime Recovery and Workers, Module 9, now complete)

§8's own deferred item — "a reconciliation pass finds every task last recorded as 'in progress' with no recent heartbeat, and resumes each from its last durable checkpoint" — is now real (`src/lib/runtime/reconciliation-executions.ts`). Nothing about this module's own state machine, transitions, or authorization changed; Module 9 only adds a durable job queue and worker that call `advanceExecution`/`completeExecution`/`invokeTool` exactly as this module and Module 8 already defined them. The Company Knowledge Analyst's task flow was split into a fast synchronous creation phase and a resumable continuation phase (`continueKnowledgeAnalystExecution`) so a worker can drive it across process restarts — the underlying plan/step/tool-call semantics are unchanged, only *when* each part runs. See `MODULE_9_RUNTIME_RECOVERY_AND_WORKERS.md`.

## Update (LYNQ Projects Core, Module 10, now complete)

The first caller to launch an execution from *outside* the Runtime/Tool-Runtime/worker system itself: a human creates a `project_tasks` row, then explicitly requests a Knowledge Analyst execution for it. `src/lib/projects/links.ts`'s `launchKnowledgeAnalystForTask` calls the existing `createKnowledgeAnalystTask` (Module 9) completely unmodified — no second execution-creation path, no change to this module's state machine, authorization, or artifact model. A new `project_execution_links` table (Module 10's own schema) records the link between the task and the real `agent_executions` row; the execution's own `assignedAgentId`/`assignedAgentVersionNumber` (this module's Execution Context) is what carries the real agent identity forward — Module 10 never re-implements or duplicates that. Task status in `project_tasks` is never auto-changed by execution progress; human project status remains authoritative by construction. See `MODULE_10_PROJECTS_CORE.md`.

## Update (LYNQ Workflow Engine Core, Module 11, now complete)

The second caller (after Projects Core) to drive executions from outside the Runtime/Tool-Runtime/worker system, and the first to drive them for reasons other than the Knowledge Analyst's own task flow. Every workflow node type that needs a Runtime-shaped unit of work — `agent_execution`, `tool_invocation`, `approval`, `artifact_transform` — creates a real `agent_executions` row and drives it through this module's exact, unmodified lifecycle (`createExecution → assignExecution → startExecution → advanceExecution → completeExecution`). `agent_execution` nodes use the real Knowledge Analyst driver (the only one this codebase has); the other three create a minimal "shell" execution with no plan, for which the completion-evidence gate this module defined passes vacuously — proving that gate correctly treats "no plan was ever created" as distinct from "a plan was created but never resolved." No change to this module's own state machine, transitions, or authorization was needed. See `MODULE_11_WORKFLOW_ENGINE_CORE.md`.

## Update (Generic Agent Execution, Module 14, now complete)

No change to this module's own state machine, transitions, or authorization. Module 14 added a bounded, in-code typed contract (`src/lib/agent-runtime/task-handlers.ts`) one layer above this one — every registered handler still drives an execution through this module's exact, unmodified lifecycle (`createExecution → assignExecution → startExecution → advanceExecution → completeExecution`), the same discipline Projects Core (Module 10) and the Workflow Engine (Module 11) already followed. This is what let the Workflow Engine's `agent_execution` node stop being hardcoded to one agent without touching this module at all. See `MODULE_14_AGENT_TASK_HANDLER_CONTRACT.md`.

## Update (LYNQ Analytics OS, Module 17, now complete)

Analytics OS reads this module's own canonical `agent_executions`/`tool_invocations`/`agent_approval_requests` tables through 7 read-only metrics (`agent_executions_running`, `agent_executions_completed`, `agent_executions_failed`, `agent_success_rate`, `agent_avg_execution_duration`, `tool_invocations_failed`, `approvals_pending`). Like Projects Core and the Workflow Engine, this module has no org-wide "view all executions in aggregate" authority of its own — `requireExecutionVisibility`/`requireExecutionManageAuthority` are deliberately per-execution — so Analytics OS uses plain organization membership as the aggregate-safe floor for these org-wide counts; drilling into one specific failed execution's own real detail still goes through this module's own real, unmodified per-execution authorization. `approvals_pending` is a live snapshot count, not bounded by the query's own date range, matching how a pending-approval queue is naturally consumed. This module's own state machine, transitions, schema, and authorization are entirely unchanged. See `MODULE_17_ANALYTICS_OS.md`.

## Update (LYNQ Founder Workspace / Executive OS, Module 18, now complete)

The Founder Approval Center is a thin, permission-gated wrapper over this module's own real, unmodified `listPendingApprovalsForApprover`/`approveRequest`/`rejectRequest`/`requestRevision` (§7) — never a second approval system. The Founder Analyst is one new agent registered at `assistant` permission level exactly like the Company Knowledge Analyst (Module 8) before it, driven through this module's own exact, unmodified execution lifecycle (`createExecution → assignExecution → startExecution → advanceExecution(planning/reasoning/executing/verifying) → completeExecution`) for its one task type (`founder_company_brief`, registered via Module 14's generic contract). Its task body is fully deterministic (no Brain access, no tool invocation) and writes exactly one `report` artifact through this module's own real artifact-creation path — verified directly by a test that launches the task and confirms a CRM record it read is byte-for-byte unchanged afterward. This module's own state machine, transitions, schema, and authorization are entirely unchanged. See `MODULE_18_FOUNDER_WORKSPACE.md` and `MODULE_18_EXECUTIVE_ATTENTION_AND_BRIEFING.md`.
