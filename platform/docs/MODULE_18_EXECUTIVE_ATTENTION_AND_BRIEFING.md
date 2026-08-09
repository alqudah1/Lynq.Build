# Module 18 — Executive Attention Engine and Daily Briefing

## The attention engine is not AI judgment

`attention-engine.ts`'s `computeAttentionItems` is a fixed, deterministic set of 15 rule functions across 7 domains — no LLM call, no opaque scoring, no free-text reasoning. Every rule is a single bounded SQL query against one real canonical table with a fixed, documented threshold, producing an `AttentionItem` that names the real record behind it (`recordType`/`recordId`) and a `reasonCode` drawn from a closed set. Running the engine twice against unchanged data returns byte-for-byte identical output — verified directly by a functional test.

## The 15 rules

| Domain | Reason code | Signal | Severity |
|---|---|---|---|
| CRM | `overdue_critical_follow_up` | Open follow-up, `dueAt` passed, priority high/urgent | urgent |
| Sales | `high_value_opportunity_at_risk` | Open opportunity, `expectedCloseDate` passed, has an amount, top 10 by value | urgent |
| Sales | `stale_sales_pipeline` | Open opportunity, `updatedAt` > 14 days old | info |
| Sales | `target_far_behind_schedule` | Active Sales target where actual progress trails expected (period-elapsed) progress by >25 points | attention |
| Marketing | `campaign_starting_with_missing_requirements` | Campaign still `draft`, `startDate` within 7 days | attention |
| Marketing | `campaign_at_risk` | Active/ready campaign with content items past `plannedPublishAt` | attention |
| Delivery | `blocked_project` | Project `status = blocked` | urgent |
| Delivery | `overdue_project_milestone` | Milestone `targetDate` passed, not completed/cancelled | attention |
| Operations | `failed_workflow` | Workflow execution failed within the last 7 days | urgent |
| Operations | `dead_lettered_runtime_job` | Runtime job `status = dead_lettered` | urgent |
| Communications | `high_message_failure_rate` | ≥5 outbound attempts in 24h, ≥30% failed | attention |
| Communications | `disabled_integration_required_by_active_workflow` | Disabled connection with messages still queued/sending against it | urgent |
| Agents | `pending_approval_nearing_expiry` | Pending approval expiring within 4 hours | attention |
| Agents | `repeated_agent_execution_failure` | Same agent, ≥3 failed executions in 7 days | urgent |

Two spec-suggested signals were implemented as narrower, honestly-labeled proxies rather than the full concept, with the simplification stated in both the rule's own `explanation` text and here: `stale_sales_pipeline` uses the opportunity's own `updatedAt` (a real, bounded proxy for "no activity," not a richer activity-log-based recency signal, since no separate activity-recency table exists), and `disabled_integration_required_by_active_workflow` flags a disabled connection with real messages still queued against it (a real, direct impact signal) rather than statically parsing every workflow definition's own node configuration for a reference to that connection.

## Severity and ranking

Three fixed severities (`urgent`/`attention`/`info`), assigned per rule at authorship time — never computed from an opaque formula. `computeAttentionItems`'s own final sort is deterministic: severity first (urgent > attention > info), then earliest `dueAt`, then items with no `dueAt` last. This is explicitly labeled "deterministic prioritization" everywhere it surfaces in the UI, never described as AI judgment.

## Workspace scoping

Every rule applies the identical `workspaceScopeCondition` policy Analytics OS's own hardening established — including a real bug found and fixed during this module's own testing (see the final report). CRM follow-ups are the one documented exception, staying organization-wide under a workspace-scoped query because they carry no workspace column anywhere in their schema chain, consistent with CRM leads/follow-ups' own established status.

## Daily brief structure

`daily-brief.ts`'s `computeDailyBrief` — fully deterministic, no LLM call:

1. **Company snapshot** — `computeCompanyPulse`'s own real KPI groups.
2. **Changes since previous day** — 5 fixed headline metrics (`crm_leads_open`, `crm_won_value`, `workflows_failed`, `communications_messages_sent`, `agent_executions_failed`), queried from UTC midnight today to now, compared against the identical-length window immediately before (via Analytics OS's own `previous_period` comparison strategy) — a real day-over-day delta, not a semantic "yesterday" claim beyond what a UTC boundary actually means (documented as a v1 simplification; the org's own configured business timezone is not yet used for this one section, unlike every other Analytics OS date boundary, which already is).
3. **Attention items** — the real, full output of `computeAttentionItems`.
4. **Approvals pending** — the real count from `listFounderApprovals`.
5. **Suggested executive actions** — the top 5 attention items' own `title`/`recommendedActionType`, restated — never a new narrative, never an insight not already present in the attention items themselves.

`formatDailyBriefAsText` renders this into the bounded plain-text content stored on the Founder Analyst's own `report` artifact.

## Founder Analyst — decision support only

Registered through Module 14's generic agent task handler contract (`taskType: "founder_company_brief"`), mirroring the Company Knowledge Analyst's (Module 8) own precedent shape. `launchFounderCompanyBriefTask` drives a real execution through `createExecution → assign → start → planning → createPlan → reasoning → executing`, computes the brief, creates the `report` artifact, completes each plan step, advances to `verifying`, and calls the real `completeExecution` (which itself enforces every plan step is resolved before allowing the transition — no shortcut). The agent may never approve its own output, send a communication, move an opportunity, launch a campaign, or change a permission — structurally true because its one task type's own code never calls any function capable of those things.

## Idempotency — the exact guarantee level

`launchFounderCompanyBriefTask` is idempotent within a calendar day (UTC): a second call on the same day for the same organization finds the first call's own execution (by `assignedAgentId` + `createdAt >= startOfToday`) and returns its existing `report` artifact rather than creating a second one. This is an application-level read-then-create check, not a database-level unique constraint (no existing schema column supports one for this specific case) — verified directly by a concurrency test calling it twice in sequence and asserting the same execution/artifact id both times. This guards against a repeated or accidental call; it is not a hardened defense against two requests racing the exact same millisecond, which would require a new unique constraint — disclosed here rather than overclaimed.
