# Module 15 — LYNQ Marketing OS Core

The operational layer for planning, managing, executing, and measuring marketing work — campaigns, audiences, content, playbooks, agent-assisted drafting/briefing/reporting, attribution, budget, and deterministic health/next-best-actions. Built directly on the existing CRM Core (Module 12), Sales OS (Module 13), Workflow Engine (Module 11), Agent Registry/Runtime (Modules 6/7/9), Module 14's generic agent task handler contract, Tool Runtime, Projects Core (Module 10), Brain, approvals, artifacts, audit system, and the premium dashboard/UI shell. Not a social-media-scheduler or ad-platform clone, and not the future global Analytics OS — a canonical Marketing OS that can connect to external channels cleanly later. No external email/SMS/WhatsApp integrations, Kids Coding, or Home Renovation Rebates in this module.

## Contradiction reconciliation (pre-implementation review)

No genuine architectural contradiction was found. CRM Core's contact/company/lead/opportunity/source schema and authority model, Sales OS's independent-capability-role pattern, the Workflow Engine's generic `agent_execution` node (already made agent-generic by Module 14 — the one contradiction Sales OS itself had to work around no longer exists), Module 14's task handler registry contract, and Runtime's approval/artifact primitives all composed cleanly with Marketing OS's own additions. Marketing OS's starter workflow templates use `agent_execution` nodes directly, unlike Sales OS's three templates (which predate Module 14's fix and were deliberately left as-is, out of this module's scope).

No existing entity was duplicated: campaigns, audiences, content, and playbooks are genuinely new concepts with no prior home in CRM/Sales OS/Projects; everything else (contacts, companies, leads, opportunities, CRM activities/follow-ups, projects, workflows, agent executions, tool invocations, artifacts, approvals) is referenced by id only.

## Files created and modified

**Schema**: `src/db/schema.ts` (appended) — 18 new enums, 19 new tables. Migration `drizzle/0029_marketing_os_module15.sql`, plus two follow-up FK fixes discovered via integration testing: `drizzle/0030_marketing_approval_links_cascade_fix.sql`, `drizzle/0031_marketing_content_artifact_cascade_fix.sql` (see "Bugs discovered" in the final report).

**Services** (`src/lib/marketing-os/`, 25 files): `validation.ts`, `errors.ts`, `authz.ts`, `configuration.ts`, `roles.ts`, `teams.ts`, `campaigns.ts`, `audience-filters.ts`, `audiences.ts`, `content.ts`, `playbooks.ts`, `campaign-runs.ts`, `destinations.ts`, `attribution.ts`, `budget.ts`, `health.ts`, `next-best-action.ts`, `approvals.ts`, `work-queue.ts`, `calendar.ts`, `analytics.ts`, `agents.ts`, `templates.ts`, `handoff.ts`, `project-links.ts`, `test-helpers.ts`.

**Modified existing modules**: `src/lib/audit.ts` (+30 `AuditEventType` values), `src/lib/dashboard/nav-items.ts` (+"Marketing" link), `src/lib/agent-runtime/task-types.ts` (+3 `AGENT_TASK_TYPES` values). No CRM/Sales OS/Workflow/Projects service function was modified — every integration point is additive (a new caller of an existing function, never a changed signature or behavior).

**APIs**: 32 route files under `src/app/api/organizations/[organizationId]/marketing/...` — config, teams (+`[teamId]/members`), campaigns (+`[campaignId]`, `/transition`, `/runs`, `/destinations`, `/budget`, `/health`, `/brief`, `/summary`), audiences (+`[audienceId]`, `/evaluate`), content (+`[contentId]`, `/transition`, `/draft`, `/submit`, `/approval-decision`), playbooks (+`[playbookId]`, `/versions/[versionId]/steps`, `/versions/[versionId]/publish`), runs/`[runId]`/items, runs/`[runId]`/complete, my-work, next-actions, calendar, analytics, seed.

**Dashboard**: `src/lib/dashboard/actions/marketing.ts` (~40 server actions across 29 exported top-level functions); 14 pages under `src/app/app/[organizationSlug]/marketing/...`.

**Tests**: 2 integration files under `src/lib/marketing-os/` — `functional.integration.test.ts` (12 tests), `concurrency.integration.test.ts` (14 tests) — plus one manual end-to-end script, run and deleted per the established scratch-runner convention.

## Schema and migrations

19 new tables, every one tenant-scoped by a direct `organizationId` FK (`onDelete: cascade`) — verified directly by deleting a throwaway org and confirming zero orphaned rows across all 19 tables. No `crm_*`/`sales_*`/`project_*`/`workflow_*` table was touched, added to, or duplicated.

**Configuration/teams/roles**: `marketing_configurations` (org- or org+workspace-scoped, two partial unique indexes — identical pattern to `sales_configurations`), `marketing_teams`, `marketing_team_members` (operational grouping only), `marketing_role_assignments` (the actual capability-granting model — one active role per user per org, partial unique `WHERE revoked_at IS NULL`).

**Audiences**: `marketing_audiences` — a reusable filter definition (bounded `jsonb`) against one CRM entity type, plus `evaluationMode` (`dynamic` re-queries CRM live on every read; `static` freezes a `snapshotRecordIds`/`snapshotCount`/`snapshotAt` triple). No CRM contact/company/lead/opportunity row is ever copied into a Marketing OS table.

**Campaigns**: `marketing_campaigns` (org-unique `campaignKey`, `objectiveType` + structured `objectiveTargets` jsonb, `status` via an explicit transition map, `primaryAudienceId`, `sourceId` → `crm_sources`, `projectId` → `projects`, `workflowDefinitionId`), `marketing_campaign_audience_links` (secondary audiences, idempotent link).

**Content**: `marketing_content_items` (`currentArtifactId` single-column FK to `agent_artifacts`, `projectTaskId` composite FK to `project_tasks`), `marketing_content_item_artifacts` (immutable version-history join table — every attached draft/revision, never overwritten).

**Playbooks**: `marketing_playbooks` → `marketing_playbook_versions` (draft/published/superseded) → `marketing_playbook_steps` — structurally identical to `sales_playbooks`'s three-table shape.

**Execution**: `marketing_campaign_runs` (partial unique `WHERE status IN ('not_started','in_progress','waiting')` — one active run per campaign) + `marketing_campaign_run_items`.

**Destinations/attribution/budget**: `marketing_campaign_destinations` (unique on `campaignId + utmSource + utmMedium + utmCampaign + utmContent + utmTerm`, with `utmContent`/`utmTerm` defaulting to `""` rather than null so the composite unique behaves correctly), `marketing_attribution_records` (partial unique indexes per `touchType + leadId`, and per `touchType + contactId` only when no lead is set), `marketing_budget_entries` (unique on `campaignId + category`).

**Approvals/projects**: `marketing_approval_links` (typed pointer to a real `agent_approval_requests` row, unique on `approvalRequestId`), `marketing_project_links` (mirrors `crm_project_links`, idempotent insert).

**Deliberately not tables** (derived at read time, per the spec's "avoid tables for derived data" instruction): the content calendar, next-best-actions, the marketing work queue, campaign health, analytics — all pure or near-pure query functions in their respective service files.

Migrations were generated via `drizzle-kit generate` and applied directly via `neon()`'s HTTP client (split on `--> statement-breakpoint`, executed statement-by-statement), with a matching tracking row manually inserted into `drizzle."__drizzle_migrations"` (`sha256` of file content as hash, the journal entry's `when` as `created_at`) — the same workaround established in Module 13 for this environment's lack of a websocket-capable migrator. `npx drizzle-kit check` reports clean after all three migrations.

## Marketing configuration

`getMarketingConfiguration`/`resolveEffectiveMarketingConfiguration`/`upsertMarketingConfiguration` (`configuration.ts`). Fields match the spec exactly: `businessTimezone`, `defaultCurrency`, `defaultCampaignOwnerUserId`, `defaultApprovalPolicy`, `defaultContentPlaybookId`, `staleCampaignThresholdDays`, `attributionWindowDays`, `revision`. A missing config row resolves to safe in-memory defaults rather than throwing, so the rest of Marketing OS works before an admin ever visits Settings — identical shape to Sales OS's own configuration resolution.

## Teams and Marketing OS permissions

Team membership (`teams.ts`) is explicitly operational grouping — a `teamRole` of manager/contributor/viewer describing a person's function within one team, never itself a source of authority. Actual capability comes from `marketing_role_assignments` (`roles.ts`): one active role — `marketing_admin`/`marketing_manager`/`marketing_contributor`/`viewer` — per user per organization, entirely independent of CRM, Brain, Sales OS, Workflow, or Projects roles. Nine capabilities (`marketing_view`, `marketing_create_campaigns`, `marketing_manage_campaigns`, `marketing_manage_content`, `marketing_manage_audiences`, `marketing_manage_budget`, `marketing_approve_content`, `marketing_manage_playbooks`, `marketing_admin`) are derived from the role via a static map in `authz.ts` — no calling code checks `role === "..."` directly. Where an action also touches CRM data (audience evaluation, Sales handoff, analytics), both permission layers must independently pass — Marketing OS never calls a real CRM function on the actor's behalf without that function's own gate running. Full detail in `MODULE_15_MARKETING_AUTHORIZATION_AND_PRIVACY.md`.

## Campaigns

`campaigns.ts`. `createCampaign` requires an org-unique `campaignKey` (`MarketingKeyAlreadyTakenError` on collision). Status moves through an explicit `ALLOWED_TRANSITIONS` map (`draft → planning → ready → active → paused/completed`, `active ⇄ paused`, `paused/completed → archived`, `draft/planning/ready → cancelled`, `cancelled → archived`) via `transitionCampaignStatus`, revision-guarded (CAS against `expectedRevision`) — no code path lets a caller set `status` to an arbitrary value directly. `linkCampaignToProject`/`linkCampaignToWorkflow` set bounded reference columns only; campaign creation never auto-creates a project or workflow execution unless a Workflow explicitly does so.

## Objectives

Structured, not freeform: `objectiveType` is one of `awareness`/`lead_generation`/`engagement`/`event_promotion`/`product_launch`/`customer_nurture`/`retention`/`other`; `objectiveTargets` is a `.strict()`-validated `jsonb` object of optional numeric target fields (e.g. `targetLeads`, `targetQualifiedLeads`). No predictive goal-achievement scoring exists — progress against a target, where displayed, is a plain "current vs. target" read from real CRM/analytics data, never a forecast.

## Audience model and evaluation

`audience-filters.ts` + `audiences.ts`. A safe, in-code filter registry (`REGISTRY`) maps each supported CRM entity type (`contact`/`company`/`lead`/`opportunity`) to a bounded set of real, approved fields and their value types — `compileAudienceFilter` turns a validated, ≤10-condition filter definition into a real drizzle `and(eq/ne/inArray/isNull/isNotNull)` expression, never raw SQL string interpolation; an unrecognized field or malformed operator throws `InvalidAudienceFilterError`, verified directly. `evaluateAudience` is dual-gated — Marketing view authority, then CRM Core's own `requireCrmViewAuthority` — and returns only `{count, recordIds, evaluatedAt, fromSnapshot}`; no CRM contact/company/lead/opportunity row is ever duplicated into a Marketing OS table. `evaluationMode: "static"` freezes a snapshot (`snapshotAudience`) for reproducibility; dynamic audiences re-query CRM live on every read unless `forceLive` is skipped and a snapshot already exists. Audience privacy: only record ids, counts, lifecycle stage, status, source, and the same bounded field set the filter registry exposes are ever surfaced — never full notes, private activity, email bodies, or unlisted custom fields.

## Content model and lifecycle

`content.ts`. Content types: `social_post`/`email_draft`/`landing_page_copy`/`ad_copy`/`blog_outline`/`blog_draft`/`campaign_brief`/`creative_brief`/`script`/`announcement`/`other`. A content item stores references, not bodies — `currentArtifactId` points at an immutable Runtime `agent_artifacts` row; every attached version is additionally recorded in `marketing_content_item_artifacts` via `attachArtifactVersion`, so version history is never lost even as `currentArtifactId` moves forward. Status moves through an explicit `ALLOWED_TRANSITIONS` map (`draft → review → approved → scheduled → published`; `review → rejected → draft`; any pre-`published` status → `archived`) — `submitContentForReview` requires an artifact to already be attached; `applyContentApprovalDecision` requires real `marketing_approval_links`/`agent_approval_requests` rows and Marketing OS's own `marketing_approve_content` capability to approve; **`confirmContentPublished` is the only path to `"published"`** — no code path marks content published merely because an agent generated it or a draft was created, verified directly by a test asserting a direct `draft → published` transition is rejected.

## Content calendar

`calendar.ts`. `getMarketingCalendar` derives events from campaign start/end dates and content `plannedPublishAt` within a requested `[from, to]` window — no separate calendar-event table, no duplicate record of a date that already lives on the campaign or content row.

## Playbooks and campaign runs

Full detail in `MODULE_15_MARKETING_PLAYBOOKS_AND_AGENTS.md`. Summary: `marketing_playbooks` → immutable versioned `marketing_playbook_versions` → bounded structured `marketing_playbook_steps`, structurally identical to Sales OS's own playbook shape. A `marketing_campaign_runs` row tracks **process compliance** against a published playbook version — it never becomes a second campaign-status truth; the campaign entity's own `status` remains the sole lifecycle authority, and `completeCampaignRun` throws `CampaignRequirementsIncompleteError` if any seeded run item is still incomplete.

## Next-best-marketing-action

`next-best-action.ts` — deterministic, never opaque AI scoring. `computeNextBestActionsForUser` maps real signals (campaign health reasons, missing lead source, unlinked workflow on an active campaign, stalled blocked project tasks, pending content approvals, draft-not-submitted content) to one of `MARKETING_NEXT_ACTION_TYPES`, each with a closed reason code, a template-filled explanation, a priority, and bounded `sourceSignals` (ids/enums only). A `marketing_next_action_generated` audit event is recorded on every computation.

## Marketing agents

Full detail in `MODULE_15_MARKETING_PLAYBOOKS_AND_AGENTS.md`. Three narrow agents (Campaign Brief Assistant, Content Draft Assistant, Campaign Summary Assistant), registered through the real Agent Registry lifecycle, driven synchronously through the real Agent Runtime execution lifecycle (`driveThroughToExecuting`), and reachable through Module 14's generic `agent_execution` workflow node — the same registry (`registerAgentTaskHandler`) Sales OS's two agents use, extended with 3 new task types (`marketing_campaign_brief`, `marketing_content_draft`, `marketing_campaign_summary`) added to the client-safe `AGENT_TASK_TYPES` array.

## Content approval

`content.ts`'s `applyContentApprovalDecision` + `agents.ts`'s `requestContentReviewApproval` use the existing Runtime approval system exactly: create a draft artifact → attach to the content item → create a real `agent_approval_requests` row via a fresh agent execution → record a `marketing_approval_links` pointer → on `approveRequest`/`rejectRequest`, move content to `approved`/`rejected` and preserve the full version/decision history. No duplicate approval table, no duplicate decision logic. An agent can only *create* content, never approve its own output — approval requires a human actor via the same `approveRequest` path Runtime already restricts to human decision-makers, verified structurally in the functional test suite.

## Campaign workflows

Three starter templates (`templates.ts`, seeded via the Workflow Engine's own exported `seedTemplate` helper — the same reused-not-reimplemented primitive Sales OS's templates use):

- **Campaign Planning Workflow** — `start` → `human_task` (define objective) → `human_task` (define audience) → `agent_execution` (Campaign Brief Assistant, `marketing_campaign_brief`) → `approval` → `end`.
- **Content Creation Workflow** — `start` → `agent_execution` (Content Draft Assistant, `marketing_content_draft`) → `approval` → `human_task` (schedule) → `end`.
- **Campaign Review Workflow** — `start` → `agent_execution` (Campaign Summary Assistant, `marketing_campaign_summary`) → human review (`human_task`) → `end`.

All three use Module 14's generic `agent_execution` node with `{agentId, agentTaskType}` configuration and `inputMapping` sourcing `campaignId`/`contentItemId`/`briefArtifactId` from `workflow_input` — no hard-coded Marketing agent path exists anywhere in the Workflow Engine itself. Verified end-to-end in the functional test suite: the Campaign Review template genuinely drives a Marketing agent through the generic node and produces a real artifact.

## CRM integration

Campaigns reference CRM sources/audiences/leads/contacts by id only — `sourceId` on `marketing_campaigns`, and typed reference columns elsewhere. Creating a campaign never creates a CRM lead. Marketing OS never bypasses CRM authorization: every function that touches a `crm_*` table calls the real CRM Core function, inheriting that function's own internal gate.

## Sales handoff

`handoff.ts`. `createLeadFromCampaign` calls CRM Core's own real `createLead` (with `sourceId: campaign.sourceId`), then records a `first_touch` attribution row — it never sets `ownerUserId` and never auto-assigns to a rep. **There is no separate "marketing lead" entity** — the CRM lead is the sole canonical record; Sales OS sees the campaign/source/attribution references through CRM exactly as it already sees any other lead. `getCampaignReferenceForLead` reads the attribution back via `listAttributionForLead`. Verified directly: a lead created through this path is indistinguishable, in the `crm_leads` table itself, from one created any other way — only the attribution row carries the marketing provenance.

## Attribution foundation

`attribution.ts`. Deterministic, single-touch-per-type storage — `touchType` (`first_touch`/`last_touch`), a campaign reference, a source reference, `utm_source`/`medium`/`campaign`/`content`/`term`, an optional external click/reference id, `capturedAt`. `first_touch` recording is idempotent (a unique-constraint collision resolves to the existing row, unchanged — the true first touch is never overwritten); `last_touch` recording always deletes-then-inserts, so it always reflects the newest touch. No multi-touch attribution modeling exists. No PII (name/email/phone) is ever placed inside a `marketing_attribution_records` row — verified directly by asserting a lead's real email never appears in its own attribution record after a full handoff flow.

## Landing page / destination foundation

`destinations.ts`. `marketing_campaign_destinations` stores a canonical destination record — an external URL (or an internal future reference), campaign id, active/inactive status, and UTM configuration (`utmSource`/`utmMedium`/`utmCampaign`/`utmContent`/`utmTerm`). No page builder exists in this module, and no landing page is hosted here — this table is purely a typed pointer plus its own UTM identity, enforced unique per campaign.

## Budget foundation

`budget.ts`. `marketing_budget_entries` — a campaign-level planned budget with an optional category, a manually recorded spend amount, a currency, and a `revision` guard on updates. `spendSource` is always `"manual"` in this module — no ad-platform spend sync, no billing/accounting logic. Planned vs. recorded spend are two distinct columns, never conflated.

## Campaign health

`health.ts`. Deterministic states — `healthy` (0 reason codes), `attention` (1–2), `at_risk` (3+) — from a closed reason-code set (`start_date_near_missing_requirements`, `overdue_content`, `pending_approval`, `no_audience`, `no_destination`, `missing_utm`, `budget_missing`, `workflow_stalled`, `campaign_end_passed`, `missing_review`). Never infers marketing performance without real external metrics — a campaign with zero configured audience/destination/UTM/budget is flagged as incomplete, not scored on any imagined performance basis.

## Marketing analytics

`analytics.ts` — operational summaries only, dual-gated with CRM view authority wherever a figure is CRM-derived: campaigns by status, campaigns starting soon, overdue content count, content by status, pending approvals count, audience size, campaign-sourced CRM lead count, qualified leads by campaign, opportunity count by campaign source, won value by campaign source, budget planned vs. recorded spend, workflow execution status counts. **No impressions, reach, clicks, CPC, CTR, or ROAS are fabricated** — those fields simply do not exist anywhere in this module's output until a real channel integration provides them. Not the future org-wide Analytics OS. Full detail in `MODULE_15_MARKETING_ATTRIBUTION_AND_ANALYTICS.md`.

## Projects integration

Campaign ↔ project and content ↔ project-task links are read/write reference pointers (`project-links.ts`, `marketing_project_links`) — no project or task data is duplicated into a Marketing OS table. Campaign creation never automatically creates a project; that remains a Workflow's decision to make, if configured.

## Workflow integration

Bounded snapshots and references only — a workflow node's `inputMapping` pulls `campaignId`/`contentItemId`/`briefArtifactId` at dispatch time; campaign or content **content bodies** are never copied into workflow node configuration.

## Authorization and privacy

Full detail in `MODULE_15_MARKETING_AUTHORIZATION_AND_PRIVACY.md`. Four-tier role model (`marketing_admin`/`marketing_manager`/`marketing_contributor`/`viewer`), independent from Brain and CRM permission layers, with organization owner/admin bootstrap. Any action touching CRM data or launching an agent passes both the Marketing gate and the CRM/Agent-Runtime gate independently — never satisfied by one alone.

## APIs

Thin authenticated routes under `/api/organizations/{organizationId}/marketing/...`, identical shape to CRM's/Sales OS's own routes (`getAuthenticatedUser`, `parseJsonBody`/`parseUuidParam`, `jsonSuccess`/`handleRouteError`). No CRM/Workflow/Projects/Runtime write logic is duplicated in any Marketing route — every canonical mutation still goes through the owning module's own service.

## UI

14 pages under `/app/[organizationSlug]/marketing/...` — dashboard, campaigns (+ detail: lifecycle transitions, agent launch buttons, campaign run + items, content list, destinations, budget), content (+ detail: draft artifact display, approval decision buttons, publishing lifecycle buttons), calendar, audiences, playbooks (+ detail), My Work, budget, analytics, settings, teams. Every page reuses the shared premium UI primitives (`Card`, `Badge`, `PageHeader`, `Table`, `EmptyState`, `FormField`/`SelectField`/`SubmitButton`, `ActionForm`) established by the earlier refinement pass and reused by Sales OS — no parallel UI system. No drag-and-drop anywhere.

## Audit events

30 new event types added to `src/lib/audit.ts`'s `AuditEventType` union (never a new table), under a dedicated "Marketing OS — Module 15" comment block: `marketing_configuration_updated`, `marketing_team_created`, `marketing_team_member_added`, `marketing_permission_granted`/`_revoked`/`_denied`, `marketing_campaign_created`/`_updated`/`_status_changed`/`_archived`, `marketing_audience_created`/`_updated`, `marketing_content_created`/`_updated`/`_submitted_for_review`/`_approved`/`_rejected`/`_published`, `marketing_playbook_created`/`_version_published`, `marketing_campaign_run_started`/`_completed`, `marketing_destination_created`, `marketing_attribution_recorded`, `marketing_budget_updated`, `marketing_agent_task_started`/`_artifact_created`, `marketing_approval_linked`, `marketing_project_linked`, `marketing_next_action_generated`. Metadata is always ids/enums/counts/field-name lists — never CRM PII, content bodies, or audience member data.

## Concurrency results

14 tests in `src/lib/marketing-os/concurrency.integration.test.ts`, all passing against the real database: duplicate campaign keys rejected, campaign-status revision guard (racing transitions — exactly one wins, the other gets `StaleMarketingUpdateError`), stale content-item update rejected, published playbook version immutable, playbook-version-publish revision guard, duplicate active campaign run prevented, idempotent audience-campaign link, duplicate destination-UTM rejected, duplicate approval-link rejected (proven at the DB unique-constraint level), single-use campaign-run completion, budget-entry revision guard, idempotent first-touch attribution (returns the same row, never overwritten), always-upserted last-touch attribution, a racing campaign-status transition (only one caller wins).

## Manual end-to-end result

A 15-step scratch script, mirroring the integration tests' own setup, run against the real database (this environment has no browser automation available): campaign created → objective defined → audience defined and linked → campaign playbook run started → Campaign Planning Workflow driven through two sequential `human_task` nodes to the Campaign Brief Assistant's `agent_execution` node → real artifact produced (`nodeStatus: "succeeded"`) → campaign playbook run completed → content item created → Content Draft Assistant artifact attached → submitted for review → approved → scheduled → destination/UTM recorded → CRM lead created via marketing handoff (with attribution) → Sales/CRM visibility of the campaign/UTM reference confirmed on the canonical CRM lead → Marketing analytics dashboard reflected the real campaign/content/lead counts. Full pass; the throwaway org/user were deleted by the script's own cleanup, spot-verified directly against the database afterward.

## Deferred (explicitly, per spec)

Meta/Google/LinkedIn Ads integrations, email/SMS/WhatsApp sending, social publishing, external analytics ingestion, predictive attribution, ROAS optimization, a landing-page builder, external content scheduling, Kids Coding, Home Renovation Rebates, the global Analytics OS, and the Founder Workspace.

## Update history

## Update (LYNQ Communications & Integrations Core, Module 16, now complete)

The "email/SMS/WhatsApp sending" item this doc's own Deferred list named is now built, as its own separate, canonical Communications OS module — never folded into Marketing OS itself. The one integration point: `communications-os/marketing-integration.ts`'s `createBulkBatchFromApprovedContent` bridges an already-`approved` `email_draft`/`announcement` content item to a bounded Communications OS bulk batch (in `draft` status) — it requires this module's own `getContentItemForUser`/content-approval gate to have already passed, wraps the content's real artifact body as a one-off immediately-published Communications template (no declared variables), and creates nothing that auto-sends: recipient snapshotting, approval, and starting the batch all remain separate, explicit Communications OS steps. This is deliberately NOT full bulk campaign blast orchestration — see `MODULE_16_COMMUNICATIONS_CORE.md`'s own "bulk send foundation" scope note. This module's own service functions, schema, and authorization are entirely unchanged. See `MODULE_16_COMMUNICATIONS_CORE.md`.

## Update (LYNQ Analytics OS, Module 17, now complete)

Analytics OS reads this module's own canonical campaign/content/attribution/budget tables through 7 read-only metrics (`marketing_campaigns_active`, `marketing_content_overdue`, `marketing_campaign_sourced_leads`, `marketing_campaign_qualified_leads`, `marketing_campaign_sourced_won_value`, `marketing_planned_budget`, `marketing_manual_spend`) plus the Marketing campaign-sourced-lead→qualified→opportunity→won funnel — every one independently re-checking this module's own unmodified `requireMarketingViewAuthority`. `marketing_manual_spend` is always returned with `classification: "manual"`, its own description stating no ad-platform integration exists — impressions/clicks/ROAS are simply not implemented as metrics at all, never fabricated. Campaign-sourced-lead/qualified/won-value metrics only ever count a real `marketing_attribution_records` → `crm_leads`/`crm_opportunities` chain — the identical single-touch (first-touch) attribution this module's own Deferred list already scoped, never a multi-touch model layered on top by Analytics OS. This module's own service functions, schema, and authorization are entirely unchanged. See `MODULE_17_ANALYTICS_OS.md` and `MODULE_17_ANALYTICS_METRICS_AND_DIMENSIONS.md`.

## Update (LYNQ Founder Workspace / Executive OS, Module 18, now complete)

The executive Marketing view and the attention engine's own `campaign_starting_with_missing_requirements`/`campaign_at_risk` rules read this module's own canonical `marketing_campaigns`/`marketing_content_items` tables directly (workspace-scoped consistently with Analytics OS's own hardened policy). No impressions/CTR/ROAS are shown anywhere in Founder Workspace, for the same reason this module's own Deferred list already gives: no ad-platform integration exists to source them from. This module's own service functions, schema, and authorization are entirely unchanged. See `MODULE_18_FOUNDER_WORKSPACE.md`.
