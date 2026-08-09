# Module 13 — LYNQ Sales OS

The operational layer over CRM Core (Module 12) — lead assignment, qualification execution, opportunity playbooks, next-best-actions, follow-up sequencing, agent-assisted research, approval-gated actions, deterministic health/forecasting/targets/analytics. Built directly on the existing CRM Core, Workflow Engine, Agent Registry, Agent Runtime, Tool Runtime, Runtime workers/reconciliation, Brain, approvals, artifacts, audit system, and dashboard shell (including the premium UI/UX system from the dedicated refinement pass). No Marketing OS, Kids Coding, Home Renovation Rebates, or external communications integrations in this module.

## Contradiction reconciliation (pre-implementation review)

One genuine architectural contradiction was found and is resolved by scope adaptation, not by silently working around it:

**The Workflow Engine's `agent_execution` node type is hard-wired to Knowledge Analyst logic.** `src/lib/workflows/engine.ts`'s `executeAgentExecutionNode` always calls `createKnowledgeAnalystTask` regardless of the `agentId` configured on the node — it drives Knowledge-Analyst-shaped Brain-search logic unconditionally. Sales OS's two new agents (Lead Research Assistant, Opportunity Summary Assistant) read CRM data, not Brain, and would silently run the wrong logic if referenced from an `agent_execution` node. Resolution: the three Sales OS starter workflow templates use only the node types that ARE generic and agent/user-agnostic today — `human_task` (`executeHumanTaskNode` reads `config.assignedUserId` generically) and `approval` (`executeApprovalNode` reads `config.agentId` generically via `resolveAgentById` and a fresh shell execution). Sales agent tasks are launched through `agents.ts`'s own `createLeadResearchTask`/`createOpportunitySummaryTask`, a separate, already-correct path, never through a workflow node. See `src/lib/sales-os/templates.ts`'s header comment for the full detail.

A second, smaller limitation surfaced by the same investigation: `executeHumanTaskNode` does not read `inputMapping` at all — a `human_task` node's `assignedUserId` is fixed at template-seed time, not resolvable per-execution. The three templates default that assignee to whichever user seeds them; real per-lead/per-rep assignment is handled by Sales OS's own qualification/opportunity-playbook runs, and the workflow templates are a complementary org-wide reminder/approval mechanism, not the primary assignment path.

No other contradiction was found. CRM Core's lead/opportunity/pipeline/follow-up/activity/note schema and authority model, the Workflow Engine's version/execution model, and the Agent Runtime's execution lifecycle were all sufficient to build on without modification (beyond the one `seedTemplate` export and one `sales_sequence_step_runs.workflow_execution_id` column added mid-build, both purely additive).

## Files created and modified

**Schema**: `src/db/schema.ts` (appended) — 20 new enums, 19 new tables. Migrations: `drizzle/0027_rapid_thunderbolt_ross.sql`, `drizzle/0028_equal_jackal.sql` (one follow-up column).

**Services** (`src/lib/sales-os/`, 21 files): `validation.ts`, `errors.ts`, `authz.ts`, `configuration.ts`, `teams.ts`, `roles.ts`, `lead-assignment.ts`, `lead-queues.ts`, `playbooks.ts`, `qualification.ts`, `opportunity-playbooks.ts`, `health.ts`, `next-best-action.ts`, `work-queue.ts`, `forecasting.ts`, `targets.ts`, `analytics.ts`, `sequences.ts`, `agents.ts`, `templates.ts`, `approvals.ts`, plus `test-helpers.ts`.

**Modified existing modules**: `src/lib/audit.ts` (+29 `AuditEventType` values), `src/lib/dashboard/nav-items.ts` (+"Sales" link), `src/components/dashboard/icons.tsx` (+`IconSales`), `src/lib/workflows/templates.ts` (exported `seedTemplate` for reuse), `src/components/dashboard/ActionForm.tsx` (new shared client wrapper — see UI section).

**APIs**: 15 route files under `src/app/api/organizations/[organizationId]/sales/...` — `config`, `teams` (+`[teamId]/members`), `playbooks` (+versions/steps/publish), `lead-queues`, `leads/[leadId]/qualification` (+`[runId]/qualify`,`/disqualify`), `opportunities/[opportunityId]/playbook`, `opportunities/[opportunityId]/health`, `next-actions`, `my-work`, `sequences`, `targets`, `forecast`, `analytics`.

**Dashboard**: `src/lib/dashboard/actions/sales.ts` (34 server actions); 11 pages under `src/app/app/[organizationSlug]/sales/...`.

**Tests**: 3 integration files (24 tests) under `src/lib/sales-os/`; 1 new a11y file (3 tests) for the shared `ActionForm` component.

## Schema and migrations

19 new tables, every one tenant-scoped by a direct `organizationId` FK (`onDelete: cascade`). Tables that other Sales OS tables reference via a composite tenant-safe FK carry their own `unique(id, organizationId)` constraint, matching the established pattern from Modules 6–12. No `crm_*` table was touched, added to, or duplicated.

**Configuration/teams/roles**: `sales_configurations` (one row per org, or per org+workspace — two partial unique indexes), `sales_teams`, `sales_team_members` (operational grouping only), `sales_role_assignments` (the actual capability-granting model — one active role per user per org, partial unique `WHERE revoked_at IS NULL`).

**Playbooks**: `sales_playbooks` → `sales_playbook_versions` (draft/published/superseded, immutable once published) → `sales_playbook_steps` (9 structured step types, bounded `jsonb` configuration, never an executable script).

**Execution**: `sales_lead_qualification_runs` (partial unique `WHERE status IN ('not_started','in_progress','waiting')` — one active run per lead) + `sales_lead_qualification_items`; `sales_opportunity_playbook_runs` (partial unique `WHERE status = 'active'`) + `sales_opportunity_playbook_items`.

**Sequencing**: `sales_follow_up_sequences` → `sales_follow_up_sequence_versions` → `sales_follow_up_sequence_steps` (day-offset, bounded action type); `sales_sequence_enrollments` (partial unique `(target_type, target_id) WHERE status = 'active'`); `sales_sequence_step_runs` — the idempotency guard, unique `(enrollment_id, sequence_step_id)`, so re-running the advancement sweep after a restart never re-executes a step.

**Approvals/targets/forecast**: `sales_approval_links` (typed pointer to an existing `agent_approval_requests` row, unique per approval — never a duplicate approval record); `sales_targets` (individual/team scope, two partial unique indexes, a `CHECK` enforcing exactly one of `user_id`/`team_id`); `sales_opportunity_forecasts` (one bounded, rep-settable category per opportunity, unique on `opportunity_id`).

**Deliberately not tables** (derived at read time instead, per the spec's own "avoid tables for derived data" instruction): lead queues, next-best-actions, the sales work queue, opportunity health, forecasting totals, analytics — all pure or near-pure query functions in their respective service files.

Migrations were generated via `drizzle-kit generate` and applied directly through `drizzle-orm`'s own `neon-http` migrator primitives (the `drizzle-kit migrate` CLI could not establish a websocket session in this environment; the underlying migration application — statement execution + `drizzle.__drizzle_migrations` bookkeeping with the identical `sha256`-of-file-content hash algorithm — is otherwise unchanged). `npx drizzle-kit check` reports "Everything's fine" after both migrations.

## Sales configuration

`getSalesConfiguration`/`upsertSalesConfiguration`/`resolveEffectiveSalesConfiguration` (`configuration.ts`). Fields match the spec exactly: `defaultPipelineId`, `businessTimezone`, `currency`, `defaultLeadAssignmentStrategy`, `defaultQualificationPlaybookId`, `defaultOpportunityPlaybookId`, `staleLeadThresholdDays`/`staleOpportunityThresholdDays`, `forecastingMode`. No fields for hypothetical unbuilt features. A missing config row resolves to safe in-memory defaults rather than throwing, so every other Sales OS feature works before an admin ever visits Settings.

## Teams and Sales OS permissions

Team membership (`teams.ts`) is explicitly operational grouping — a `teamRole` of manager/rep/viewer describing a person's function within one team, never itself a source of authority. A member must already be a real org member (`requireOrganizationMembership`); Sales OS never creates a user identity.

Actual capability comes from `sales_role_assignments` (`roles.ts`): one active role — `sales_admin`, `sales_manager`, `sales_rep`, `viewer` — per user per organization, independent of any CRM/Brain/Workflow/Projects role. Capabilities (`sales_view`, `sales_work_leads`, `sales_manage_own_opportunities`, `sales_manage_team_opportunities`, `sales_assign_leads`, `sales_manage_playbooks`, `sales_manage_forecasts`, `sales_manage_targets`, `sales_admin`) are derived from the role via a static map in `authz.ts` — code never checks `role === "sales_admin"` directly outside that one map. Organization owner/admin implicitly hold every capability (bootstrap authority), without needing an explicit grant row. Full detail in `MODULE_13_SALES_AUTHORIZATION.md`.

## Lead assignment

`lead-assignment.ts`. `assignLead` is the one function that ever changes `crm_leads.owner_user_id`, and it does so exclusively by calling CRM Core's own revision-guarded `updateLead` — never a direct write. Three strategies:

- **manual** — an explicit `assigneeUserId`, validated against `listAssignmentEligibleUserIds` (every user with an active, non-revoked `sales_rep`/`sales_manager`/`sales_admin` role — a revoked role makes a user immediately ineligible, verified directly by a concurrency test).
- **round_robin** — picks the eligible user whose most recent `sales_lead_assigned`/`sales_lead_reassigned` audit event is oldest (or who has never been assigned), a deterministic query over `audit_logs`, no new column.
- **least_open_leads** — picks the eligible user with the fewest currently-open (`new`/`contacted`/`engaged`/`qualified`) leads.

Concurrency: two callers assigning the same lead simultaneously both read the same `expectedRevision`; CRM's own `WHERE revision = expectedRevision` guard lets exactly one succeed, the other receives `StaleCrmUpdateError` — verified directly with `Promise.allSettled` on two parallel `assignLead` calls.

## Lead queues

`lead-queues.ts`. Eight queues (`unassigned`, `new`, `contacted`, `engaged`, `qualification_due`, `stale`, `qualified`, `disqualified`), every one a deterministic `WHERE` clause over `crm_leads` plus (for `qualification_due`) a `NOT EXISTS` against `sales_lead_qualification_runs` and (for `stale`) the org's own `staleLeadThresholdDays`. Filterable by rep, team, status, source, company, and age. No `crm_leads` row is ever duplicated into a Sales OS table.

## Playbooks

`playbooks.ts`. `sales_playbooks` (stable identity, `lead_qualification`/`opportunity`/`follow_up` type) → versions (draft → published → superseded, mirroring the Workflow Engine's own version lifecycle) → steps (`checklist`, `collect_information`, `crm_activity_required`, `follow_up_required`, `workflow`, `approval`, `artifact_required`, `stage_recommendation`, `manual_decision` — bounded structured `jsonb` configuration, never a script or LLM-generated runtime process). Publishing requires at least one step and is a one-way door — `addPlaybookStep` on an already-published version throws `PlaybookVersionImmutableError`, verified directly.

## Lead qualification execution

`qualification.ts`. `startQualificationRun` opens a run against a real CRM lead and seeds one checklist item per playbook step; only one non-terminal run per lead is allowed (`sales_lead_qualification_runs_active_unique`, surfaced as `DuplicateActiveRunError`). `completeQualificationItem` marks items complete/skipped and recomputes `missing_information`. `qualifyLeadViaRun`/`disqualifyLeadViaRun` call CRM Core's own `qualifyLead`/`disqualifyLead` — **the CRM lead's `status` remains the sole qualification truth**; this run only documents the trail alongside it, verified directly by asserting the canonical lead row matches the run's recorded outcome.

## Opportunity playbook execution

`opportunity-playbooks.ts`. Same run/item shape as qualification, but the opportunity's CRM `stageId`/`status` remain solely authoritative — a `stage_recommendation` step only ever *recommends* a review; no code path in this module calls `moveOpportunityStage`. Completing an item advances `currentStepId` to the next incomplete step.

## Next-best-action engine

`next-best-action.ts` — deterministic, never LLM reasoning. Every recommendation (`contact_lead`, `complete_qualification_field`, `schedule_follow_up`, `review_proposal`, `move_opportunity`, `resolve_pending_approval`, `review_stale_opportunity`) is produced by a plain boolean/threshold check against real CRM/Sales OS data, carries a closed reason code, a template-generated explanation, a numeric priority, `dueAt` where applicable, and the exact `sourceSignals` that produced it. Signals: lead status, missing scheduled contact, overdue follow-up, missing qualification fields, opportunity health (reusing `health.ts`'s own signals — never a second scoring pass), pending approvals linked from Sales OS, and stale thresholds from configuration.

## Sales work queue ("My Sales Work")

`work-queue.ts` — pure aggregation over already-canonical records: assigned open leads, open CRM follow-ups, active qualification sessions, active opportunity playbook runs, pending approvals (filtered from the existing `listPendingApprovalsForApprover` down to ones linked via `sales_approval_links`), workflow human tasks (filtered from `listMyWorkflowHumanTasks` down to executions of the three Sales OS templates), and next-best-actions. Nothing here creates a new operational task record.

## Follow-up sequencing

`sequences.ts`. A sequence has published versions with day-offset steps (`crm_follow_up`, `workflow_human_task`, `approval_request`, `internal_reminder`). `enrollInSequence` allows exactly one active enrollment per target (`sales_sequence_enrollments_active_unique`). `advanceDueSequences` is the durable sweep: for each due enrollment it first re-checks the target's **live** CRM state (`isEnrollmentTargetStillEligible` — a lead already qualified/disqualified/converted, or an opportunity no longer `open`, is stopped immediately, regardless of which code path changed that state) before executing the next unrun step; `sales_sequence_step_runs`'s unique `(enrollment_id, sequence_step_id)` makes re-running the sweep after a restart a safe no-op, verified directly by calling it twice and asserting exactly one step row exists. `crm_follow_up` steps call CRM's own `createFollowUp`; `internal_reminder` steps create no external record at all (self-contained, surfaced via the step-run row itself) — no fake CRM activity is ever created for a reminder.

## Agent-assisted sales

`agents.ts`. Two narrow agents, registered through the real Agent Registry lifecycle exactly like Company Knowledge Analyst — `idea → ... → deployment`, permission raised back to `assistant` as its own explicit step:

- **Lead Research Assistant** — reads a lead's linked contact/company/activities/notes via the existing narrow `crm_agent_permission_grants` mechanism (`crm_contact_read`, `crm_company_read`, `crm_lead_read`, `crm_activity_read`, `crm_note_read`), produces a `report` artifact identifying missing qualification data.
- **Opportunity Summary Assistant** — same shape for opportunities, reusing `health.ts`'s deterministic reasons as evidence in its summary.

Both are driven synchronously through the real `createExecution → assignExecution → startExecution → advanceExecution(planning/reasoning/executing/verifying) → completeExecution` lifecycle in one call, rather than through the Runtime job queue — `src/lib/runtime/worker.ts`'s `execution_run` handler is hard-wired to `continueKnowledgeAnalystExecution` regardless of which agent owns the job, so enqueueing a real job for these agents would be picked up by the wrong driver. Neither agent can qualify/disqualify a lead, move a stage, assign ownership, or write to any `crm_*` table — verified directly that revoking an agent's CRM grant stops its very next read.

## Sales approvals

`approvals.ts` (reads) + `agents.ts`'s `requestOpportunityContinuationApproval`/`requestLeadReviewApproval` (the one approval-creation path). Every approval-gated action calls the existing Runtime `requestApproval` against a real, freshly-driven-to-`executing` agent execution — the identical primitive the Workflow Engine's own `approval` node uses — then records a typed `sales_approval_links` pointer. No duplicate approval schema, no duplicate decision logic; `approveRequest`/`rejectRequest` remain the only way to decide one.

## Opportunity health

`health.ts` — deterministic, closed reason-code set (`stage_stalled`, `no_recent_activity`, `overdue_follow_up`, `no_scheduled_follow_up`, `expected_close_date_passed`, `unresolved_playbook_requirements`, `pending_approval`, `missing_contact_or_company`), classified `healthy` (0 reasons) / `attention` (1–2) / `at_risk` (3+). Never a numeric score, never a win-probability claim. `stage_stalled` uses the most recent `crm_opportunity_stage_changed` audit event for accurate stage-age, falling back to `createdAt`.

## Forecasting

`forecasting.ts`. `computeForecast` returns `openPipelineValue` (real sum), `weightedPipelineValueEstimate` (sum of `amount × stage.probability/100`, always ≤ the open total, verified directly, and named/typed as an estimate everywhere it surfaces in the UI), `wonValue`/`lostValue` for a period, and per-forecast-category totals. `setOpportunityForecastCategory` is the one bounded, rep-settable field (`pipeline`/`best_case`/`commit`/`closed`) Sales OS adds beyond CRM's own opportunity data — never an automatic AI classification.

## Targets

`targets.ts`. Individual or team scope, one of four metric types (`won_revenue`, `opportunities_won`, `leads_qualified`, `activities_completed`), a period, and a target value — revision-guarded updates, historically traceable (never overwritten in place beyond the guarded value). `computeTargetProgress` recomputes the actual metric from real CRM data on every call — never a cached number — verified directly. No compensation/commissions logic exists.

## Sales analytics

`analytics.ts` — deterministic operational summaries only (leads by status, qualification conversion rate, average lead response age, opportunities by stage, pipeline/won/lost value, average open-stage age, stale opportunity count, follow-ups due/overdue). Not the future org-wide Analytics OS.

## Workflow integration

Three starter templates (`templates.ts`, seeded via the same `seedTemplate` helper Module 11's own starter templates use, now exported for reuse): **Lead Qualification Workflow**, **Opportunity Review Workflow** (an `approval` node against the Opportunity Summary Assistant), **Follow-Up Sequence Workflow** (the `workflow_human_task` sequence-step action type's real target, started via CRM's own `startWorkflowWithCrmContext`). See the contradiction note above for why none use `agent_execution` nodes.

## Projects integration

Sales OS displays existing `crm_project_links` on the opportunity workspace — read-only, via `listProjectLinksForCrmEntity`, unmodified. No automatic project creation on opportunity win exists in this module (explicitly deferred to a future Workflow template, per spec).

## Authorization and privacy

Full detail in `MODULE_13_SALES_AUTHORIZATION.md`. Summary: Sales OS authorization is fully independent from CRM's; any action that also touches a `crm_*` table passes both gates automatically, because the Sales OS service function calling into a real CRM Core function inherits that function's own `requireCrmManageAuthority` check — never bypassed, never duplicated. No CRM PII (name/email/phone/note content) is ever written to a Sales OS table, an audit event's metadata, or agent execution/artifact records beyond what CRM's own existing `agent-reads.ts` grants already permit.

## APIs

Thin authenticated routes under `/api/organizations/{organizationId}/sales/...`, identical shape to CRM's own routes (`getAuthenticatedUser`, `parseJsonBody`/`parseUuidParam`, `jsonSuccess`/`handleRouteError`). No CRM write logic is duplicated in any Sales OS route — every canonical CRM mutation still goes through CRM's own routes/services.

## UI

11 pages under `/app/[organizationSlug]/sales/...` — dashboard, leads (queue-filtered list), lead detail (qualification workspace), opportunities (health-annotated list), opportunity detail (playbook/forecast/approval workspace), My Sales Work, forecast, playbooks (+ detail), teams, targets, settings. Every page reuses the exact shared premium UI primitives from the dedicated refinement pass — `Card`, `Badge`, `PageHeader`, `Table`, `EmptyState`, `ProgressBar`, `FormField`/`SelectField`/`SubmitButton`, glass surfaces, shared typography/spacing/radius/status tokens — no parallel UI system. One new shared component, `src/components/dashboard/ActionForm.tsx`, factors out the `useActionState` wrapper every simple (non-redirecting, non-dialog) Server-Action form in Sales OS needs, mirroring the same pattern CRM's own `SetDefaultPipelineForm`/`InlineStatusForm` already hand-roll individually. No drag-and-drop anywhere. Full accessibility detail (labels, live regions, focus) inherited from the shared primitives' own existing a11y coverage; the one new component (`ActionForm`) has its own 3-test a11y suite.

## Audit events

29 new event types added to `src/lib/audit.ts`'s `AuditEventType` union (never a new table): `sales_configuration_updated`, `sales_team_created`, `sales_team_member_added`/`_removed`, `sales_role_granted`/`_revoked`, `sales_lead_assigned`/`_reassigned`, `sales_playbook_created`, `sales_playbook_version_published`, `sales_qualification_started`/`_completed`, `sales_opportunity_playbook_started`/`_completed`, `sales_next_action_generated`, `sales_sequence_created`/`_published`/`_enrolled`/`_stopped`/`_step_advanced`, `sales_follow_up_created`, `sales_approval_linked`, `sales_target_created`/`_updated`, `sales_forecast_category_set`, `sales_agent_task_enqueued`/`_artifact_created`, `sales_permission_denied`. Metadata is always ids/enums/field-name lists — verified directly that a contact's real email never appears in any Sales OS audit event after a full assign→qualify flow.

## Concurrency results

24 integration tests in `src/lib/sales-os/{authz,concurrency,deterministic-outputs}.integration.test.ts`, all passing against the real database:

- Concurrent lead assignment: exactly one of two racing `assignLead` calls succeeds, the other gets `StaleCrmUpdateError`.
- Round-robin assignment is deterministic and actually rotates across two sequential leads.
- Duplicate active qualification run rejected (`DuplicateActiveRunError`).
- Published playbook version immutable (`PlaybookVersionImmutableError`); re-publish is revision-guarded.
- Duplicate active sequence enrollment rejected (`DuplicateActiveEnrollmentError`).
- Sequence advancement is idempotent under a simulated worker restart (calling the sweep twice creates exactly one `sales_sequence_step_runs` row and one CRM follow-up).
- A qualified lead's sequence enrollment is stopped by the next sweep.
- A closed (won) opportunity's sequence enrollment is stopped by the next sweep, with zero steps executed.
- Target value updates are revision-guarded.
- Revoking an agent's CRM grant stops its very next read.
- A Sales OS admin who is only an ordinary org member still cannot assign a lead (CRM's own manage authority independently enforced).
- An ordinary member cannot self-grant a Sales OS role.
- A revoked Sales OS role immediately makes a user an ineligible assignee.
- Cross-tenant lead access is indistinguishable from not existing.
- Sales configuration is scoped independently per organization.

## Manual end-to-end result

See the final report for the full create-lead → assign → qualify → convert → start-opportunity-playbook → create-follow-up → generate-next-best-action → move-CRM-stage → view-forecast/dashboard walkthrough, executed against the real database via a scratch script (mirroring the integration tests' own setup) since this environment has no browser automation available.

## Deferred (explicitly, per spec)

External communication send (email/SMS/WhatsApp), proposal/document generation and sending, e-signature, third-party enrichment, predictive/ML win-probability scoring, compensation/commissions calculation, Marketing OS, Kids Coding, Home Renovation Rebates, and any workflow `agent_execution` node genuinely dispatching to a Sales OS agent (blocked on the Workflow Engine's own `executeAgentExecutionNode` becoming agent-generic — a Module 11 concern, not addressed here).

## Update (Generic Agent Execution + CRM Lead Qualification Authorization Hardening, Module 14, now complete)

Both limitations this doc flagged above are resolved:

- A workflow `agent_execution` node can now genuinely dispatch to a Sales OS agent (Lead Research Assistant via `sales_lead_research`, Opportunity Summary Assistant via `sales_opportunity_summary`) — the Workflow Engine's own node type became agent-generic. `sales-os/agents.ts`'s `createLeadResearchTask`/`createOpportunitySummaryTask` are unchanged and remain the canonical implementation; they are now ALSO reachable through the generic agent task handler registry, not replaced by it. Sales OS's own starter templates were left exactly as built (still `human_task`/`approval` only) — updating them was not part of Module 14's scope.
- A Sales rep may now qualify/disqualify a lead assigned to them, and a Sales manager may do so for a lead assigned to a rep on their own real Sales team — without being an organization owner/admin. `qualifyLeadViaRun`/`disqualifyLeadViaRun` route through a new narrow, dual-gated authority path (Sales OS team-scope check, then CRM Core's own narrow re-check) instead of requiring full CRM manage authority. Qualifying now also requires every mandatory playbook checklist item to be complete first; disqualifying does not.

See `MODULE_14_GENERIC_AGENT_EXECUTION.md`, `MODULE_14_AGENT_TASK_HANDLER_CONTRACT.md`, and `MODULE_14_CRM_SALES_QUALIFICATION_AUTHORIZATION.md` for full detail.

## Update (LYNQ Marketing OS Core, Module 15, now complete)

Marketing OS is a sibling operational layer, not a replacement or extension of this one — it does not touch `sales_*` tables, roles, or capabilities, and this module's own service functions, schema, and authorization are entirely unchanged. The one integration point: a marketing-originated CRM lead (created via Marketing OS's own `createLeadFromCampaign`, which calls this codebase's shared `createLead` from CRM Core) is a completely ordinary `crm_leads` row from Sales OS's point of view — it appears in lead queues, can be assigned, qualified, and worked exactly like any other lead, with its campaign/source/UTM provenance readable through a separate Marketing OS attribution record rather than through any new Sales OS column or table. No automatic assignment to a rep happens on handoff; that remains Sales OS's own `assignLead`, called explicitly or via an explicit workflow, exactly as before. Marketing OS's three starter workflow templates use Module 14's generic `agent_execution` node directly (unlike this module's own three templates, which still use only `human_task`/`approval` — see the Module 14 update above; retrofitting these specific templates remains out of scope here). See `MODULE_15_MARKETING_OS.md`.

## Update (LYNQ Communications & Integrations Core, Module 16, now complete)

This module's own `sales_sequence_step_action_type` enum gained one additive value, `communication_draft` (plus one new nullable column, `sales_sequence_step_runs.communicationMessageId`) — a follow-up sequence step may now create a real outbound Communications OS draft message via `communications-os/sales-integration.ts`'s `createSequenceCommunicationDraft`, resolving the enrollment's lead/opportunity to its linked CRM contact and drawing the step's own `title`/`instructions` as the draft's subject/body. This step type NEVER sends — it only drafts; a human or a separately-configured workflow must still approve and queue the send through Communications OS's own lifecycle, exactly like every other communication in that module. `sales_sequence_step_runs.status`/`crmFollowUpId`/`workflowExecutionId`/`approvalRequestId` semantics are completely unchanged; this is purely one more step-action branch alongside the existing four. **The pre-existing `sales_approval_links.approvalRequestId` FK-cascade bug this module's own final report flagged (found by Module 15, left unfixed there per its own "do not redesign Sales OS" scope) is now fixed** — `onDelete: "cascade"` added, with a new regression test (`sales-os/concurrency.integration.test.ts`) proving it. This module's own service functions, schema (beyond the one additive enum value/column), and authorization are otherwise entirely unchanged. See `MODULE_16_COMMUNICATIONS_CORE.md`.

## Update (LYNQ Analytics OS, Module 17, now complete)

Analytics OS reads this module's own canonical CRM opportunity/lead data (never a Sales OS table of its own — Sales OS itself has no separate opportunity/lead storage) through 4 read-only metrics (`sales_pipeline_weighted_value`, `sales_opportunities_at_risk`, `sales_qualification_conversion_rate`, `sales_leads_unassigned`) plus the Sales assigned→qualification→qualified→opportunity→won funnel. Every metric independently re-checks this module's own unmodified `requireSalesViewAuthority` before running. `sales_pipeline_weighted_value` is always returned with `classification: "estimated"` — its own description states explicitly it must never be presented as actual revenue, satisfying this module's own "weighted pipeline value... always labeled an estimate" principle one layer up. `sales_opportunities_at_risk` is explicitly documented as a narrower, single-reason proxy distinct from this module's own richer multi-reason opportunity health classification — Analytics OS does not attempt to reproduce that full logic. This module's own service functions, schema, and authorization are entirely unchanged. See `MODULE_17_ANALYTICS_OS.md` and `MODULE_17_ANALYTICS_METRICS_AND_DIMENSIONS.md`.

## Update (LYNQ Founder Workspace / Executive OS, Module 18, now complete)

The executive Sales view (`founder-os/sales-view.ts`) calls this module's own real `computeForecast`/`listSalesTargets`/`computeTargetProgress` directly — no duplicated pipeline math, no new forecast logic. `weightedPipelineValueEstimate` is surfaced exactly as this module already labels it (an estimate), and no predictive win probability is computed anywhere in Founder Workspace. The executive attention engine's own `target_far_behind_schedule` rule uses a narrower, single-query proxy (won value in-period vs. target, compared against elapsed-period time) rather than this module's own full `computeTargetProgress` team-resolution machinery, explicitly documented as a proxy — the Sales view itself still uses the full real function for the authoritative number. This module's own service functions, schema, and authorization are entirely unchanged. See `MODULE_18_FOUNDER_WORKSPACE.md`.
