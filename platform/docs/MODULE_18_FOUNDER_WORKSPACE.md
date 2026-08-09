# Module 18 — LYNQ Founder Workspace / Executive OS

The executive command center for LYNQ — a single view answering "what's happening, what needs attention, where are we growing, where are we blocked, what needs my decision today" by aggregating canonical records already produced by Analytics OS, CRM, Sales OS, Marketing OS, Communications OS, Projects Core, Workflow Engine, Agent Runtime, and the existing Runtime approval system. Creates no competing business truth: every number traces to a real Analytics OS metric or a direct read of a source module's own canonical table; every approval decision goes through Agent Runtime's own real approval functions; every agent action goes through Module 14's generic task handler contract.

## Contradiction reconciliation (pre-implementation review)

No genuine architectural contradiction was found. Every executive view (`company-pulse.ts`, `sales-view.ts`, `marketing-view.ts`, `projects-view.ts`, `operations-view.ts`, `agents-view.ts`) is a thin, permission-gated wrapper composing already-existing real functions — Analytics OS's `computeExecutiveKpis`/`runAnalyticsQuery`, Sales OS's `computeForecast`/`listSalesTargets`/`computeTargetProgress`, Agent Runtime's `listPendingApprovalsForApprover`/`approveRequest`/`rejectRequest`/`requestRevision`, Agent Registry's `listAgents`. No module's own service functions, schema, or authorization were modified by this build.

One genuine gap discovered and disclosed during Analytics OS's own review (not a contradiction, a real registry inconsistency): Module 17's own agent metrics (`agent_executions_running`/`completed`/`failed`, `agent_avg_execution_duration`, `tool_invocations_failed`) declare `agent` as a `supportedDimensions` entry but never implement a per-agent `groupBy` branch in their own `compute()`. The AI Workforce view therefore computes its own per-agent execution/artifact breakdown directly against `agent_executions`/`agent_artifacts` rather than through the registry's own (unimplemented) dimension — documented in `agents-view.ts`'s own module comment, and flagged here as a fast-follow for Module 17 rather than worked around silently.

## Pre-Module-18 hardening: Analytics OS workspace isolation

Completed and verified first, per instructions — full detail in `MODULE_17_ANALYTICS_WORKSPACE_ISOLATION.md`. Summary: every one of Analytics OS's 36 metrics, all 3 funnels, and the query/drilldown/KPI/reports layers now apply `workspaceId` as an actual `WHERE` filter at the canonical source query (not merely at authorization), with an explicit, documented policy for the handful of record types (CRM leads/follow-ups) that carry no workspace column anywhere in their schema. 8 new tests, full Analytics OS suite (37 tests) re-run and passing.

**A second round of the identical class of bug was found and fixed during THIS module's own testing**: several of Module 18's own new direct queries (`sales-view.ts`'s "top opportunities," `marketing-view.ts`'s "upcoming launches"/"pending content approvals," `projects-view.ts`'s "recently completed milestones"/"linked workflow failures," `operations-view.ts`'s Runtime queue state, and every rule in `attention-engine.ts`) initially threaded `workspaceId` through their own function signatures but never actually applied it as a query filter — caught by a functional test (`workspace safety — Founder views respect Analytics OS's own workspace scoping`) that asserted a workspace-scoped Sales view excluded another workspace's opportunity and initially failed. Fixed by applying the identical `workspaceScopeCondition` helper Analytics OS's own hardening established, across every affected file. See "Bugs discovered" in the final report.

## Founder permission model

`founder-os/authz.ts` — 3 roles (`founder_viewer`, `founder_executive`, `founder_admin`), 10 capabilities (`founder_workspace_view`, `_view_financial`, `_view_sales`, `_view_marketing`, `_view_operations`, `_view_agents`, `_manage_goals`, `_manage_decisions`, `_manage_layout`, `_admin`), independent of every other module's roles, with organization owner/admin bootstrap — the identical shape Analytics OS's own authz already established. Full detail in `MODULE_18_FOUNDER_AUTHORIZATION_AND_PRIVACY.md`.

## Company Pulse

`company-pulse.ts`'s `computeCompanyPulse` — a thin wrapper over Analytics OS's own `computeExecutiveKpis` (7 groups: Growth/Sales/Marketing/Delivery/Operations/Communications/AI). Founder capability is checked FIRST; Analytics OS's own dual gate then runs SECOND, unchanged, inside `computeExecutiveKpis` itself. `founder_workspace_view_financial` (a capability with no direct Analytics-OS-side equivalent) is enforced here by dropping every `currency`-valued metric from the response for a caller who lacks it — a `founder_viewer` sees counts/rates but not dollar amounts unless also granted the financial capability.

## Executive attention engine

`attention-engine.ts` — NOT LLM reasoning. 15 fixed, deterministic rule functions across 7 domains, each reading one real canonical table against a fixed threshold: overdue critical follow-ups (CRM), high-value opportunities past close date + stale pipeline + targets behind schedule (Sales), campaigns starting soon still in draft + campaigns with overdue content (Marketing), blocked projects + overdue milestones (Delivery), failed workflows + dead-lettered Runtime jobs (Operations), high message failure rate + disabled integrations blocking queued sends (Communications), approvals nearing expiry + repeated agent execution failures (Agents). Every item names its real record, never an opaque score. Sorted deterministically (severity, then earliest due date), capped at 50 items. Each rule independently re-checks its own source module's aggregate-safe view authority — a caller missing one domain's authority simply loses that domain's rules.

## Approval center

`approval-center.ts` — NOT a second approval system. Every read (`listFounderApprovals`) and decision (`decideFounderApproval`) calls Agent Runtime's own real, unmodified `listPendingApprovalsForApprover`/`approveRequest`/`rejectRequest`/`requestRevision` (Module 7) directly. This file adds exactly one thing: cross-module context, by joining the existing `sales_approval_links`/`marketing_approval_links`/`communication_approval_links` tables to show which system requested each approval and what it's linked to.

## Executive Sales / Marketing / Projects / Operations / AI Workforce views

Each a thin composition of Analytics OS metrics plus, where a richer real function already exists, that function directly — Sales reuses `computeForecast`/`listSalesTargets`/`computeTargetProgress` (weighted pipeline always labeled `estimated`, no predictive win probability computed anywhere); Marketing shows no impressions/CTR/ROAS (no such metric exists in the registry); Projects/Operations expose real milestone/queue/lease state; AI Workforce lists `listAgents`' own real registry rows with real per-agent execution/artifact counts, no hidden reasoning, no credential values ever included.

## Executive activity feed

`activity-feed.ts` — a curated, bounded set of real canonical audit event types (never every audit event — this is an operational feed, not the compliance log). Two spec examples are deliberately not filterable and disclosed as such in the file's own comment: "high-priority" lead filtering (no such field exists at the audit-event layer) and "major target milestone" (no such event is ever fired anywhere in this codebase today).

## Daily brief and Founder Analyst

Full detail in `MODULE_18_EXECUTIVE_ATTENTION_AND_BRIEFING.md`. Summary: `daily-brief.ts`'s `computeDailyBrief` is fully deterministic (company snapshot, day-over-day change on 5 headline metrics, attention items, pending-approval count, suggested actions restated from the top attention items — never a new narrative). The Founder Analyst (`founder-analyst.ts`) is one narrow, `assistant`-permission-level agent with one task type (`founder_company_brief`, registered through Module 14's generic contract), whose entire task body IS `computeDailyBrief` formatted into a `report` artifact — no LLM call, no tool invocation, no write path to any operational table other than its own artifact.

## Decision log

`decisions.ts` — a real business decision record (title/decision/context/owner/date/related project-opportunity-campaign-workflow-artifact/status/review date), never hidden reasoning. Every `related*Id` is validated to belong to the same organization at write time. Superseding is single-use (revision-guarded plus an explicit `status <> 'superseded'` condition). Brain promotion (`promoteFounderDecisionToBrain`) is fully explicit — never automatic — and goes through Brain's own real `createKnowledgeItem` (Module 5/16), which creates a Draft-status item still subject to Brain's own separate approval/publish workflow.

## Executive goals

`goals.ts` — current value is always derived LIVE from Analytics OS via a `metricKey` validated against the metric registry at write time, never stored or duplicated on the goal row. `relatedSalesTargetId` lets a goal reference an existing Sales OS target instead of redefining the same objective.

## Dashboard configuration

`founder_workspace_configurations` — visible KPI groups, widget order, selected saved Analytics reports (referenced by id, never a copied query), default date range, default workspace. Org- or workspace-scoped, identical shape to Analytics OS's own `analytics_configurations`.

## Database design

The smallest schema of any module this session, deliberately: 4 tables (`founder_workspace_configurations`, `founder_role_assignments`, `founder_decisions`, `founder_goals`), 3 enums. Attention items and the daily brief are computed live, never stored — a durable history table was explicitly not built for either, per the spec's own "prefer live derivation... do not create tables for derived attention items or daily briefs unless a durable history is justified" instruction; the one durable brief record that exists is the real `report` artifact the Founder Analyst's own task produces via the existing `agent_artifacts` table. Migration `drizzle/0037_founder_workspace_module18.sql` (32 statements), applied and tracked; `drizzle-kit check` reports clean.

## APIs

13 route groups under `/api/organizations/{organizationId}/founder/...` — `overview`, `attention`, `approvals` (GET+POST), `sales`, `marketing`, `projects`, `operations`, `agents`, `activity`, `daily-brief` (GET compute-only + POST launches the real agent task), `decisions` (+`/{id}`, +`/{id}/supersede`), `goals` (+`/{id}`, +`/{id}/progress`), `config`. Identical thin-route shape to every other module's own APIs.

## UI

11 pages under `/app/[organizationSlug]/founder/...` — the home page (Company Pulse by group, top attention items, pending approvals, recent activity, links to every domain page), `attention`, `approvals`, `sales`, `marketing`, `projects`, `operations`, `agents`, `decisions`, `goals`, `settings`. Reuses Analytics OS's own `MetricCard` component directly (Founder metrics are the identical `AnalyticsMetricResult` shape) plus two new shared components (`AttentionList`, `ApprovalList`). No chart library, no fake data — every KPI card, table, and list renders a real value or an honest "—" for a genuine zero-denominator/no-data case.

## Audit events

13 new event types: `founder_workspace_configuration_updated`, `founder_decision_created`/`_updated`/`_superseded`, `founder_goal_created`/`_updated`/`_completed`, `founder_daily_brief_generated`, `founder_agent_task_started`, `founder_agent_artifact_created`, `founder_permission_granted`/`_revoked`/`_denied`, `founder_approval_decided`. No dashboard render is ever audited — only durable, user-authored actions and real agent-task/approval events. No sensitive payload (message bodies, PII, full agent inputs) in any metadata.

## Concurrency and tests

Full detail in the final report. 6 concurrency tests (goal/decision revision races, single-use decision superseding, configuration stale-update rejection, duplicate-daily-brief idempotency, immediate permission-revocation effect) and 21 functional tests, all passing — including the two real bugs this module's own testing found and fixed (see "Pre-Module-18 hardening" above and the final report's "Bugs discovered" section).

## Deferred (explicitly, per spec)

A fully arbitrary dashboard-layout builder (widget order/visible groups only — no free-form widget composition), PDF/scheduled daily-brief delivery, a second, richer AI-driven insight layer beyond the deterministic attention engine, per-agent `groupBy` in Analytics OS's own registry (flagged as a Module 17 fast-follow, not built here), Kids Coding, Home Renovation Rebates.
