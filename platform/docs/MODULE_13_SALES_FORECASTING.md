# Module 13 — Sales Forecasting, Health, Targets & Analytics

Companion to `MODULE_13_SALES_OS.md`. Full detail on the four deterministic-numbers surfaces Sales OS exposes — none of them AI-generated, none of them a stored/cached rollup that can drift from the underlying CRM data.

## Design principle: deterministic, recomputed, never opaque

Every number documented here is produced by a plain aggregate query (sum/count/average/threshold comparison) over real `crm_*`/`sales_*` rows, computed fresh on every call. None of these four surfaces has a materialized/cached table backing it — `resolveEffectiveSalesConfiguration`'s thresholds are the only persisted inputs, and even those are read live on each computation. This is a direct, literal implementation of the spec's own repeated instruction: "do not use opaque AI scoring," "never presents forecasts as guaranteed revenue," "never claim predictive win probability."

## Opportunity health

`src/lib/sales-os/health.ts`. `computeOpportunityHealth` returns `{ status, reasons }` — `status` is always one of `healthy` | `attention` | `at_risk`, derived purely from `reasons.length` via `classifyOpportunityHealth` (0 → healthy, 1–2 → attention, 3+ → at_risk — a pure, synchronous, independently unit-testable function). `reasons` is a subset of a closed eight-value set:

| Reason | Signal |
|---|---|
| `stage_stalled` | Time since the most recent `crm_opportunity_stage_changed` audit event (or `createdAt` if none) exceeds `staleOpportunityThresholdDays` |
| `no_recent_activity` | No `crm_activities` row in that same window |
| `overdue_follow_up` | An open `crm_follow_ups` row past its `dueAt` |
| `no_scheduled_follow_up` | No open follow-up at all |
| `expected_close_date_passed` | `crm_opportunities.expectedCloseDate` is in the past and the opportunity is still open |
| `unresolved_playbook_requirements` | An active `sales_opportunity_playbook_run` has a `pending` item |
| `pending_approval` | A `sales_approval_links` row points at a still-`pending` `agent_approval_requests` row for this opportunity |
| `missing_contact_or_company` | Neither `primaryContactId` nor `companyId` is set |

A closed opportunity (`status !== "open"`) always returns `{ status: "healthy", reasons: [] }` — health is only ever a concern for open pipeline, verified directly (a lost opportunity is never flagged "at risk"). `computeOpportunityHealthForMany` batches the same per-opportunity logic for list/dashboard views — a deliberate, documented perf tradeoff: each opportunity still runs its own bounded set of small queries rather than one true aggregate query, acceptable at the ≤200-row list sizes CRM Core itself already caps at.

## Forecasting

`src/lib/sales-os/forecasting.ts`. `computeForecast` returns:

- `openPipelineValue` — the real sum of `amount` across open opportunities (optionally filtered by `pipelineId`/`workspaceId`).
- `weightedPipelineValueEstimate` — sum of `amount × (stage.probability / 100)` per opportunity, using each opportunity's own current pipeline stage's `probability`. **Always ≤ `openPipelineValue`** (verified directly) and named/typed `...Estimate` everywhere it appears (the type, the API response field, the UI label "Weighted estimate" with an explicit "Estimate — not guaranteed" sublabel) — there is no code path in this module that presents this number as committed or guaranteed revenue.
- `wonValue`/`lostValue` — real sums for opportunities won/lost within an optional period (`periodStart`/`periodEnd` against `wonAt`/`lostAt`).
- `byForecastCategory` — open pipeline value grouped by each opportunity's own `sales_opportunity_forecasts.forecastCategory` (defaulting to `pipeline` if the rep hasn't set one).
- `openOpportunityCount`, `currency` (best-effort, from the first opportunity with one set).

`setOpportunityForecastCategory` is the one bounded, rep/manager-settable field this module adds beyond CRM's own opportunity data (`pipeline` | `best_case` | `commit` | `closed`) — never automatically assigned by any code path, matching the spec's explicit "do not automatically assign categories from AI." Upserted (one row per opportunity, unique on `opportunityId`), gated by `requireSalesOpportunityWorkAuthority` (own opportunity, or team-management authority).

## Targets

`src/lib/sales-os/targets.ts`. A target (`sales_targets`) is scoped to exactly one individual (`userId`) or one team (`teamId`) — enforced by a real Postgres `CHECK` constraint, not just an application-layer assumption — for one `metricType` (`won_revenue`, `opportunities_won`, `leads_qualified`, `activities_completed`) over one period (`periodStart`/`periodEnd`). `createSalesTarget` requires `sales_manage_targets`; `updateSalesTarget` only ever changes `targetValue`, and is revision-guarded (`StaleSalesUpdateError` on a stale `expectedRevision`) — a target's history is never silently overwritten.

`computeTargetProgress` recomputes `actualValue` fresh on every call: for a team-scoped target it expands to that team's current member list (`listSalesTeamMembers`) and sums/counts across all of them; for an individual target it queries just that one user. Each metric type maps to a real, period-filtered CRM query (won opportunities' `amount`/count filtered by `wonAt`, qualified leads filtered by `qualifiedAt`, activities filtered by `occurredAt`) — never a stored running total that could drift from the underlying CRM records. `progressRatio = actualValue / targetValue` (0 when `targetValue` is 0, guarding division by zero).

No compensation, commission, or payout calculation exists anywhere in this module — `computeTargetProgress`'s output is a plain ratio for display, never fed into any payment/accounting path.

## Sales analytics

`src/lib/sales-os/analytics.ts`. `computeSalesAnalytics` returns a single bounded summary object — deliberately Sales OS's own operational view, not the future org-wide Analytics OS:

- `leadsByStatus` — a count per `crm_lead_status` value (all six keys always present, zero-filled).
- `qualificationConversionRate` — `(qualified + converted) / (qualified + disqualified + converted)`, or `null` if no lead has reached a terminal qualification state yet (never a fabricated `0`).
- `averageLeadResponseAgeDays` — mean age of every lead that has moved past `new`, or `null` if none have.
- `opportunitiesByStage` — count and value per pipeline stage, with the real stage name resolved from `crm_pipeline_stages`.
- `openPipelineValue`, `wonValue`, `lostValue` — real sums.
- `averageOpenStageAgeDays` — mean time-in-current-state across all open opportunities, or `null` if none are open.
- `staleOpportunityCount` — open opportunities whose `updatedAt` predates the organization's `staleOpportunityThresholdDays`.
- `followUpsDue`/`followUpsOverdue` — open follow-ups split by whether `dueAt` has passed.

Every `null` in this output is a deliberate "not enough data yet" signal, distinct from a real `0` — the UI never silently renders `null` as `0%`/`0 days`.
