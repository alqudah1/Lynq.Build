# Module 17 — LYNQ Analytics OS

The centralized, deterministic analytics layer aggregating canonical records already produced by CRM Core, Sales OS, Marketing OS, Communications OS, Projects Core, Workflow Engine, and Agent Runtime — never a competing operational truth, never an LLM-generated or fabricated number. Metrics are code-defined (an in-code registry), not data-defined; every query goes through one bounded engine that resolves date ranges/comparison periods in the org's own business timezone, dispatches to each metric's own `compute()`, and enforces a two-layer authorization gate before ever touching a source table.

## Contradiction reconciliation (pre-implementation review)

No genuine architectural contradiction was found. CRM/Sales/Marketing/Communications OS each already expose their own real "aggregate-safe view authority" function (`requireCrmViewAuthority`, `requireSalesViewAuthority`, `requireMarketingViewAuthority`, `requireCommunicationsViewAuthority`) that Analytics OS's own metric `compute()` functions call directly — the literal spec-mandated dual gate composed cleanly with no changes to any of those modules.

One genuine architectural difference surfaced and resolved as a documented design choice, not a contradiction: **Projects Core and Workflow Engine have no org-wide "view all in aggregate" authority of their own** — `requireProjectViewAuthority`/`requireWorkflowExecutionViewAuthority` (and Agent Runtime's own `requireExecutionVisibility`/`requireExecutionManageAuthority`) are deliberately per-record, taking a specific `projectId`/`definitionId`/`executionId`. Plain `requireOrganizationMembership` is used as the aggregate-safe floor for the Projects/Workflows/Agents domains instead — documented in each metric file's own code comment and in `MODULE_17_ANALYTICS_AUTHORIZATION_AND_PRIVACY.md`. This does not weaken anything: a caller drilling into one specific project/execution's own real detail still goes through that record's own real, narrower authorization — only the org-wide COUNT is gated at plain membership, matching what those modules' own dashboards already show any member.

No existing entity was duplicated: `analytics_configurations`, `analytics_role_assignments`, and `analytics_saved_reports` are genuinely new concepts with no prior home; every metric reads existing canonical tables by reference only, writes nothing back to any source module.

## Test-timeout hardening (pre-work, before this module's own build)

Per the second-window instructions, narrow (not global) test-timeout relief for the known Runtime-execution-heavy suites identified during Module 16's own investigation: `vi.setConfig({ testTimeout: 45000 })` at module scope in `src/lib/workflows/module14-agent-execution.integration.test.ts` (every test in that file drives a real `agent_execution` workflow node end-to-end), and a per-test third-argument `45000` override on exactly 3 individual tests across `src/lib/marketing-os/functional.integration.test.ts` (2 tests) and `src/app/api/internal/runtime/module-9-runtime-routes.integration.test.ts` (1 test). The shared `vitest.integration.config.mts`'s global `testTimeout: 20000` was not touched. No production behavior changed.

## Files created and modified

**Schema**: `src/db/schema.ts` (appended) — 5 new enums (`analyticsTimeGrainEnum`, `analyticsRoleEnum`, `analyticsReportVisibilityEnum`, `analyticsVisualizationEnum`, `analyticsDateRangeStrategyEnum`), 3 new tables. Migration: `drizzle/0036_analytics_os_module17.sql` (21 statements).

**Services** (`src/lib/analytics-os/`, 17 files + `metrics/` subfolder): `validation.ts`, `errors.ts`, `authz.ts`, `roles.ts`, `configuration.ts`, `dimensions.ts`, `query-support.ts`, `time.ts`, `query.ts`, `funnels.ts`, `kpis.ts`, `drilldown.ts`, `reports.ts`, `export.ts`, `format.ts`, `page-data.ts`, `test-helpers.ts`; `metrics/types.ts`, `metrics/crm.ts`, `metrics/sales.ts`, `metrics/marketing.ts`, `metrics/communications.ts`, `metrics/projects.ts`, `metrics/workflows.ts`, `metrics/agents.ts`, `metrics/registry.ts`.

**Modified existing modules**: `src/lib/audit.ts` (+10 `AuditEventType` values), `src/lib/dashboard/nav-items.ts` (+"Analytics" link). No CRM/Sales/Marketing/Communications/Projects/Workflow/Agent Runtime service function's existing behavior was changed — every metric is a pure additional reader.

**APIs**: 9 route files under `src/app/api/organizations/[organizationId]/analytics/...` (`query`, `metrics`, `dimensions`, `kpis`, `funnels`, `drilldown`, `export`, `reports`, `reports/[reportId]`).

**Dashboard**: `src/lib/dashboard/actions/analytics.ts` (8 server actions); 11 pages under `src/app/app/[organizationSlug]/analytics/...` (overview, 7 domain pages, reports list, report detail, settings) + 3 shared components (`MetricCard`, `MetricTable`, `FunnelTable`).

**Tests**: 2 integration files under `src/lib/analytics-os/` — `functional.integration.test.ts` (22 tests), `concurrency.integration.test.ts` (7 tests).

## Schema and migrations

The smallest schema of any module this session (3 tables vs. 16–19 for Modules 15/16) — deliberate, not an oversight: metrics and dimensions are an in-code registry (`metrics/registry.ts`, `dimensions.ts`), never database rows, and every metric computes **live** against the source module's own tables — no snapshot/cache table exists in v1, per the spec's own "prefer live queries initially... create snapshot tables only where necessary" allowance. `analytics_configurations` (business timezone + default query behavior, org- or workspace-scoped, partial unique per scope), `analytics_role_assignments` (one active role per user per org, independent of every other module's roles), `analytics_saved_reports` (a stored, revalidated set of query engine inputs — `metricKeys` is a plain string array referencing the registry, `filters` is a bounded jsonb array structurally incapable of holding executable SQL). `npx drizzle-kit check` reports clean.

## Metric registry

`metrics/types.ts` defines `MetricDefinition` (stable `metricKey`, name/description, `domain`, `valueType`, `aggregationType`, `unit`, `classification` — `actual`/`derived`/`estimated`/`manual` — `supportsTimeSeries`, `supportedTimeGrains`, `supportedDimensions`, `version`, `nullSemantics`) and `MetricHandler` (`definition`, `compute`, optional `computeSeries`/`drilldown`). 36 metrics across 7 domain files, each following the identical shape: an aggregate-access helper re-checking the source module's own authority, then one `MetricHandler` const per metric. `metrics/registry.ts` aggregates all 7 domain arrays into one `Map`, throwing `UnknownMetricError`/`UnsupportedDimensionError`/`UnsupportedTimeGrainError` for anything not registered — the only place any caller is allowed to resolve a metric key from. Full list in `MODULE_17_ANALYTICS_METRICS_AND_DIMENSIONS.md`.

## Dimension registry

`dimensions.ts` — 15 fixed dimension keys (time/workspace/owner/pipeline/pipeline_stage/campaign/campaign_status/source/channel/provider/project/workflow/agent/task_type/status), a closed vocabulary. A metric's own `compute()` is what actually maps a dimension key to a real, bounded column expression (`groupBy` clause) — the registry itself never accepts or builds a dynamic query. No arbitrary database column is ever reachable from a query parameter.

## Query engine

`query.ts`'s `runAnalyticsQuery` — the one bounded entry point. Order of checks, deliberately: (1) central `analytics_view` capability (the floor for touching Analytics at all); (2) per-metric central `analytics_view_<domain>` capability; (3) each metric's own `compute()` independently re-checks its SOURCE module's own aggregate-safe view authority — step 3 is never skipped or assumed satisfied by steps 1–2. Bounds: at most 20 metric keys per query (`MAX_METRIC_KEYS_PER_QUERY`), at most 100 grouped rows per metric (`MAX_GROUP_BY_CARDINALITY`, `QueryTooComplexError` beyond it), at most a 400-day date range (`MAX_DATE_RANGE_DAYS`). No raw SQL, no arbitrary expression is ever accepted from a caller — dates, grains, dimensions, and sort are all closed enums or bounded types.

## Time grains, comparison periods, and freshness

`time.ts` — every date-range boundary (`last_7/30/90_days`, `month/quarter/year_to_date`, `custom`) is resolved in the org's own `businessTimezone` (native `Intl.DateTimeFormat`, no new dependency — the same "no library for one localized concern" judgment already made for Sales/Marketing OS's own unused `businessTimezone` field, now actually load-bearing here). Comparison periods (`previous_period`/`previous_month`/`previous_quarter`/`previous_year`/`custom`/`none`) return current/previous/absolute-diff/percent-change; `computePercentChange` returns `null` (never 0% or `Infinity`) when the previous value is 0 or either value is `null` — a zero-denominator is represented explicitly, never hidden inside a misleading number. Grouped (multi-point) results deliberately skip the diff/percent computation — comparing two periods' dimension memberships pairwise would itself be misleading — the raw previous-period result is still returned. Every metric declares its own `MetricFreshness` (`live` for every metric in this release — no snapshot/scheduled-refresh path exists yet) and `MetricClassification`, both returned on every query result.

## Cross-module metrics and funnels

`marketing_campaign_sourced_won_value` (in `metrics/marketing.ts`) is the explicit campaign → lead → opportunity → won linkage example from the spec — summed only through a REAL `marketingAttributionRecords.crmLeadId` → `crmLeads.convertedOpportunityId` → `crmOpportunities` chain, never inferred from timing. `funnels.ts` provides all three spec-mandated funnels (CRM lead→qualified→opportunity→won, Sales assigned→qualification-started→qualified→opportunity→won, Marketing campaign-sourced-lead→qualified→opportunity→won) as deterministic stage counts + stage-to-stage conversion rates over a real cohort (records created — or, for Marketing, first-attributed — within the query range), with no causal attribution beyond the real canonical links already present.

## Executive KPI foundation

`kpis.ts` — 7 curated groups (Growth/Sales/Marketing/Delivery/Operations/Communications/AI), each a fixed list of already-registered metric keys — reusable query CONTRACTS only, not a Founder Workspace UI (the overview page at `/app/[org]/analytics` is the only UI consuming it in this module). Runs one query PER METRIC (not per group) since several groups deliberately span domains — a caller missing one domain's capability only loses that metric, never the whole group; an empty group is omitted rather than shown blank. One aggregate `analytics_query_executed` audit event covers a whole KPI-overview load, not one per metric, to keep audit volume bounded.

## Saved reports and drill-down

`reports.ts` — full CRUD, revision-guarded updates (`StaleAnalyticsUpdateError` on a lost race), `private`/`organization` visibility (owner or an org admin/Analytics manager may edit; any org member may view an `organization`-visibility report; a `private` report is invisible to everyone else). `runSavedReport` re-runs the identical stored inputs through `runAnalyticsQuery` — never a separate, weaker execution path. `drilldown.ts` returns a bounded id list ONLY, never full records — the actual PII-safety mechanism: a caller who wants the real record behind an id calls that source module's own real per-record read function directly, inheriting its full authorization end to end.

## CSV export

`export.ts` — identical authorization as `/analytics/query` (calls `runAnalyticsQuery` internally), one flat bounded CSV, no PDF. Logs `analytics_export_created` with bounded metadata (metric keys, row count) — never the exported values themselves.

## Authorization and privacy

Full detail in `MODULE_17_ANALYTICS_AUTHORIZATION_AND_PRIVACY.md`. 10 capabilities, independent from every other module's roles, with organization owner/admin bootstrap. Verified directly: an Analytics role alone never substitutes for a source module's own privacy check.

## APIs

Thin authenticated routes under `/api/organizations/{organizationId}/analytics/...`, identical shape to every other module's own routes — `getAuthenticatedUser` + Zod-validated query params/bodies + `handleRouteError`.

## UI

11 pages under `/app/[organizationSlug]/analytics/...` — overview (executive KPI cards by group), 7 domain pages (each rendering every metric registered for that domain as accessible KPI cards + real HTML tables for grouped results, plus the relevant funnel for CRM/Sales/Marketing), saved reports list + create form, a single report's own run view, and settings (business timezone/defaults + role management). No chart library — every value renders as a labeled KPI card or a real `<table>` with `<caption>`/`scope="col"` headers, so every number is understandable and screen-reader-navigable with no chart at all. Reuses the shared premium UI primitives (`Card`, `Badge`, `PageHeader`, `Breadcrumbs`, `FormField`/`SelectField`/`SubmitButton`, `ActionForm`) — no parallel UI system, no fake graphs.

## Audit events

10 new event types added to `src/lib/audit.ts`'s `AuditEventType` union: `analytics_query_executed`, `analytics_report_created`/`_updated`/`_deleted`/`_viewed`, `analytics_drilldown_accessed`, `analytics_export_created`, `analytics_permission_granted`/`_revoked`/`_denied`. Metadata is always metric keys/ids/counts — never a result payload, a record body, or PII.

## Concurrency results

7 tests in `src/lib/analytics-os/concurrency.integration.test.ts`, all passing: concurrent saved-report updates with the same expected revision (exactly one wins), concurrent saved-report creation (no corruption), permission revocation is immediate (no cache), duplicate active role grant rejected, concurrent role revocation (exactly one wins), concurrent aggregate queries across two organizations stay tenant-safe, concurrent CSV exports across two organizations never cross-leak rows.

## Workspace isolation hardening (Pre-Module-18, resolved)

Module 17's own initial release had a disclosed gap: every metric's `compute()` filtered by `organizationId` only — `workspaceId` was threaded through to each domain's own AUTHORIZATION check (so a workspace-scoped viewer without membership was correctly denied) but was not applied as an additional `WHERE` filter on the returned aggregate itself. **This is now fixed**, ahead of Module 18 (Founder Workspace) consuming this layer. Full detail — the exact policy, which tables carry a real `workspaceId` column vs. which are organization-scoped by data model, and the 8 tests proving it — is in `MODULE_17_ANALYTICS_WORKSPACE_ISOLATION.md`.

## Deferred (explicitly, per spec)

Snapshot/scheduled-materialization tables (live-query-only in v1), per-dimension-value query filtering beyond `groupBy` (the `filters` column exists and is validated/stored but not yet applied by the query engine), PDF export, Kids Coding, Home Renovation Rebates.

## Update (LYNQ Founder Workspace / Executive OS, Module 18, now complete)

Founder Workspace consumes this module's own `computeExecutiveKpis`/`runAnalyticsQuery`/metric registry directly, through a thin permission-gated wrapper (`company-pulse.ts`) that checks its own Founder capability FIRST and lets this module's own dual gate run SECOND, unmodified. One real, disclosed registry gap was found during Module 18's own AI Workforce view build: `agent_executions_running`/`completed`/`failed`, `agent_avg_execution_duration`, and `tool_invocations_failed` all declare `agent` as a `supportedDimensions` entry but never implement a per-agent `groupBy` branch in their own `compute()` — Founder Workspace's AI Workforce view works around this by computing its own per-agent breakdown directly against `agent_executions`/`agent_artifacts`, flagged here as a fast-follow for this module rather than silently patched. This module's own metric registry, query engine, schema, and authorization are entirely unchanged. See `MODULE_18_FOUNDER_WORKSPACE.md`.
