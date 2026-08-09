# Module 17 — Analytics Workspace Isolation Hardening (Pre-Module-18)

## The gap

Module 17's initial release threaded `workspaceId` through to every domain's own AUTHORIZATION check (`resolveCrmAuthContext`, etc. — so a workspace-scoped viewer without membership was correctly denied) but never applied it as a `WHERE` filter on the actual aggregate query. A caller authorized for workspace-scoped analytics could receive a value that silently included other workspaces' records within the same organization. Cross-**organization** isolation was never affected (every metric always filtered by `organizationId`, and that guarantee was tested from Module 17's own first release) — this was specifically a cross-**workspace** gap within one organization.

## The fix — applied at the canonical source query

`query-support.ts` exports `workspaceScopeCondition(column, workspaceId)`: returns `eq(column, workspaceId)` when a workspace was requested and the table has a real `workspaceId` column, or `undefined` (a no-op inside `and()`) otherwise. Every one of the 36 metrics' `compute()`/`computeSeries()`/`drilldown()` implementations, `funnels.ts`, and the query engine's own dispatch now apply this at the actual `SELECT ... WHERE` — never as a post-aggregation filter, and never by re-querying and discarding rows in application code.

**Inclusion policy** (applies uniformly):
- A workspace-scoped query (`workspaceId` set) includes ONLY rows whose own `workspaceId` column equals the requested workspace. A row with `workspaceId = NULL` (an organization-level record not tied to any single workspace) is excluded from a workspace-scoped view.
- An organization-wide query (`workspaceId` null) applies no workspace filter at all — every row is included regardless of its own `workspaceId`, identical to the pre-hardening behavior and to how `requireCrmViewAuthority` already treats "any organization member may view an org-wide record."
- "Organization-level analytics" (an org-wide query) requires only ordinary organization membership to authorize, in every domain that has its own role/authority system (CRM's `isWorkspaceScoped = Boolean(workspaceId)` — false, so any member passes; Sales/Marketing/Communications OS's own role systems have no workspace concept at all, so their gate is unaffected either way). No new, stricter "org-wide analytics" capability was introduced — none of this codebase's existing per-domain authorization draws that distinction, and inventing one unilaterally would be a real behavior change beyond this hardening's own scope.

## Which tables carry a real `workspaceId` — audited directly against the schema

| Table | Has `workspaceId`? | How each metric reaches it |
|---|---|---|
| `crm_contacts` | Yes | Direct filter |
| `crm_opportunities` | Yes | Direct filter |
| `marketing_campaigns` | Yes | Direct filter |
| `communication_conversations` | Yes | Direct filter |
| `projects` | Yes | Direct filter |
| `workflow_executions` | Yes | Direct filter |
| `agent_executions` | Yes | Direct filter |
| `tool_invocations` | Yes | Direct filter |
| `communication_messages` | **No** | Joined to its own `communication_conversations` row via `conversationId`, filtered on the conversation's `workspaceId` |
| `project_tasks` | **No** | Joined to its own `projects` row via `projectId`, filtered on the project's `workspaceId` |
| `agent_approval_requests` | **No** | Joined to its own `agent_executions` row via `executionId`, filtered on the execution's `workspaceId` |
| `marketing_content_items` | **No** | Joined to its own `marketing_campaigns` row via `campaignId` (`NOT NULL`, so the join never drops a row) |
| `marketing_attribution_records` | **No** | Joined to its own `marketing_campaigns` row via `campaignId` |
| `marketing_budget_entries` | **No** | Joined to its own `marketing_campaigns` row via `campaignId` (`NOT NULL`) |
| `crm_leads` | **No** | **No path to a workspace exists at all** — CRM Core's own `leads.ts` already always calls `resolveCrmAuthContext` with `workspaceId: null`, treating leads as inherently organization-scoped; `resolveCrmEntityWorkspaceId`'s own doc comment confirms leads/activities/notes/follow-ups carry no workspace by design. Every lead-based metric (`crm_leads_open`, `crm_leads_qualified`, `sales_qualification_conversion_rate`, `sales_leads_unassigned`, the lead-based funnel stages) stays organization-wide even under a workspace-scoped query — documented in each metric's own `description` field, not silently narrowed by a column that doesn't exist. |
| `crm_follow_ups` | **No** | Same organization-scoped-by-design status as leads — a follow-up's real scope, if any, is whichever linked contact/company/opportunity's own workspace, never denormalized onto the follow-up row itself. `crm_followups_overdue` stays organization-wide under a workspace-scoped query. |

## `marketing_campaign_sourced_won_value` and the CRM/Sales/Marketing funnels — a deliberate double-narrowing

Metrics/stages that trace a real cross-module chain (campaign → lead → opportunity → won) join both the originating campaign and the resulting opportunity. Where both carry their own `workspaceId`, the metric applies the workspace filter to the record most directly responsible for the number being reported: `marketing_campaign_sourced_won_value` filters on the WON OPPORTUNITY's own `workspaceId` (the deal's own actual workspace). The Marketing funnel's own "won" stage filters on BOTH the attributing campaign's and the resulting opportunity's `workspaceId` — if a campaign in workspace A produced a deal that was, unusually, filed under workspace B, that deal is excluded from BOTH workspaces' funnels (never wrongly included in either), while still counting in the organization-wide view. This is the conservative, leak-proof choice: additional filters can only ever shrink a result, never admit a row that shouldn't be there.

## Saved reports and drill-down — already structurally safe, verified rather than changed

- **Saved reports**: `analyticsSavedReports.workspaceId` is set once at creation and is not among `updateSavedReport`'s updatable fields — structurally immutable. `runSavedReport` never accepts a caller-supplied `workspaceId` override; it always reads the report's own stored value. A workspace-scoped report cannot be widened to organization scope by any code path that existed before or after this hardening — verified directly by a test, not newly enforced.
- **Drill-down**: `runAnalyticsDrilldown` passes the caller's `workspaceId` straight into the same `MetricComputeContext` its `compute()` sibling uses, so the exact same `workspaceScopeCondition` calls apply — a workspace-scoped drill-down was never a separate, unscoped code path.

## Tests

`src/lib/analytics-os/workspace-isolation.integration.test.ts` — 8 tests, all passing: Workspace A excludes Workspace B (and vice versa) for contacts, organization-wide analytics include both workspaces, CRM leads stay organization-wide under a workspace-scoped query (the disclosed exception, proven equal to the org-wide value), a workspace-scoped saved report cannot widen to organization scope, a workspace-scoped drill-down cannot cross into another workspace, funnels remain workspace-safe (a won opportunity outside the requested workspace is never counted), executive KPIs remain workspace-safe, and the CRM/Sales/Marketing/Communications dual-gate behavior remains intact (an Analytics admin with no Sales OS role is still denied a Sales metric — proving the source-module gate, not merely the central Analytics capability, is what blocks the call). The full Analytics OS suite (functional + concurrency + workspace isolation, 37 tests) was re-run after this hardening and passes clean.
