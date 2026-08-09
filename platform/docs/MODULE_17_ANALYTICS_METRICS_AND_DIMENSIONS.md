# Module 17 — Analytics Metrics and Dimensions

The complete registry as shipped: 36 metrics across 7 domains, 15 dimensions. Every metric's real `MetricDefinition` lives in `src/lib/analytics-os/metrics/<domain>.ts`; this document is a reference index, not a second source of truth — if this list and the code ever disagree, the code (and `resolveMetric`'s own runtime validation) wins.

## Reading the columns

**Classification** — `actual` (a real recorded fact), `derived` (computed from real facts, e.g. a rate), `estimated` (a labeled projection, e.g. weighted pipeline — never presented as actual), `manual` (human-entered, never provider-verified). **Series** — has a real `computeSeries` implementation (day/week/month/quarter). **Drilldown** — has a real `drilldown` implementation returning bounded ids.

## CRM (`metrics/crm.ts`)

| metricKey | classification | series | drilldown |
|---|---|---|---|
| `crm_contacts_total` | actual | | |
| `crm_leads_open` | actual | ✓ | |
| `crm_leads_qualified` | actual | | |
| `crm_opportunities_open` | actual | | |
| `crm_opportunities_won` | actual | | |
| `crm_pipeline_value` | actual | | |
| `crm_won_value` | actual | | |
| `crm_followups_overdue` | actual | | ✓ |

## Sales (`metrics/sales.ts`)

| metricKey | classification | series | drilldown |
|---|---|---|---|
| `sales_pipeline_weighted_value` | **estimated** | | |
| `sales_opportunities_at_risk` | derived | | ✓ |
| `sales_qualification_conversion_rate` | derived | | |
| `sales_leads_unassigned` | actual | | |

`sales_pipeline_weighted_value` sums `amount × stage probability / 100` over open opportunities — its own doc comment states explicitly it must never be presented as actual revenue. `sales_opportunities_at_risk` is a narrow single-reason proxy (past `expectedCloseDate`), explicitly documented as distinct from Sales OS's own richer multi-reason health classification on the opportunity detail page.

## Marketing (`metrics/marketing.ts`)

| metricKey | classification | series | drilldown |
|---|---|---|---|
| `marketing_campaigns_active` | actual | | |
| `marketing_content_overdue` | actual | | ✓ |
| `marketing_campaign_sourced_leads` | actual | ✓ | |
| `marketing_campaign_qualified_leads` | actual | | |
| `marketing_campaign_sourced_won_value` | actual | | |
| `marketing_planned_budget` | actual | | |
| `marketing_manual_spend` | **manual** | | |

`marketing_manual_spend`'s own doc comment states no ad-platform integration exists — impressions/clicks/ROAS are never fabricated because they are simply not implemented as metrics at all in this release. `marketing_campaign_sourced_leads`/`_qualified_leads`/`_sourced_won_value` only count a real `marketingAttributionRecords` → `crmLeads`/`crmOpportunities` chain, never inferred timing correlation.

## Communications (`metrics/communications.ts`)

| metricKey | classification | series | drilldown |
|---|---|---|---|
| `communications_messages_sent` | actual | ✓ | |
| `communications_messages_delivered` | actual | ✓ | |
| `communications_messages_failed` | actual | ✓ | ✓ |
| `communications_inbound_messages` | actual | ✓ | |
| `communications_delivery_rate` | derived | | |
| `communications_conversations_active` | actual | | |

`communications_messages_delivered`'s own doc comment states development providers never produce a delivery event — this metric is always 0 for an org using only dev providers, verified by a functional test.

## Projects (`metrics/projects.ts`)

| metricKey | classification | series | drilldown |
|---|---|---|---|
| `projects_active` | actual | | |
| `projects_blocked` | actual | | ✓ |
| `project_tasks_open` | actual | | |
| `project_tasks_overdue` | actual | | ✓ |
| `project_completion_rate` | derived | | |

Aggregate-access gate: plain organization membership (Projects Core has no org-wide aggregate view function of its own — see `MODULE_17_ANALYTICS_OS.md`'s contradiction-reconciliation section).

## Workflows (`metrics/workflows.ts`)

| metricKey | classification | series | drilldown |
|---|---|---|---|
| `workflows_running` | actual | | |
| `workflows_completed` | actual | ✓ | |
| `workflows_failed` | actual | ✓ | ✓ |
| `workflow_completion_rate` | derived | | |
| `workflow_avg_duration` | derived | | |

Aggregate-access gate: plain organization membership (same reasoning as Projects).

## Agents (`metrics/agents.ts`)

| metricKey | classification | series | drilldown |
|---|---|---|---|
| `agent_executions_running` | actual | | |
| `agent_executions_completed` | actual | ✓ | |
| `agent_executions_failed` | actual | ✓ | ✓ |
| `agent_success_rate` | derived | | |
| `agent_avg_execution_duration` | derived | | |
| `tool_invocations_failed` | actual | ✓ | ✓ |
| `approvals_pending` | actual | | ✓ |

Aggregate-access gate: plain organization membership (Agent Runtime's own authorization, like Projects/Workflows, is per-execution — `requireExecutionVisibility`/`requireExecutionManageAuthority` take a specific execution, with no org-wide aggregate equivalent). `approvals_pending` is a live snapshot count, not bounded by the query's date range.

## Zero-denominator handling

Every rate/percentage metric (`sales_qualification_conversion_rate`, `communications_delivery_rate`, `project_completion_rate`, `workflow_completion_rate`, `agent_success_rate`) returns `null`, not `0`, when its denominator is 0 — each metric's own `nullSemantics` field states this explicitly, and each has a dedicated functional test proving it.

## Dimension registry (`dimensions.ts`)

`time`, `workspace`, `owner`, `pipeline`, `pipeline_stage`, `campaign`, `campaign_status`, `source`, `channel`, `provider`, `project`, `workflow`, `agent`, `task_type`, `status` — 15 fixed keys. A metric's own `supportedDimensions` is a closed per-metric allow-list checked against both this registry and the metric's own declaration (`assertMetricSupportsDimension` in `metrics/registry.ts`) — no arbitrary database column is ever reachable from a `groupBy` query parameter.
