# Module 10 — LYNQ Projects Core

Shared operational layer for managing real company projects (Kids Coding Operations, Home Renovation Rebate Platform, and LYNQ's own internal work), built directly on top of the existing organizations/workspaces, memberships, Agent Runtime, Tool Runtime, background workers, artifacts, approvals, and audit system. No separate project-management architecture, no Kids Coding or Home Renovation Rebate content, no CRM/Marketing OS/Sales OS/external integrations — all explicitly deferred per this module's own scope.

## Contradiction reconciliation (pre-implementation review)

None found. The spec's own two hard constraints — "do not reuse Agent Runtime executions as project tasks" and "do not represent agents as human project members" — are structurally satisfied rather than merely followed by convention:

- `project_tasks` is a genuinely new, human-facing entity, structurally separate from `agent_executions` (Runtime tasks). The only connection is a typed link table (`project_execution_links`), never a shared row.
- Agent involvement in a task is represented *entirely* by that link to a real `agent_executions` row. `project_task_assignments` (human task assignment) has no agent-shaped variant at all — there is no code path that could insert an agent there.
- The real agent identity and version ("preserve the real assigned agent version through Runtime context") are carried for free by the Runtime's own Execution Context (`agent_executions.assignedAgentId`/`assignedAgentVersionNumber`, Module 7) — nothing here re-implements that.

## Files created

**Schema**: `src/db/schema.ts` (appended) — `projects`, `project_members`, `project_phases`, `project_milestones`, `project_tasks`, `project_task_assignments`, `project_task_dependencies`, `project_events`, `project_artifact_links`, `project_execution_links`, `project_approval_links`, plus 6 new enums. Migration: `drizzle/0022_dusty_moira_mactaggert.sql`.

**Services** (`src/lib/projects/`): `errors.ts`, `validation.ts`, `authz.ts`, `events.ts`, `projects.ts`, `members.ts`, `phases.ts`, `milestones.ts`, `tasks.ts`, `dependencies.ts`, `links.ts`, `progress.ts`, `test-helpers.ts`.

**APIs**: 20 route files under `src/app/api/organizations/[organizationId]/projects/...` — projects (list/create/get/update/transition/activity), members, phases (+ reorder), milestones, tasks (+ transition/assignments/dependencies/agent-execution), artifacts, approvals.

**Dashboard**: `src/lib/dashboard/actions/projects.ts` (server actions); `src/app/app/[organizationSlug]/projects/{page.tsx, new/page.tsx, [projectId]/page.tsx, [projectId]/settings/page.tsx}`; 19 components under `src/components/dashboard/projects/`; `src/lib/dashboard/nav-items.ts` (modified — added a real "Projects" link).

**Tests**: 7 service-layer integration files + 1 route-level integration file under `src/lib/projects/` and `src/app/api/organizations/[organizationId]/projects/`, 6 a11y test files under `src/components/dashboard/projects/`.

**Audit**: `src/lib/audit.ts` (modified) — 21 new `AuditEventType` values.

## Schema and migrations

11 new tables, all tenant-scoped by a direct `organizationId` FK (`onDelete: cascade` from `organizations`), so deleting an organization cascades every project record away with no separate cleanup path required. Child tables use composite `(id, organizationId)` FKs to their parent (the same tenant-safe-FK pattern Modules 6/7 established), preventing a project's children from ever pointing at a same-`id`-different-org row. `project_tasks.parentTaskId` is a composite self-referencing FK (subtask → parent, cascade) — the same pattern `agent_executions.parentExecutionId` already uses.

Key constraints: `projects_org_key_unique (organizationId, projectKey)`; `project_members_project_user_unique`; `project_phases_project_sequence_unique`; `project_task_assignments_task_user_unique`; `project_task_dependencies_edge_unique` + a `CHECK` forbidding `blockedTaskId = blockingTaskId`; `project_artifact_links_unique (artifactId, linkedEntityType, linkedEntityId)`; `project_execution_links_execution_unique (executionId)`; `project_approval_links_unique (approvalRequestId, linkedEntityType, linkedEntityId)`. Every one of these is a real, enforced Postgres constraint, not an application-only check — see Concurrency below for which ones this actually protects under a race.

`project_tasks.taskType` is free `text`, deliberately not a DB enum — a new task type (e.g. a future `"agent_report"` variant) never needs `ALTER TYPE`, matching the `accounts.provider`/`audit_logs.event_type` precedent already established elsewhere in this codebase.

Migration generated cleanly via `drizzle-kit generate`, applied via the scratch-integration-test workaround (neon-http has no migration-runner), verified against the full schema dump, and `drizzle-kit check` reports "Everything's fine."

## Project lifecycle

Fields: `id, organizationId, workspaceId?, name, projectKey, description, objective, status, priority, startDate, targetDate, actualCompletionDate, ownerUserId, createdByUserId, revision, archivedAt, createdAt, updatedAt`. `projectKey` is unique per organization and immutable after creation — `updateProject` never accepts it.

States: `proposed, planning, active, paused, blocked, completed, cancelled, archived`. Exact transition map:

```
proposed  → planning, cancelled
planning  → active, cancelled
active    → paused, blocked, completed, cancelled
paused    → active, cancelled
blocked   → active, cancelled
completed → archived
cancelled → archived
archived  → (none)
```

`completed`/`cancelled` only ever reach `archived`; `archived` has no outbound edge — there is no code path back to any working state, so "completed/archived projects reject new work" holds by construction, not by an extra check. Every transition is revision-guarded (an atomic `UPDATE ... WHERE id = ? AND revision = ? AND status = ?`) and records both a `project_status_changed`/`project_archived` audit event and a `project_status_changed` project event in the same call. `getLegalProjectTransitions(status)` is exported specifically so the UI status picker can never even offer an illegal option.

## Membership model

Roles: `project_owner, project_manager, contributor, viewer`. A project member must already be an organization member (no new identities created here); a workspace-scoped project additionally requires the target to already be a member of that workspace. The project's first `project_owner` membership is created atomically with the project itself (never a project with zero owners, mirroring the organization-creation precedent). Last-owner protection reuses the exact `FOR UPDATE`-locking-CTE pattern `organizations/memberships.ts` established — a single atomic statement, race-safe by construction (see Concurrency).

## Phase and milestone model

Phases: `id, projectId, name, description, sequence, status (not_started/active/completed/cancelled), startDate, targetDate, completedAt, revision`. Sequence is gap-based (1000-increments): `reorderPhase` only ever changes the *moved* phase's own sequence to the midpoint of its new neighbors — never a multi-row swap, so no deferred constraint is needed. Falls back to a full renumber (fresh 1000-gaps) only when a gap is exhausted; verified directly by a test that forces adjacent sequences and confirms the renumber path produces distinct values.

Milestones: `id, projectId, phaseId?, title, description, status (planned/active/at_risk/completed/cancelled), targetDate, completedAt, ownerUserId, revision`. Completion is always an explicit status transition — `updateMilestone` never derives it from linked-task percentages; the milestone's *progress* against its linked tasks is a wholly separate, read-only calculation (`progress.ts`).

## Task model

`project_tasks`: `id, organizationId, projectId, phaseId?, milestoneId?, parentTaskId? (subtask), title, description, status, priority, taskType, startDate, dueDate, completedAt, createdByUserId, position, revision`. States: `backlog, ready, in_progress, blocked, review, completed, cancelled`, with an exact transition map enforced the same way as project status. Priorities: `low, normal, high, urgent` (shared enum with projects). "Move task" (between phase/milestone/parent, or reordering `position`) is just another field on the same revision-guarded `updateTask` call, not a separate operation. Ordinary APIs never hard-delete a task — there is no delete route for `project_tasks` at all, only status transitions (`cancelled` is the closest equivalent to "removed," and it's still permanent history).

A task cannot transition to `completed` while it has an unresolved blocking dependency (see Dependency model) — `transitionTaskStatus` checks `getUnresolvedBlockingTaskIds` first and throws `UnresolvedDependenciesError` if any exist.

## Assignment model

`project_task_assignments`: human members only, by construction — the table has no agent-shaped column, and no code path writes an agent id into `userId`. Assignment transfers *responsibility* only: `assignTask` never touches Brain grants, tool permissions, or Runtime authorization — it inserts exactly one row (`taskId, userId`), unique per pair. Agent involvement in a task is represented entirely by `project_execution_links` (see Agent Runtime integration below) — never a row here.

## Dependency model

`project_task_dependencies`: one canonical directed edge per row (`blockingTaskId` blocks `blockedTaskId`); "blocks"/"blocked_by" are both derived views over the same table queried from either column, never stored twice. Rules enforced: no self-dependency (`CHECK` constraint + an explicit pre-check), no duplicate edge (unique constraint), no cross-project dependency (`CrossProjectDependencyError` if the two tasks' `projectId`s differ), no cycle — `wouldCreateCycle` runs a bounded BFS (max 2000 traversed edges, appropriate for a single project's task graph) before insert, tested directly against both a 2-node direct cycle and a 3-node indirect cycle. Dependency removal is always audited (`project_task_dependency_removed`). Completion eligibility (`getUnresolvedBlockingTaskIds`) treats a blocker as unresolved unless it has actually reached `completed` — a *cancelled* blocker still requires the edge to be explicitly removed, never silently treated as satisfied.

## Progress calculation

Deterministic, never user-entered — there is no field anywhere in this module for a human to type a completion percentage. `{ completedCount, eligibleCount, percentage }`:

- **Project progress** = completed non-cancelled tasks (at every depth, including subtasks) ÷ non-cancelled tasks in the project.
- **Milestone progress** = completed non-cancelled tasks linked to that milestone ÷ non-cancelled tasks linked to that milestone.
- Cancelled tasks are excluded from **both** the numerator and the denominator — they never count as completed work, and they never inflate or deflate the denominator either.
- `percentage` is `null` (not `0`) whenever `eligibleCount === 0`, so "nothing to do yet" is never visually indistinguishable from "0% done with real work pending." The UI renders this as "No tasks yet."

## Artifact integration

Reuses the existing Agent Runtime artifact system (`agent_artifacts`, Module 7) exclusively — `project_artifact_links` is a typed pointer (`artifactId, linkedEntityType, linkedEntityId`) and never copies artifact content; verified directly by a test asserting the link row's own JSON never contains the linked artifact's content string. Duplicate links (same artifact + same entity) are rejected by a real unique constraint. Linking an artifact never makes it Brain knowledge — no code path in this module writes to `knowledge_items`.

## Agent Runtime integration

Bounded to the Company Knowledge Analyst only, this phase, exactly as scoped. Flow: a human creates a task → explicitly requests a Knowledge Analyst execution (topic + allowed Brain domains) → `launchKnowledgeAnalystForTask` calls the real, unmodified `createKnowledgeAnalystTask` (Module 9's split creation function) → a `project_execution_links` row records the link → the worker processes the execution normally, exactly as Module 9 already built it. Task status is **never** auto-changed by a launch or by execution progress — human project status remains authoritative, by construction (no code path writes to `project_tasks.status` from anywhere in `links.ts`). A second launch is rejected while one is still active for the same task (`ActiveExecutionAlreadyLinkedError`) — see Concurrency for the one known limitation here.

## Approval integration

`project_approval_links` points at a real `agent_approval_requests` row (Module 7); `listApprovalLinks` always joins live and returns the Runtime's *current* status — never a duplicated decision. Duplicate links are rejected by a unique constraint.

## APIs

20 routes under `/api/organizations/{organizationId}/projects/...`, following this codebase's established `parseUuidParam`/`.strict()` Zod/`getAuthenticatedUser`/`jsonSuccess`/`handleRouteError` pattern exactly — no new conventions introduced. See the route list in "Files created" above; full request/response shapes are visible directly in each route file (no separate API-reference doc was written for this module, matching the fact that most other route batches in this codebase document themselves the same way rather than via a parallel reference doc).

## UI and accessibility

Real authenticated pages under `/app/[organizationSlug]/projects{, /new, /[projectId], /[projectId]/settings}`. Detail page uses a fresh, hand-built WAI-ARIA tablist (`ProjectTabs.tsx` — `role="tablist"`/`role="tab"`, `aria-selected`/`aria-controls`, arrow-key navigation, roving `tabIndex`) since this codebase has no component library; content per tab is server-rendered once and passed in as a prop, so switching tabs is a pure client-side visibility toggle, never a re-fetch. `ProjectStatusControl` only ever offers the transitions `getLegalProjectTransitions` actually returns. Status changes anywhere (project/phase/milestone/task) share one `InlineStatusForm` that auto-submits via `formRef.current?.requestSubmit()` and surfaces a failed submission as a `role="alert"`, never silently. Task launch of the Knowledge Analyst, dependency addition, and member assignment are grouped behind a `<details>` disclosure per task to keep the primary task list scannable. No fake metrics or placeholder data anywhere — a zero-task project shows "No tasks yet," never a fabricated "0%."

19 components, all typechecked/linted clean. 6 dedicated `.a11y.test.tsx` files (71 assertions total across the full a11y suite including pre-existing components) cover the two genuinely novel interactive patterns (`ProjectTabs`, `InlineStatusForm`) plus the highest-complexity/most-reused components (`ProjectMemberRow`, `ProjectStatusControl`, `AddProjectMemberForm`, `TaskItem`) — every one passes with zero axe violations.

## Audit events

21 new `AuditEventType` values: `project_created, project_updated, project_status_changed, project_archived, project_member_added, project_member_role_changed, project_member_removed, project_phase_created, project_phase_updated, project_milestone_created, project_milestone_updated, project_task_created, project_task_updated, project_task_status_changed, project_task_assigned, project_task_assignment_removed, project_task_dependency_added, project_task_dependency_removed, project_artifact_linked, project_agent_execution_launched, project_approval_linked, project_permission_denied`. Every one carries bounded metadata (field names, ids, before/after enum values) — never full task descriptions or artifact content; spot-checked directly by an integration test asserting a `project_created` audit row's metadata never contains the word "description."

`project_events` is a structurally separate, user-facing operational timeline (`recordProjectEvent`) — every audited mutation also writes one, but the two tables serve different purposes (security/compliance record vs. project activity feed) and are never merged.

## Authorization

Server-side only, exactly per spec — no UI control is ever hidden-but-still-reachable; every guard is re-checked by the service layer regardless of what the UI happened to render. Two-layer resolution: `resolveProjectAuthContext` (one query pass: org role + this project's own member role + workspace role) feeds a small set of synchronous/async guard functions:

| Guard | Floor |
|---|---|
| `requireProjectCreateAuthority` | org owner/admin, or workspace manager (workspace-scoped project) |
| `requireProjectViewAuthority` | org owner/admin, any project member, or any workspace member (workspace-scoped) |
| `requireProjectManageAuthority` | org owner/admin, workspace manager, or this project's own `project_owner` |
| `requireProjectContentAuthority` | above, or `project_manager` |
| `requireTaskCreateAuthority` | above, or `contributor` |
| `requireTaskUpdateAuthority` | content-authority floor, **or** a `contributor` who is the task's own assignee |
| `requireLaunchAgentExecutionAuthority` | `project_manager` and above |

Every denial is audited (`project_permission_denied`) before the error is thrown. Cross-tenant access always resolves to a 404 (`TenantResourceNotFoundError`), never a 403 — a project from another organization is indistinguishable from a project that doesn't exist.

## Concurrency

Every "duplicate X" requirement backed by a **real, atomic Postgres constraint** is fully race-proof, verified by a real concurrent test (`Promise.allSettled` against two/three simultaneous calls, then asserting the DB state directly):

- Duplicate project key → `projects_org_key_unique`
- Duplicate member addition → `project_members_project_user_unique`
- Duplicate task assignment → `project_task_assignments_task_user_unique`
- Duplicate dependency → `project_task_dependencies_edge_unique`
- Phase ordering conflicts → `project_phases_project_sequence_unique` (a race for the same computed sequence throws, never silently overwrites)
- Duplicate artifact link → `project_artifact_links_unique`
- Concurrent last-owner removal/demotion → the `FOR UPDATE`-locking-CTE pattern (one atomic statement)
- Concurrent task complete/cancel → the compound `WHERE id = ? AND revision = ? AND status = ?` atomic `UPDATE` (whichever commits first wins; the loser's `WHERE` simply matches nothing)

**One known, structural limitation**: `launchKnowledgeAnalystForTask`'s "no active execution already linked" guard is a check-then-multi-step-insert spanning several HTTP round trips (`createExecution` → `assignExecution` → `startExecution` → `advanceExecution` → `createPlan` → `createCheckpoint` → `enqueueJob` → insert the link), because the neon-http driver has no interactive multi-statement transaction (confirmed: `db.transaction()` is not used anywhere in this entire codebase, for exactly this reason). A true simultaneous double-launch on the same task can, in principle, create two independent, valid executions both linked to the same task — this is not silently claimed to be fully protected; the concurrency test for this path documents the real behavior (both may succeed) rather than asserting a guarantee the architecture can't provide over a stateless HTTP connection. A non-simultaneous second call is still reliably rejected. See "Bugs discovered / Remaining blockers" for the fix options considered and why none were applied this module.

## Tests

7 service-layer integration files (`src/lib/projects/*.integration.test.ts`, 61 tests) + 1 route-level integration file (`module-10-projects-routes.integration.test.ts`, 4 tests) + 6 a11y files (19 tests) — every scenario from the module spec's exact required list is covered: org-unique keys, cross-tenant 404, workspace authority, unauthorized-member rejection, last-owner protection, state-transition enforcement, completed/archived rejecting new work, stale updates, self/duplicate/cross-project/direct-cycle/indirect-cycle dependency rejection, unresolved-dependency completion blocking, duplicate assignment/execution-launch/artifact-link prevention, agent-assignment-transfers-no-permissions, live-Runtime-approval-status, content-never-copied artifact linking, deterministic progress (including the cancelled-task exclusion and zero-task null case), project-events-and-audit-logs-together, bounded audit metadata, and every concurrency scenario in the spec.

## Verification

- `npm run typecheck` — clean.
- `npm run lint` — clean (0 errors, 0 warnings after cleanup).
- `npm test` (unit) — 196/196 passing (25 files), no regressions.
- `npm run test:integration` — **827/827 passing (90 files)**, up from 762/82 at the end of Module 9 (+65 tests / +8 files, exactly this module's addition, zero regressions elsewhere).
- `npm run test:a11y` — **71/71 passing (18 files)**, up from 52/12, zero regressions.
- `npx drizzle-kit check` — "Everything's fine."
- `npm run build` — production build succeeds; all 20 new API routes and 4 new pages compile and appear in the route manifest.
- Direct Postgres verification: all 11 `project_*` tables confirmed **empty** after a full test-suite run (cascade-from-`organizations` cleanup leaves zero orphaned rows).
- Manual verification: no browser-automation tool is available in this environment, so this was done at the HTTP layer instead of a visual click-through — a real session cookie against the live dev server and live Postgres, exercising the actual route handlers and actual server-rendered pages: project list/new/detail/settings pages all render real content (verified by grepping the returned HTML for expected headings/labels, absence of any error-boundary text); a project, a phase, and a task were created and a status transition performed through the real API routes, then the detail page was re-fetched and confirmed to show the new phase/task/status. This verifies server-rendering and end-to-end wiring but not visual layout, hover states, or live-browser keyboard interaction — the a11y suite (jsdom + `@testing-library/react` + `jest-axe`) is what actually exercises keyboard navigation and ARIA semantics for the new components. All test data was cleaned up afterward; the dev server was stopped.

## Deferred (explicitly, per this phase's own scope)

Kids Coding Operations, Home Renovation Rebate Platform, CRM, Marketing OS, Sales OS, external integrations, boards/kanban view, time tracking, budgets/billing, advanced reporting, drag-and-drop task ordering, any agent beyond the Company Knowledge Analyst, autonomous/automatic agent task assignment, automatic task completion from execution results, a standalone project-management API reference doc (routes are self-documenting per this codebase's existing convention).

## Update (Agent Runtime Core, Module 7) — see that doc

A short cross-reference note was appended to `MODULE_7_AGENT_RUNTIME_CORE.md` pointing back here: Projects Core is the first caller to launch a Runtime execution from *outside* the Runtime/Tool-Runtime/worker system itself, and it does so through the existing `createKnowledgeAnalystTask` entry point unmodified — no change to Module 7's own execution lifecycle, authorization, or artifact model was needed or made.

## Update (LYNQ Workflow Engine Core, Module 11, now complete)

A workflow's `project_task` node either links to an existing task or creates a new one through this module's own, completely unmodified task-creation and status APIs — never a second task model, never a Runtime execution masquerading as a task. The same rule this module established holds without exception under workflow orchestration too: a workflow never auto-completes a project task, and human project status remains authoritative. Because `transitionTaskStatus` (this module) has no knowledge of workflows, a narrow, opportunistic `notifyProjectTaskChanged` hook was added at the *dashboard action* layer (`transitionTaskAction` in `src/lib/dashboard/actions/projects.ts`, via a deliberate dynamic import) so a human completing a task through this module's own UI can resume a linked workflow — a guaranteed no-op for any task with no linked workflow, with workflow reconciliation as the generic backstop for any other entry point. This module's own service functions, schema, and authorization are otherwise unchanged. See `MODULE_11_WORKFLOW_ENGINE_CORE.md`.

## Update (LYNQ CRM Core, Module 12, now complete)

CRM records (contacts/companies/opportunities) may link to a project via `crm_project_links`, a new typed-pointer table in the CRM module mirroring `project_artifact_links`'s own pattern — never a second project model, never CRM data duplicated onto a project record or vice versa. `createProjectLink` resolves the target project through this module's own, completely unmodified `resolveProjectById`. No automation exists in either direction: a won opportunity does not automatically create a project, and completing a project task does not automatically change any CRM record. This module's own service functions, schema, and authorization are entirely unchanged. See `MODULE_12_CRM_WORKFLOW_AND_PROJECT_INTEGRATION.md`.

## Update (LYNQ Marketing OS Core, Module 15, now complete)

Marketing OS links campaigns and content items to projects/project-tasks the same reference-only way CRM already does — `marketing_project_links` (a new typed-pointer table in the Marketing OS module, mirroring `crm_project_links`'s own pattern) for campaign↔project links, and a direct `projectTaskId` composite FK on `marketing_content_items` for content↔task links. Both resolve the target project/task through this module's own, completely unmodified functions. Campaign creation never automatically creates a project — that remains a Workflow's explicit decision, exactly as this module's own Deferred list already anticipated for CRM. This module's own service functions, schema, and authorization are entirely unchanged. See `MODULE_15_MARKETING_OS.md`.

## Update (LYNQ Analytics OS, Module 17, now complete)

Analytics OS reads this module's own canonical `projects`/`project_tasks` tables through 5 read-only metrics (`projects_active`, `projects_blocked`, `project_tasks_open`, `project_tasks_overdue`, `project_completion_rate`). This module has no org-wide "view all projects in aggregate" authority of its own — `requireProjectViewAuthority` is deliberately per-project — so Analytics OS uses plain organization membership as the aggregate-safe floor for these org-wide COUNTS, matching what this module's own project list page already shows any member; drilling into one specific blocked project's own real detail still goes through this module's own real, unmodified per-project authorization. This module's own service functions, schema, and authorization are entirely unchanged. See `MODULE_17_ANALYTICS_OS.md` and `MODULE_17_ANALYTICS_AUTHORIZATION_AND_PRIVACY.md`.

## Update (LYNQ Founder Workspace / Executive OS, Module 18, now complete)

The executive Projects/Delivery view and the attention engine's own `blocked_project`/`overdue_project_milestone` rules read this module's own canonical `projects`/`project_milestones` tables directly, workspace-scoped consistently with Analytics OS's own hardened policy (milestones carry no `workspaceId` of their own — scoped through their own project's real workspace via a join, the identical pattern Analytics OS's own workspace-isolation hardening established). This module's own service functions, schema, and authorization are entirely unchanged. See `MODULE_18_FOUNDER_WORKSPACE.md`.
