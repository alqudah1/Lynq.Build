# Module 15 — Marketing Playbooks & Agents

Companion to `MODULE_15_MARKETING_OS.md`. Full detail on playbook versioning, campaign-run process compliance, the three Marketing agents, content approval, and Workflow Engine integration via Module 14's generic `agent_execution` node.

## Playbook model

`src/lib/marketing-os/playbooks.ts` — structurally identical to `sales-os/playbooks.ts`'s three-table shape. A playbook (`marketing_playbooks`) is a stable identity — `name`, `playbookKey`, `playbookType` (`campaign`/`content_creation`/`campaign_review`/`launch`/`nurture`), `lifecycle` (`draft`/`published`/`archived`), `currentPublishedVersionId`. The actual process lives in its versions (`marketing_playbook_versions`), following the identical draft → published → superseded lifecycle the Workflow Engine's own versions use:

- `createPlaybook` creates the playbook plus an initial draft version 1 in one call.
- `addPlaybookStep` requires the target version to still be `draft`; throws `PlaybookVersionImmutableError` otherwise. Verified directly.
- `publishPlaybookVersion` requires at least one step, marks any prior published version `superseded`, sets the playbook's `currentPublishedVersionId`, and is itself revision-guarded (`StaleMarketingUpdateError` on a stale `expectedRevision`).

No executable code or unrestricted prompt is ever stored in a playbook step — configuration is bounded, structured `jsonb`, authored explicitly before a version is ever published and run against a real campaign.

## Campaign runs — process compliance, not a second status truth

`src/lib/marketing-os/campaign-runs.ts`. `startCampaignRun` resolves the target published playbook version (explicit, or the organization's `defaultContentPlaybookId`), requires it to be `published` (`PlaybookNotPublishedError` otherwise), and seeds one `marketing_campaign_run_items` row per step, all `pending`. Only one non-terminal run (`not_started`/`in_progress`/`waiting`) is allowed per campaign at a time — enforced by a partial unique index, surfaced as `DuplicateActiveRunError`.

`completeCampaignRunItem` marks one item `complete`/`skipped` and recomputes the run's `missingRequirements` (`refreshMissingRequirements`) — the still-pending required steps' keys, kept in sync on every item change. `completeCampaignRun` throws `CampaignRequirementsIncompleteError` if `missingRequirements.length > 0` — verified directly by attempting completion with an incomplete item still pending and asserting rejection, then completing that item and succeeding.

**The campaign entity remains canonical for campaign lifecycle** — `marketing_campaigns.status` is the sole authority on whether a campaign is draft/planning/ready/active/etc. `marketing_campaign_runs.status` tracks something different entirely: whether the *process* a playbook prescribes has been completed for this campaign. No function in `campaign-runs.ts` ever writes to `marketing_campaigns.status`, and no function in `campaigns.ts` ever reads campaign-run state to decide a transition. `linkCampaignRunToWorkflowExecution` records a bounded reference to a driving workflow execution, if one exists, without conflating the two lifecycles.

## The three Marketing agents

`src/lib/marketing-os/agents.ts`. All three are registered through the real Agent Registry lifecycle (`idea → ... → deployment`, permission raised back to `assistant` as an explicit step) and driven synchronously through the real Agent Runtime execution lifecycle (`driveThroughToExecuting` — `createExecution → assignExecution → startExecution → advanceExecution(planning/reasoning/executing)`, the same helper pattern Sales OS's two agents use, in one call rather than through the Runtime job queue).

**Campaign Brief Assistant** (`marketing_campaign_brief`, `createCampaignBriefTask`):
- **May**: read campaign fields, read audience metadata (count/filter definition/entity type — never member-level CRM detail), read relevant Brain knowledge, create a `report` artifact (the brief).
- **May not**: activate the campaign, modify any CRM record, publish content, contact customers.

**Content Draft Assistant** (`marketing_content_draft`, `createContentDraftTask`):
- **May**: read the linked campaign brief artifact and relevant Brain knowledge, create a draft artifact via `attachArtifactVersion`, identify and flag missing information needed to complete the draft.
- **May not**: publish content, approve its own (or any) content — `requestContentReviewApproval` routes decision authority to a human via the real Runtime approval flow, never to the drafting agent itself.
- Produces a deterministic, **structural** draft outline (sections, prompts, placeholders) — never generative "creative" ad copy invented wholesale, keeping the agent's output auditable and its scope narrow.

**Campaign Summary Assistant** (`marketing_campaign_summary`, `createCampaignSummaryTask`):
- **May**: summarize real, already-computed operational data — campaign status, content counts by status, campaign-run/approval state, budget planned vs. recorded spend (dynamically importing `content.ts`/`campaign-runs.ts`/`budget.ts` to avoid a circular import with `agents.ts`) — create a `report` artifact, explicitly highlight missing data or unresolved tasks.
- **May not**: claim performance where no real channel metrics exist — the summary explicitly states that no channel metrics (impressions/clicks/etc.) are available yet rather than omitting the topic silently, so a reader is never left to assume performance data exists when it doesn't.

## Agent permissions — explicit, default deny

No Marketing OS role — not even `marketing_admin` — grants any agent execution authority by itself. An unseeded organization (the 3 agents never registered) rejects every attempt to launch a Marketing agent task, verified directly. Where a future Marketing agent needs individual CRM record access, it would use Module 12's existing `crm_agent_permission_grants` mechanism, exactly as Sales OS's two agents already do — none of the three agents built in this module need that, since all three operate on already-aggregated Marketing OS/campaign-level data or bounded audience metadata.

## Content approval — the existing Runtime system, exactly

No duplicate approval table, no duplicate decision logic. The flow for every piece of content:

1. An agent (or a human) creates a draft artifact and attaches it via `attachArtifactVersion`.
2. `submitContentForReview` (requires `currentArtifactId` set) moves content to `review`.
3. `requestContentReviewApproval` drives a fresh Content Draft Assistant execution to `executing` and calls the real Runtime `requestApproval`, then records a `marketing_approval_links` row (unique on `approvalRequestId` — never a duplicate link).
4. A human decides via the same `approveRequest`/`rejectRequest` Runtime primitives every other approval in this codebase uses — Runtime restricts these to human actors structurally, so an agent cannot approve its own output; this is proven by construction, not by an extra Marketing-OS-side check.
5. `applyContentApprovalDecision` reads the real decision back and moves content to `approved` (requiring the deciding user to additionally hold `marketing_approve_content`) or `rejected`, preserving the full version history in `marketing_content_item_artifacts` regardless of outcome.

## Workflow Engine integration — the generic `agent_execution` node, no hard-coded path

`src/lib/marketing-os/templates.ts` seeds three starter templates via the Workflow Engine's own `seedTemplate` helper (the identical definition → version → nodes → edges → validate → publish sequence every other module's starter templates use):

- **Campaign Planning Workflow** (`CAMPAIGN_PLANNING_TEMPLATE_KEY`) — `start` → `human_task` (define objective) → `human_task` (define audience) → `agent_execution` (Campaign Brief Assistant, `agentTaskType: "marketing_campaign_brief"`) → `approval` → `end`.
- **Content Creation Workflow** (`CONTENT_CREATION_TEMPLATE_KEY`) — `start` → `agent_execution` (Content Draft Assistant, `agentTaskType: "marketing_content_draft"`) → `approval` → `human_task` (schedule) → `end`.
- **Campaign Review Workflow** (`CAMPAIGN_REVIEW_TEMPLATE_KEY`) — `start` → `agent_execution` (Campaign Summary Assistant, `agentTaskType: "marketing_campaign_summary"`) → `human_task` (human review) → `end`.

Unlike Sales OS's three starter templates (which predate Module 14's fix to the Workflow Engine's `agent_execution` node and were deliberately left using only `human_task`/`approval`, out of Module 13's scope), Marketing OS's templates use `agent_execution` nodes directly — the contradiction that forced Sales OS's workaround no longer exists by the time this module was built. Each `agent_execution` node's `configuration` is `{agentId, agentTaskType}` and its `inputMapping` sources `campaignId`/`contentItemId`/`briefArtifactId` from `workflow_input` — exactly Module 14's generic contract, with no Marketing-specific branch anywhere in `engine.ts`.

**Verified end-to-end** (`functional.integration.test.ts`): the Campaign Review template is seeded, started with a real campaign in workflow input, driven through the engine's normal dispatch/continuation cycle, and the resulting `agent_execution` node produces a real Runtime artifact (`nodeStatus: "succeeded"`, a genuine `reportArtifactId`) — proving the generic node genuinely dispatches to a Marketing agent rather than silently falling back to Knowledge-Analyst-shaped logic (the exact failure mode Module 14 fixed for Sales OS's agents).

Also verified in the manual end-to-end script: the Campaign Planning Workflow's two sequential `human_task` nodes must both be completed — each completion only creates the *next* task after the workflow re-drives — before the workflow reaches the `agent_execution` node; a single-round task-completion loop is insufficient and must repeat until no pending tasks remain or a terminal/approval-waiting state is reached.
