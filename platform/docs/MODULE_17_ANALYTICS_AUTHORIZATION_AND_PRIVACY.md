# Module 17 — Analytics Authorization and Privacy

## Role model

`authz.ts` — 3 roles (`analytics_admin`, `analytics_manager`, `viewer`), entirely independent of CRM/Sales/Marketing/Communications/Brain roles; none of those imply Analytics access, and an Analytics role implies nothing about any of those. Organization owner/admin bootstrap (`isOrgAdmin`) — the same "no separate department-lead model exists yet" fallback already established for every prior module's own role system.

## Capabilities

10, defined in `validation.ts`'s `ANALYTICS_CAPABILITIES`: `analytics_view` (the floor — required to touch Analytics at all), `analytics_view_crm`/`_sales`/`_marketing`/`_communications`/`_projects`/`_workflows`/`_agents` (one per domain, gates that domain's metrics specifically), `analytics_manage_reports` (create/update/delete a saved report), `analytics_admin` (grant/revoke roles, manage the org's Analytics configuration).

| Role | Capabilities |
|---|---|
| `viewer` | `analytics_view` + all 7 domain views |
| `analytics_manager` | everything `viewer` has + `analytics_manage_reports` |
| `analytics_admin` | everything, including `analytics_admin` itself |

## The dual-gate rule — the load-bearing rule of this module

**Analytics permission alone must NOT bypass a source module's own privacy.** Concretely: `runAnalyticsQuery` checks the central `analytics_view_<domain>` capability once, BEFORE dispatching to any metric — but every metric's own `compute()` independently calls that SOURCE module's own real aggregate-safe view-authority function (`requireCrmViewAuthority`, `requireSalesViewAuthority`, `requireMarketingViewAuthority`, `requireCommunicationsViewAuthority`, or plain `requireOrganizationMembership` for Projects/Workflows/Agents — see below) a second time, from scratch, every call. Neither check ever substitutes for the other. Verified directly by a functional test: an Analytics admin still receives a real CRM authorization decision, not a rubber stamp, when querying a CRM metric.

## Projects/Workflows/Agents: a documented narrower floor

CRM/Sales/Marketing/Communications OS each expose a real org-wide (or workspace-wide) "aggregate-safe view" function of their own. Projects Core and Workflow Engine do not — their own authorization is deliberately per-record (`requireProjectViewAuthority(db, ctx, projectId)`, `requireWorkflowExecutionViewAuthority(db, ctx, definitionId)`), and Agent Runtime's own `requireExecutionVisibility`/`requireExecutionManageAuthority` are per-execution. For these three domains' org-wide COUNT metrics, plain `requireOrganizationMembership` is the aggregate-safe floor — any org member can see "12 projects blocked," matching what those modules' own list pages already show any member today. Drilling into one specific project/execution's own real record still goes through that record's own real, narrower authorization (`getProjectForUser`, `getWorkflowExecutionForUser`, etc.) — this module's own `drilldown.ts` never bypasses that, since it only ever returns bounded ids, and a real record read is a separate call the caller makes afterward.

## Drill-down authorization

`drilldown.ts`'s `runAnalyticsDrilldown` checks central `analytics_view` + `analytics_view_<domain>`, confirms the metric defines a `drilldown`, then delegates — the metric's own `drilldown()` re-runs the identical dual-gate its `compute()` uses. The actual mechanism that satisfies "no PII unless the caller independently has the underlying module permission" is structural, not a runtime check: **the response is an id list only, never a record.** A caller who wants the real record behind an id must separately call that source module's own real per-record read endpoint, which carries its own complete, independent authorization — Analytics never becomes a side door to full record contents.

## Privacy defaults

Every metric result defaults to an aggregated value (a count, sum, or rate) — no metric returns a raw list of contact emails, phone numbers, CRM notes, message bodies, marketing audience membership, full agent inputs, or full artifact contents. Dimension labels are drawn from bounded, non-PII fields (ids, enum values, or short names like a pipeline stage's own display name) — no metric ever groups by contact email or phone. Verified directly: a functional test seeds a Communications message with a distinctive secret body string, runs the `communications_messages_sent` metric, and asserts the full JSON response never contains that string (while confirming, via a direct DB read, that the string really was stored — proving the omission is deliberate, not accidental).

## Saved report visibility

`private` (default — visible only to the owner, or an org owner/admin) or `organization` (visible to any org member who already holds `analytics_view`). Editing/deleting requires being the report's own owner, or holding `analytics_manage_reports`/`analytics_admin`. Verified directly: a second org member holding an Analytics `viewer` role cannot run another user's `private` report.

## Audit

`analytics_permission_denied` is recorded on every capability check failure (`denyAndAudit` in `authz.ts`), with a bounded `{detail, capability}` metadata shape — no request payload, no attempted result. `analytics_query_executed`/`analytics_report_viewed`/`analytics_drilldown_accessed`/`analytics_export_created` metadata is always metric keys, ids, or counts — never a value, a record body, or PII. `analytics_query_executed` is deliberately NOT recorded for internal/automated callers (`recordAudit: false`, used by `computeExecutiveKpis`'s own per-metric sub-queries and by `exportAnalyticsQueryToCsv`'s internal query) — one aggregate event per real user-facing action instead, avoiding audit noise for what would otherwise be dozens of near-duplicate entries per page load.
