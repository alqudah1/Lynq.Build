# Module 18 — Founder Authorization and Privacy

## Role model

`founder-os/authz.ts` — 3 roles (`founder_viewer`, `founder_executive`, `founder_admin`), entirely independent of CRM/Sales/Marketing/Communications/Analytics/Brain roles; none of those imply Founder Workspace access, and a Founder role implies nothing about any of those. Organization owner/admin bootstrap — the same fallback every prior module's own role system already established.

## Capabilities

10, defined in `validation.ts`'s `FOUNDER_CAPABILITIES`: `founder_workspace_view` (the floor), `founder_workspace_view_financial` (dollar-denominated figures specifically), `founder_workspace_view_sales`/`_marketing`/`_operations`/`_agents` (per-domain), `founder_workspace_manage_goals`, `founder_workspace_manage_decisions`, `founder_workspace_manage_layout`, `founder_workspace_admin` (role/permission management).

| Role | Capabilities |
|---|---|
| `founder_viewer` | `view` + `view_sales` + `view_marketing` + `view_operations` + `view_agents` (no `view_financial`, no `manage_*`) |
| `founder_executive` | everything `founder_viewer` has, plus `view_financial`, `manage_goals`, `manage_decisions`, `manage_layout` |
| `founder_admin` | everything, including `admin` itself |

Financial figures are deliberately gated behind a role tier above the base viewer — a `founder_viewer` sees "3 opportunities at risk" but not a dollar-denominated pipeline value unless separately granted `founder_workspace_view_financial`.

## The dual-gate rule — the load-bearing rule of this module, inherited from Analytics OS

**Founder Workspace permission does not bypass source-module privacy.** Every executive view checks the Founder-side capability FIRST, then calls into Analytics OS (or, for Sales OS's own real functions, Sales OS directly) SECOND — which independently re-checks its own central `analytics_view_<domain>` capability, which itself dispatches to a metric whose own `compute()` re-checks the SOURCE module's real aggregate-safe view authority. Three layers, none of which ever substitutes for another. Verified directly: a Founder executive with no Sales OS role of their own is still denied `computeExecutiveSalesView` with `InsufficientRoleError` — proving the Sales-side gate, not merely the Founder-side one, is what actually blocks the call.

## Approval decisions

`decideFounderApproval` never invents its own authorization — it delegates entirely to Agent Runtime's own `approveRequest`/`rejectRequest`/`requestRevision` (Module 7), whose own `requireApproverAuthority` (org owner/admin, or the linked execution's own accountable owner) is the real, unmodified gate. Founder Workspace adds no additional restriction and no bypass.

## Drill-down

Founder Workspace does not re-expose Analytics OS's own `/analytics/drilldown` endpoint directly — every executive view's own "drilldown" field on an attention item is a bounded `{metricKey, recordType, recordId}` reference the CLIENT follows to the real Analytics OS drill-down endpoint (or, for record types with no registered metric, directly to the source module's own detail page), which independently re-runs the full Founder+Analytics+source-module three-layer check described above. Founder Workspace itself never returns a full record — only ids and metric-value summaries, the identical discipline Analytics OS's own drill-down established.

## Privacy defaults

No executive view ever returns a contact's email/phone, a message body, a private CRM note, full agent task inputs, credentials, or a raw provider payload. Verified directly: a functional test seeds a CRM contact with a distinctive email address and asserts the full JSON of `computeCompanyPulse`'s response never contains it. The AI Workforce view's own module comment states explicitly it shows no hidden reasoning and no credential values — every field it returns (execution counts, success rate, artifact counts) is a bounded number or enum, never full artifact content.

## Workspace scoping

Every executive view accepts an optional `workspaceId` and threads it through to Analytics OS's own now-hardened workspace-isolation policy (see `MODULE_17_ANALYTICS_WORKSPACE_ISOLATION.md`) for every metric-backed figure. Two direct-query gaps in this module's OWN new code (not Analytics OS's) were found during testing and fixed before this module was considered complete — see the final report's "Bugs discovered" section and `MODULE_18_FOUNDER_WORKSPACE.md`'s own hardening note.

## Founder Analyst's own access model

The Founder Analyst agent is registered at `assistant` permission level — the same minimum tier the Company Knowledge Analyst (Module 8) established as sufficient for artifact creation, and structurally nothing more: its one task type's entire code path (`computeDailyBrief` and everything it calls) only ever reads canonical tables through the same real service functions a human Founder-Workspace caller would use, and writes exactly one thing — its own `report` artifact via the real Agent Runtime artifact-creation path. It holds no Brain grant, no CRM/Sales/Marketing/Communications write capability, and no permission-management capability of any kind — "Founder Analyst" is never a superuser. Verified directly: a functional test creates a CRM lead, launches the Founder Analyst's real task, and asserts the lead's own row is byte-for-byte unchanged afterward.

## Audit

`founder_permission_denied` is recorded on every capability check failure, with a bounded `{detail, capability}` metadata shape. `founder_daily_brief_generated`/`founder_agent_task_started`/`founder_agent_artifact_created` record ids and counts only — never the brief's own text content. No dashboard render, KPI card fetch, or attention-item computation is ever audited on its own — only durable user-authored actions (decisions, goals, configuration, role grants, real approval decisions) and real agent-task lifecycle events.
