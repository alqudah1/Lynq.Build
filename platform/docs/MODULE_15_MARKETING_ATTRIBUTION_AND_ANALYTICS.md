# Module 15 — Marketing Attribution & Analytics

Companion to `MODULE_15_MARKETING_OS.md`. Full detail on the attribution foundation, destination/UTM tracking, budget tracking, deterministic campaign health, and operational analytics — and, equally, on everything this module deliberately does not compute.

## Attribution model

`src/lib/marketing-os/attribution.ts`. A `marketing_attribution_records` row captures exactly one touch: `touchType` (`first_touch`/`last_touch`), a campaign reference, a source reference, `utmSource`/`utmMedium`/`utmCampaign`/`utmContent`/`utmTerm`, an optional external click/reference id, and `capturedAt`. This is deliberately a **single-touch-per-type** model, not multi-touch attribution modeling — the spec explicitly excludes building weighted/multi-touch attribution in this module.

**First-touch semantics**: `recordAttribution` attempts an insert; a unique-constraint collision (partial unique index on `touchType + leadId`, or `touchType + contactId` when no lead is set) means a first touch already exists for this lead/contact, so `resolveExistingTouch` fetches and returns the pre-existing row **unchanged** — the true first touch is never overwritten by a later campaign. Verified directly: recording two different campaigns' first touches for the same lead returns the identical row both times.

**Last-touch semantics**: the inverse — any existing `last_touch` row for the same lead/contact is deleted before the new one is inserted, so it always reflects the most recent campaign interaction. Verified directly: recording two different campaigns' last touches for the same lead leaves exactly one row, matching the second (newest) campaign.

**Idempotent duplicate recording**: recording the identical touch twice (same campaign, same lead, same type) is a safe no-op for `first_touch` (returns the existing row) and a safe replace for `last_touch` (deletes and re-inserts the same values) — neither path creates a duplicate row, verified directly in the concurrency suite.

No PII lives in a `marketing_attribution_records` row — no name, email, or phone number, only ids and UTM strings. Verified directly by asserting a lead's real, distinctive email substring appears in zero columns of its own attribution record after a full handoff flow.

## Destinations and UTM tracking

`src/lib/marketing-os/destinations.ts`. `marketing_campaign_destinations` is a canonical pointer — `destinationType` (`external_url`/`internal_reference`), the URL/reference itself, `campaignId`, `isActive`, and the UTM tuple (`utmSource`/`utmMedium`/`utmCampaign`/`utmContent`/`utmTerm`, with `utmContent`/`utmTerm` defaulting to `""` rather than `null` so the composite unique index behaves correctly against repeated identical-UTM inserts). `createDestination` surfaces a unique-constraint collision as `MarketingKeyAlreadyTakenError` — verified directly that creating two destinations with the identical campaign + full UTM tuple is rejected on the second attempt, while varying any one UTM field succeeds. No page builder and no landing-page hosting exist in this module; a destination is purely a typed pointer plus its own UTM identity that other parts of Marketing OS (calendar, health, analytics) can reference.

## Budget tracking

`src/lib/marketing-os/budget.ts`. `marketing_budget_entries` — one row per campaign + category (unique constraint), carrying a planned budget amount, a manually recorded spend amount, a currency, and a `revision` guard. `spendSource` is hardcoded to `"manual"` at creation — there is no code path in this module that sets it to `"synced"`, since no ad-platform integration exists yet; the column exists so a future integration can add synced rows without a schema change, but nothing writes one today. `updateBudgetEntry` is revision-guarded exactly like every other mutable Marketing OS record — verified directly with a racing double-update, one caller wins, the other gets `StaleMarketingUpdateError`. No billing or accounting logic (invoicing, currency conversion, ledger entries) exists here — this is a planning/tracking record, not a financial system of record.

## Campaign health

`src/lib/marketing-os/health.ts`. `computeReasonsForCampaign` evaluates a closed, deterministic set of conditions against real Marketing OS/CRM state — never an inferred or fabricated performance judgment:

| Reason code | Condition |
|---|---|
| `start_date_near_missing_requirements` | Campaign starts soon but audience/destination/budget is missing |
| `overdue_content` | Content items past their `plannedPublishAt` still not `published`/`archived` |
| `pending_approval` | A linked approval request is still awaiting decision |
| `no_audience` | No primary audience configured |
| `no_destination` | No active destination configured |
| `missing_utm` | A destination exists but its UTM tuple is incomplete |
| `budget_missing` | No budget entry recorded for an active/ready campaign |
| `workflow_stalled` | The linked campaign run is stuck (no progress past its own staleness threshold) |
| `campaign_end_passed` | The campaign's end date has passed |
| `missing_review` | The campaign ended but was never run through a Campaign Review workflow/agent summary |

`classifyCampaignHealth` maps reason count to state: `healthy` (0), `attention` (1–2), `at_risk` (3+) — never a numeric score, never a percentage, never a probability. Verified directly: a freshly created campaign with no audience/destination/budget starts `at_risk`; configuring an audience and a properly-UTM'd destination moves it toward `healthy` as the corresponding reason codes disappear one at a time, deterministically, from the exact same input state each time the function is called (no hidden randomness or caching).

## Marketing analytics — what is real, and what is deliberately absent

`src/lib/marketing-os/analytics.ts`. Every figure `getMarketingAnalyticsSummary` returns is either a plain aggregate over Marketing OS's own tables or a dual-gated aggregate over real CRM data (via `requireCrmViewAuthority`, composed with Marketing OS's own `marketing_view` check — see `MODULE_15_MARKETING_AUTHORIZATION_AND_PRIVACY.md`):

- **Marketing-OS-native**: campaigns by status, campaigns starting soon, overdue content count, content by status, pending approvals count, budget planned total vs. recorded spend total, workflow-execution counts by status, audience size (from the audience's own live-or-snapshot evaluation).
- **CRM-derived**: campaign-sourced CRM lead count, qualified lead count by campaign, opportunity count by campaign source, won value by campaign source — every one a real `COUNT`/`SUM` query against `crm_leads`/`crm_opportunities` filtered by the attribution/source reference, never an estimate or a proxy metric.

**Explicitly and permanently absent from this module's analytics until a real channel integration exists**: impressions, reach, clicks, CPC, CTR, ROAS, ad spend synced from a platform, and any engagement metric that would require an external channel API. There is no placeholder, mock, or "coming soon" value for any of these — the fields simply do not appear in `MarketingAnalyticsSummary`'s shape at all, so no UI surface can accidentally render a fabricated number for them. When a real integration is eventually built, it should add these as clearly-labeled, clearly-sourced fields rather than backfilling zeros or estimates into the existing shape.

## Not built in this module

Multi-touch/weighted attribution modeling, predictive attribution, a landing-page builder or hosting, ad-platform spend sync, billing/accounting integration, and any global cross-module Analytics OS (campaign-level operational analytics only — this is not the org-wide reporting layer a future module may build). Deterministic campaign health is a completeness/process signal, not a performance or ROI judgment.
