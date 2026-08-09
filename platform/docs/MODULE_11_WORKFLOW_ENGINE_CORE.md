# Module 11 — LYNQ Workflow Engine Core

A shared orchestration layer letting LYNQ define, version, validate, execute, monitor, pause, resume, and reuse structured business processes built entirely on top of the existing Agent Runtime (Modules 4/7), Tool Runtime (Module 8), durable job queue/workers/reconciliation (Module 9), Projects Core (Module 10), approvals, artifacts, and audit systems. No second execution engine, no second worker queue, no workflow-specific agents or tools, no fake project tasks — the Workflow Engine orchestrates existing systems and never duplicates their state.

> **Consumed by Module 13 (Sales OS)**: three starter templates (Lead Qualification, Opportunity Review, Follow-Up Sequence Workflow), all built from `human_task`/`approval` nodes only. Module 13 discovered and documents a real limitation here — `executeAgentExecutionNode` is hard-wired to Knowledge Analyst logic regardless of the node's own `agentId`, so no Sales OS template can safely use an `agent_execution` node until that dispatch becomes agent-generic. See `MODULE_13_SALES_OS.md`'s contradiction-reconciliation section and `MODULE_13_SALES_PLAYBOOKS_AND_AUTOMATION.md`.

## Contradiction reconciliation (pre-implementation review)

None found. Reviewed `MODULE_4_AGENT_RUNTIME_ARCHITECTURE.md`, `MODULE_7_AGENT_RUNTIME_CORE.md`, `MODULE_8_TOOL_RUNTIME_FOUNDATION.md`, `MODULE_9_RUNTIME_RECOVERY_AND_WORKERS.md`, `MODULE_10_PROJECTS_CORE.md`, and the current approval/artifact/audit/worker/queue/permission source. Two design tensions were real but resolved structurally rather than by exception:

- **"Orchestrate, never duplicate" vs. a node needing a Runtime-shaped unit of work** (`tool_invocation`, `approval`, `artifact_transform`): resolved by having each such node type create its own minimal, dedicated `agent_executions` row (a "shell" execution — no plan is ever created for it, so the completion-evidence gate passes vacuously) driven through the exact existing, unmodified lifecycle primitives (`createExecution` → `assignExecution` → `startExecution` → `advanceExecution` chain → `completeExecution`). This is the same Runtime state machine every other execution already uses, never a parallel mechanism.
- **"No second queue" vs. `neon-http` having no multi-statement transactions**: the entire codebase already has this constraint (`db.transaction()` is used nowhere) and already resolves it with atomic single statements plus revision guards. This module follows the identical discipline — see Concurrency in `MODULE_11_WORKFLOW_EXECUTION_AND_RECOVERY.md`.

## Files created and modified

**Schema**: `src/db/schema.ts` (appended) — 6 new enums, 8 new tables (`workflow_definitions`, `workflow_versions`, `workflow_nodes`, `workflow_edges`, `workflow_executions`, `workflow_node_executions`, `workflow_human_tasks`, `workflow_execution_events`); `runtimeJobTypeEnum` extended with 4 values; `runtime_jobs` extended with a `workflow_execution_id` column + index. Migrations: `drizzle/0023_condemned_titanium_man.sql`, `drizzle/0024_calm_shadow_king.sql` (composite-FK → single-column fix), `drizzle/0025_melted_liz_osborn.sql` (NULL-`conditionKey` partial unique index).

**Services** (`src/lib/workflows/`, 16 files): `errors.ts`, `validation.ts`, `authz.ts`, `events.ts`, `definitions.ts`, `versions.ts`, `nodes.ts`, `edges.ts`, `graph-validation.ts`, `mapping.ts`, `executions.ts`, `node-executions.ts`, `human-tasks.ts`, `scheduling.ts`, `templates.ts`, `reconciliation.ts`, `engine.ts` (the execution engine itself), plus `test-helpers.ts`.

**Modified existing modules**: `src/lib/runtime/queue.ts` (+`workflowExecutionId` on `EnqueueJobInput`), `src/lib/runtime/worker.ts` (+4 job-type switch cases, +`UnsupportedAgentDriverError` classification), `src/lib/runtime/validation.ts` (+4 `RUNTIME_JOB_TYPES` entries), `src/lib/agent-runtime/approvals.ts` (+`listPendingApprovalsForApprover`), `src/lib/dashboard/actions/projects.ts` (`transitionTaskAction` now notifies linked workflows via a narrow dynamic import), `src/lib/dashboard/nav-items.ts` (+3 nav items: Workflows, Workflow Executions, My Work).

**APIs**: 22 route files under `src/app/api/organizations/[organizationId]/workflows/...`, `workflow-executions/...`, `workflow-human-tasks/...`.

**Dashboard**: `src/lib/dashboard/actions/workflows.ts` (~20 server actions); 6 pages under `src/app/app/[organizationSlug]/{workflows, workflows/new, workflows/[workflowId], workflows/[workflowId]/builder, workflow-executions, workflow-executions/[executionId]}` (`my-work` already existed from Module 10 and was extended); 19 components under `src/components/dashboard/workflows/`.

**Tests**: 5 integration files (`definitions-versions`, `graph-validation`, `nodes-edges`, `engine`, `concurrency` — 38 tests) under `src/lib/workflows/`; 6 a11y files (17 tests) under `src/components/dashboard/workflows/`.

**Audit**: `src/lib/audit.ts` (modified) — 25 new `AuditEventType` values.

## Schema and migrations

8 new tables, every one tenant-scoped by a direct `organizationId` FK (`onDelete: cascade` from `organizations`) — deleting an organization cascades every workflow record away with no separate cleanup path, verified directly (see Verification below). Child tables use composite `(id, organizationId)` FKs to their parent, the same tenant-safe pattern every prior module established. "Soft back-reference" pointer columns (`workflow_executions.projectId`/`projectTaskId`/`currentNodeId`, `workflow_node_executions.runtimeExecutionId`/`projectTaskId`) are deliberately **single-column**, not composite — a composite FK with `ON DELETE SET NULL` would null out both columns including the `NOT NULL organizationId`, which is exactly the bug this module hit and fixed (migration `0024`; see Bugs discovered in the final report).

Key constraints:

- `workflow_definitions_org_key_unique (organizationId, workflowKey)` — workflow keys unique within an org.
- `workflow_versions_definition_number_unique (workflowDefinitionId, versionNumber)`.
- `workflow_versions_one_published_unique` — a **partial unique index** on `workflowDefinitionId` `WHERE status = 'published'`. This is the one real atomic guarantee behind "only one current published version may exist" — see Versioning below for why it, not the definition's own cached pointer, is the actual source of truth.
- `workflow_nodes_version_key_unique (workflowVersionId, nodeKey)` — node keys unique per version.
- `workflow_edges_source_target_condition_unique (sourceNodeId, targetNodeId, conditionKey)` **plus** a supplementary partial unique index `workflow_edges_source_target_null_condition_unique` on `(sourceNodeId, targetNodeId) WHERE conditionKey IS NULL` — Postgres treats `NULL` as distinct from `NULL` in a plain unique constraint, so an unconditional duplicate edge (the common case: no branching) would otherwise never be caught. Found via a real failing test, not by inspection.
- `workflow_node_executions_attempt_unique (workflowExecutionId, workflowNodeId, attemptNumber)` — one logical node execution cannot run twice at the same attempt number.
- `workflow_node_executions_active_unique` — a partial unique index on `(workflowExecutionId, workflowNodeId)` `WHERE status IN ('pending','ready','running','waiting')` — at most one *active* attempt per node per execution, ever.
- `workflow_human_tasks_node_execution_unique (workflowNodeExecutionId)` — a human task has exactly one owning node execution, one-to-one.

Migrations generated via `drizzle-kit generate`, applied via the established scratch-integration-test workaround (`neon-http` has no migration runner), verified against the full schema dump. `npx drizzle-kit check` reports "Everything's fine" after all three migrations.

## Workflow definition model

`id, organizationId, workspaceId?, name, workflowKey, description, status, currentPublishedVersionId?, isTemplate, createdByUserId?, revision, archivedAt?, createdAt, updatedAt`. Lifecycle: `draft → published → paused → archived` (bounded, explicit — enforced the same revision-guarded atomic-`UPDATE` pattern every prior module uses for status machines). Editing a published workflow never mutates the version prior executions used — it creates a new **draft** version (`createDraftVersion`), leaving `currentPublishedVersionId` untouched until that new version is itself published.

## Versioning model

`id, organizationId, workflowDefinitionId, versionNumber, status, name, description, inputSchema?, outputSchema?, createdByUserId?, changeReason?, validationResult?, publishedAt?, revision, createdAt`. States: `draft → valid → published → superseded`, or `draft/valid → rejected`. Published versions are never modified — no service function in `versions.ts` accepts an update to a `published`/`superseded` row; the only way to change behavior is to create and publish a new draft.

`resolvePublishedVersion` **never trusts** `workflow_definitions.currentPublishedVersionId` as ground truth — that column is a fast-path cache only. Every read that needs "the current published version" re-queries `workflow_versions WHERE workflow_definition_id = ? AND status = 'published'` live. The `workflow_versions_one_published_unique` partial index is the actual atomic guarantee; the cached pointer can never diverge from it in a way that matters, because nothing is ever allowed to read the pointer as authoritative. This is a deliberate, documented design choice given `neon-http`'s structural lack of multi-statement transactions — the same honest-limitation pattern Module 10 established for its own last-owner-protection race.

Publishing (`publishWorkflowVersion`) is revision-guarded and requires the version to already be `valid` (i.e., `validateWorkflowGraph` has already run and passed) — publication fails unless validation succeeded, enforced in code, not just by convention.

## Graph and validation model

**Nodes** (`workflow_nodes`): `workflowVersionId, nodeKey (stable, unique per version), nodeType, name, description?, configuration (jsonb, validated per node type by zod), inputMapping, outputMapping, retryPolicy, timeoutPolicy, positionX/positionY (UI layout only), createdAt`. Exactly the 10 approved node types — see Node types below. Configuration is always structured, typed JSON validated against a per-node-type zod schema in `nodes.ts`; there is no field anywhere a node can store executable code, a SQL fragment, a shell command, or an unrestricted expression string.

**Edges** (`workflow_edges`): `workflowVersionId, sourceNodeId, targetNodeId, conditionKey?, sequence, label?, createdAt`. Both endpoints are required to belong to the *same* `workflowVersionId` (checked in `edges.ts` before insert — the version-scoped composite unique on nodes makes a cross-version edge structurally rejectable, not just application-checked). No self-edges. No duplicate active edge (see Schema above). `createWorkflowEdge` also re-runs cycle detection on every insert, not only at publish time.

**Validation** (`graph-validation.ts`, `validateWorkflowGraph`) is deterministic and runs before every publish attempt: exactly one `start` node; at least one `end` node; node keys unique (enforced by the DB constraint, re-checked here for a structured error); every edge's endpoints belong to this version; no unsupported cycles (BFS-based, bounded); every node reachable from `start`; every non-terminal path eventually reaches an `end` node or a bounded `wait`; condition-node branches are complete (an `else`/default path exists or every branch is covered) and non-duplicated; node configuration matches its type's own schema (re-validated independently of the creation-time check — defense in depth, exercised directly by a test that inserts an invalid node via a raw `db.insert` to bypass the service layer's own guard); referenced agents exist and are eligible (not retired); referenced tools and tool versions exist and are enabled; approval-node configuration is structurally valid; project-task-node configuration is tenant-safe; input/output mappings reference only valid prior-node outputs or workflow inputs; retry/timeout policies are bounded (a maximum attempt count and a maximum timeout, never unbounded). Returns a structured `{ valid, issues: [{ nodeKey?, edgeId?, message }] }` — never a bare boolean.

DAG only, deliberately — the spec explicitly deferred arbitrary loops to a future module; a bounded per-node retry (see Failures and retries) is not a workflow-graph cycle and is unaffected by this restriction.

## Node types

Exactly the 10 approved types, no more:

| Type | Behavior |
|---|---|
| `start` | Synchronous. Seeds the mapping context with the workflow's own input. Exactly one per version, enforced by validation. |
| `end` | Synchronous. Terminal — reaching it completes the workflow execution. At least one per version. |
| `agent_execution` | Asynchronous. Creates a real `agent_executions` row for the **Company Knowledge Analyst only** — the one node type genuinely requiring multi-step agent reasoning, and the only real driver this codebase has. Both publish-time validation and execution-time dispatch (`UnsupportedAgentDriverError`) enforce this scope honestly rather than silently degrading for any other agent. |
| `tool_invocation` | Asynchronous. Creates a minimal "shell" `agent_executions` row driven through the unmodified Runtime lifecycle, then calls the real, unmodified `invokeTool` (Module 8's own 9-step gate) exactly once. |
| `human_task` | Asynchronous. Creates a `workflow_human_tasks` row assigned to a real user; the workflow execution moves to `waiting` until it's completed through the human-tasks API — never auto-completed by the engine itself. |
| `approval` | Asynchronous. Creates a shell execution and a real `agent_approval_requests` row (Module 7, unmodified). Reads the decision only from that real record — never duplicates or re-derives the decision. |
| `condition` | Synchronous. Evaluates a safe, versioned operator against mapped input (see Branching) and selects exactly one outgoing edge. |
| `wait` | Asynchronous (bounded delay). Schedules a continuation job at `availableAt`; survives worker restart by construction, since the delay lives in the durable job row, not in-process. |
| `project_task` | Asynchronous. Either links to an existing Projects Core task or creates a new one (Module 10, unmodified) via `project_execution_links`-equivalent typed pointer. Does **not** treat the Runtime execution as the project task, and does not auto-complete the task — human project status remains authoritative; the workflow only observes the task's own status. |
| `artifact_transform` | Asynchronous. Creates a shell execution, reads results only from real artifacts or structured tool/agent output — never assumes success from narrative text — and never mutates a historical artifact; a transform always produces a new artifact record. |

## Execution and node-execution lifecycle

See `MODULE_11_WORKFLOW_EXECUTION_AND_RECOVERY.md` for the full execution model, node-execution model, queue/worker integration, pause/resume/cancellation, reconciliation, and concurrency guarantees — kept in a companion doc since that material is substantial on its own and mirrors Module 9's own split (core architecture vs. recovery/workers).

## Data mapping

`mapping.ts` supports exactly four bounded source kinds: a workflow input, a prior node's output (by `nodeKey`), an artifact reference, and a fixed literal — plus trusted organization/workspace values pulled from the real execution context, never from user input. There is no code path evaluating arbitrary expressions, dynamic SQL, shell commands, or template strings with user-controlled interpolation. Mappings are validated at publish time wherever the referenced node/output is statically known (i.e., always, since the graph is a DAG evaluated in topological order); a runtime mapping failure (a referenced output genuinely absent, e.g. an upstream node was skipped) produces a deterministic node failure record, never a silent `undefined`.

## Branching

`evaluateConditionBranches` supports a fixed, versioned operator registry: `equals, not_equals, exists, not_exists, greater_than, less_than, contains, in, status_is, approved, rejected`. Every operator is a pure function over already-mapped input — no LLM reasoning is ever in the branch-selection path, so a condition node's outcome is fully deterministic and reproducible given the same input. Exactly one outgoing edge is selected per evaluation; parallel fan-out is explicitly out of scope for this module (validation rejects a condition node whose branches aren't complete and non-overlapping).

## Human tasks

`human-tasks.ts` — a `workflow_human_tasks` row is one-to-one with its owning node execution (unique constraint), assigned to a real user, with `pending/completed/cancelled` states. Completion is single-use (revision-guarded) and, on success, calls `enqueueWorkflowContinuation` so the owning workflow execution resumes without a human needing to separately "unstick" it.

## Approval integration

An `approval` node's shell execution creates a real `agent_approval_requests` row through Module 7's own unmodified `requestApproval`. The node execution never duplicates or caches the decision — `resolveAsyncNodeState` reads the approval's live status directly. Because `approveRequest`/`rejectRequest` (Module 7) have no knowledge of workflows, `notifyApprovalDecided` (`scheduling.ts`) is called from the dashboard action layer (`approveApprovalAction`/`rejectApprovalAction`) as a narrow, opportunistic lookup — a guaranteed no-op for any non-workflow-linked approval — with workflow reconciliation as the generic backstop for any other entry point (e.g. a direct API call) that doesn't go through those two actions.

## Agent Runtime integration

Every asynchronous node type ultimately drives a real `agent_executions` row through the exact, unmodified Module 7 lifecycle (`createExecution → assignExecution → startExecution → advanceExecution → completeExecution`) — either the real Knowledge Analyst driver (`agent_execution` nodes) or a minimal shell execution with no plan (`tool_invocation`/`approval`/`artifact_transform` nodes, for which the completion-evidence gate passes vacuously since no plan was ever created). No workflow-specific agent, no parallel execution mechanism, no bypass of Runtime authorization.

## Tool Runtime integration

`tool_invocation` nodes call the real, unmodified `invokeTool` (Module 8) exactly once per node execution, recording the resulting `toolInvocationId` on the node execution row. Tool permission/eligibility checks are Module 8's own, re-evaluated live on every call — a workflow node never caches "this tool was allowed last time."

## Project integration

Optional link to a project task via `project_task` nodes or by starting an execution with a `projectId`/`projectTaskId`. The workflow never auto-completes a project task — verified directly by a test (`start -> project_task -> end ... never auto-completes it`) that drives a project-linked execution to `waiting`, confirms the task is still open, then completes the task through Projects Core's own API and confirms the *workflow* (not the task) reacts, via `notifyProjectTaskChanged`. Human project state remains authoritative by construction, matching Module 10's own rule that this module reuses rather than reinterprets.

## Workflow templates

Templates are ordinary workflow definitions with `isTemplate: true` — no separate execution architecture, no separate storage. `templates.ts` provides exactly the 2 approved starter templates, idempotent by `workflowKey`:

1. **Knowledge Report Workflow** (`KNOWLEDGE_REPORT_TEMPLATE`): `start → agent_execution (Knowledge Analyst) → approval → end`.
2. **Project Research Task Workflow** (`PROJECT_RESEARCH_TASK_TEMPLATE`): `start → project_task (create/link) → agent_execution (Knowledge Analyst) → artifact_transform (link report artifact) → end`.

Both are structure only — no fabricated business content, no fake results. `seedTemplatesForOrganization` requires the Knowledge Analyst to already exist in the target org before seeding either template (both reference it), matching every other workflow test fixture's own precondition.

## APIs

22 routes, following this codebase's established `parseUuidParam`/`.strict()` Zod/`getAuthenticatedUser`/`jsonSuccess`/`handleRouteError` pattern:

- `GET/POST /api/organizations/{organizationId}/workflows`, `GET/PATCH /{workflowId}`, `POST /{workflowId}/transition`
- `GET/POST /{workflowId}/versions`, `GET /{versionId}`, `POST /{versionId}/validate`, `POST /{versionId}/publish`
- `GET/POST /{versionId}/nodes`, `GET/PATCH/DELETE /{nodeId}`
- `GET/POST /{versionId}/edges`, `DELETE /{edgeId}`
- `POST /{workflowId}/executions`, `POST /seed-templates`
- `GET/POST /api/organizations/{organizationId}/workflow-executions`, `GET /{executionId}`, `GET /{executionId}/timeline`, `POST /{executionId}/{pause,resume,cancel,retry}`
- `GET/POST /api/organizations/{organizationId}/workflow-human-tasks`, `GET/POST /{taskId}` (complete)

Route handlers are thin — all authorization, validation, and business logic live in the service layer; a route's job is parse → call service → serialize.

## UI and accessibility

`/app/[organizationSlug]/workflows` (list: name, key, status, current version, workspace, last updated, actions), `/workflows/new`, `/workflows/[workflowId]` (detail + version history + publish control), `/workflows/[workflowId]/builder` (a simple, accessible, structured builder — an explicit node list with add/edit forms and a connect-nodes form, deliberately **not** a drag-and-drop canvas, per the spec's own accessibility-over-visual-complexity instruction), `/workflow-executions` (list), `/workflow-executions/[executionId]` (status, current node, node timeline, linked agent executions/tool invocations/approvals/artifacts/project links, retry/cancel controls where authorized), `/my-work` (extended from Module 10 — now also lists assigned workflow human tasks and pending workflow approvals alongside project tasks).

19 components, all typechecked/linted clean. 6 dedicated `.a11y.test.tsx` files (17 tests) cover the genuinely novel interactive patterns: `ValidationPanel` (structured issue list as an accessible `role="alert"` region, polite `role="status"` on success), `WorkflowStatusControl`, `HumanTaskCard`, `PendingApprovalCard`, `CreateNodeForm`, `ExecutionControls` — every one passes with zero axe violations. No fake metrics, no fake executions, no placeholder progress — an execution with no node history yet shows an explicit empty state.

## Audit events

25 new `AuditEventType` values: `workflow_created, workflow_updated, workflow_archived, workflow_version_created, workflow_version_validated, workflow_version_published, workflow_execution_created, workflow_execution_started, workflow_execution_paused, workflow_execution_resumed, workflow_execution_completed, workflow_execution_failed, workflow_execution_cancelled, workflow_node_started, workflow_node_completed, workflow_node_failed, workflow_human_task_created, workflow_human_task_completed, workflow_approval_linked, workflow_agent_execution_linked, workflow_tool_invocation_linked, workflow_artifact_linked, workflow_project_linked, workflow_reconciled, workflow_permission_denied`. Every one carries bounded metadata (ids, node keys, status transitions) — never full node inputs/outputs, artifact content, secrets, or agent reasoning text.

`workflow_execution_events` is a structurally separate, user-facing operational timeline (mirroring `project_events`'s own split from `audit_logs`) — every audited mutation also writes one, but the two tables serve different purposes and are never merged.

## Tests

38 integration tests across 5 files (`definitions-versions`, `graph-validation`, `nodes-edges`, `engine`, `concurrency`) plus 17 a11y tests across 6 files — covering the module spec's required scenarios: invalid workflows can't publish (missing start, missing end path, unsupported cycle, invalid condition config, invalid mapping, missing referenced agent/tool), permission revocation stops the next gated node, a retired agent fails its node, a disabled tool fails its node, an approval node genuinely waits for a real decision and a rejection follows the configured failure behavior, a wait node survives a simulated restart, a project-task link is tenant-safe and never auto-completed, an artifact remains a real Runtime artifact, a published version stays historically traceable and an execution uses the exact version it started with, worker interruption resumes safely, cross-tenant access resolves to 404, no secrets or hidden reasoning appear in any audit/event payload, plus every required concurrency scenario (see `MODULE_11_WORKFLOW_EXECUTION_AND_RECOVERY.md`).

## Verification

- `npm run typecheck` — clean.
- `npm run lint` — clean (0 errors, 0 warnings).
- `npm test` (unit) — 196/196 passing (25 files), no regressions.
- `npm run test:integration` — **865/865 passing (95 files)** in a clean, uncontended run. One workflow test (the two-flow approval scenario) needed its per-test timeout raised from the 20s default to 30s to absorb full-suite parallel contention, matching existing precedent elsewhere in this codebase for heavy multi-round-trip tests — not a logic bug (confirmed passing in isolation both before and after).
- `npm run test:a11y` — **88/88 passing (24 files)**, zero regressions.
- `npx drizzle-kit check` — "Everything's fine."
- `npm run build` — production build succeeds; all 22 new API routes and 6 new pages compile and appear in the route manifest.
- Direct Postgres verification: all 8 `workflow_*` tables confirmed **empty** after a full test-suite run.
- Manual end-to-end verification: a real session cookie and a real worker credential against the live dev server and live Postgres — created a workflow, added `start → wait → end` nodes and edges, validated, published (revision-guarded, confirmed a stale-revision attempt is rejected), started an execution, polled the real worker endpoint to drive it through the real queue, and confirmed it reached `completed` with every node execution `succeeded`, a correct audit/event timeline, and the workflow list/detail/execution pages all server-rendering real content. All manually created test data — including 21 pre-existing orphaned test organizations discovered along the way, left over from two earlier interrupted full-suite runs (network/DNS failures, not code regressions) — was cleaned up afterward; the dev server was stopped.

## Deferred (explicitly, per this module's own scope)

Kids Coding Operations, Home Renovation Rebate Platform, CRM, Marketing OS, Sales OS, external integrations, arbitrary graph loops, parallel fan-out/fan-in, scheduled/cron-triggered workflow starts, external-event triggers, a visual drag-and-drop builder canvas, any agent driver beyond the Company Knowledge Analyst, automatic project-task completion from workflow completion (would require an explicit future opt-in rule per task, not implemented), a standalone workflow API reference doc (routes are self-documenting per this codebase's existing convention, matching Module 10's own precedent).

## Update (LYNQ CRM Core, Module 12, now complete)

A workflow execution may now carry CRM record references — `startWorkflowWithCrmContext` (CRM's own module) resolves `crmContactId`/`crmCompanyId`/`crmLeadId`/`crmOpportunityId` tenant-safely, then calls this module's own, completely unmodified `startWorkflowExecution`, placing the resolved ids (never full records) into the execution's existing bounded `input` JSON under four reserved keys. This required **zero changes** to this module's own code — the existing `workflow_input` mapping source (`src/lib/workflows/mapping.ts`) already reads arbitrary keys out of that input object, so a node can reference `{ source: "workflow_input", path: "crmContactId" }` with no new mapping-source kind. No CRM automation trigger exists; every CRM-context workflow start is an explicit call. See `MODULE_12_CRM_WORKFLOW_AND_PROJECT_INTEGRATION.md`.

## Update (Generic Agent Execution, Module 14, now complete)

`agent_execution` is no longer bound to "any agent driver beyond the Company Knowledge Analyst" — the limitation this doc listed above is resolved. The node type now dispatches through a bounded, in-code typed agent task handler registry (`src/lib/agent-runtime/task-handlers.ts`) instead of a single hardcoded `createKnowledgeAnalystTask` call; Company Knowledge Analyst, Lead Research Assistant, and Opportunity Summary Assistant are all reachable through it today. Node configuration changed shape (`{agentId, agentTaskType, expectedOutputKey?}`, field mapping moved to the node's existing `inputMapping`) for newly-created nodes only — historically-published rows keep their old shape and are resolved to `company_knowledge_report` at execution time, never rewritten in place. See `MODULE_14_GENERIC_AGENT_EXECUTION.md` and `MODULE_14_AGENT_TASK_HANDLER_CONTRACT.md` for full detail, including the concurrency-claim hardening this module also added to `dispatchAsyncNode`.

## Update (LYNQ Marketing OS Core, Module 15, now complete)

Marketing OS is the first module to build starter workflow templates that use the `agent_execution` node's post-Module-14 generic form from day one — three templates (Campaign Planning, Content Creation, Campaign Review), each with `{agentId, agentTaskType}` configuration and `inputMapping` sourcing values from `workflow_input`, dispatching to one of three new Marketing agents through the same task handler registry Module 14 built. No engine code changed: `executeAgentExecutionNode`, `resolveAsyncNodeState`, and the claim-then-launch concurrency guard all behave identically for a Marketing task type as for any other registered handler — proving the registry is genuinely agent-generic, not merely CRM/Sales-aware. See `MODULE_15_MARKETING_OS.md` and `MODULE_15_MARKETING_PLAYBOOKS_AND_AGENTS.md`.

## Update (LYNQ Communications & Integrations Core, Module 16, now complete)

Communications OS deliberately did not need a new starter workflow template or any `agent_execution` node usage — its own two agent task types (`communications_draft_reply`, `communications_draft_follow_up`) are reached through direct-launch APIs, exactly like Sales/Marketing OS's own agents. What it DID prove generic instead is the `tool_invocation` node type: four new Tool Runtime tools (`communications.create_draft`, `communications.send`, `communications.get_status`, `communications.list_conversation`) are reachable by ANY workflow through the node type's already-existing `{agentId, toolKey}` configuration, with zero engine code changed — confirming `tool_invocation` was already generic across tool categories, not just the three Module 8 shipped with (the `"communication"` `tool_category` enum value existed in the schema from Module 8 onward, unused until now). This module's own engine code is entirely unchanged. See `MODULE_16_COMMUNICATIONS_CORE.md` and `MODULE_16_INTEGRATION_ADAPTERS.md`.

## Update (LYNQ Analytics OS, Module 17, now complete)

Analytics OS reads this module's own canonical `workflow_executions` table through 5 read-only metrics (`workflows_running`, `workflows_completed`, `workflows_failed`, `workflow_completion_rate`, `workflow_avg_duration`). This module has no org-wide "view all executions in aggregate" authority of its own — `requireWorkflowExecutionViewAuthority` is deliberately per-execution — so Analytics OS uses plain organization membership as the aggregate-safe floor for these org-wide COUNTS, documented explicitly as a deliberate distinction from CRM/Sales/Marketing/Communications OS's own narrower per-domain view-authority functions (see `MODULE_17_ANALYTICS_AUTHORIZATION_AND_PRIVACY.md`). A caller drilling into one specific failed execution's own real detail still goes through this module's own real, unmodified per-execution authorization — Analytics OS's own drill-down only ever returns a bounded execution-id list, never the execution's own content. This module's own engine code, schema, and authorization are entirely unchanged. See `MODULE_17_ANALYTICS_OS.md`.

## Update (LYNQ Founder Workspace / Executive OS, Module 18, now complete)

The executive Operations view and the attention engine's own `failed_workflow` rule read this module's own canonical `workflow_executions` table directly, workspace-scoped. `workflowsWaitingForApproval` (a direct count of executions in `waiting_for_approval` status) is the one Founder-side figure this module's own state machine makes possible without going through Analytics OS at all. This module's own engine code, schema, and authorization are entirely unchanged. See `MODULE_18_FOUNDER_WORKSPACE.md`.
