# Module 13 — Sales Playbooks & Automation

Companion to `MODULE_13_SALES_OS.md`. Full detail on playbook versioning, qualification/opportunity execution, the next-best-action engine, follow-up sequencing, agent-assisted research, and Workflow Engine integration.

## Playbook model

`src/lib/sales-os/playbooks.ts`. A playbook (`sales_playbooks`) is a stable identity — `name`, `playbookKey`, `playbookType` (`lead_qualification` | `opportunity` | `follow_up`), `lifecycle` (`draft` | `published` | `archived`), `currentPublishedVersionId`. The actual process lives in its versions (`sales_playbook_versions`), which follow the identical draft → published → superseded lifecycle the Workflow Engine's own versions use:

- `createPlaybook` creates the playbook plus an initial draft version 1 in one call.
- `createPlaybookVersion` creates a new draft (optionally cloning steps from a prior version) — never edits a published version in place.
- `addPlaybookStep` requires the target version to still be `draft`; throws `PlaybookVersionImmutableError` otherwise. Verified directly.
- `publishPlaybookVersion` requires at least one step, marks any prior published version `superseded`, sets the playbook's `currentPublishedVersionId`, and is itself revision-guarded (`StaleSalesUpdateError` on a stale `expectedRevision`).

## Step types

A closed nine-value set (`sales_playbook_step_type`), each carrying bounded, structured `jsonb` configuration — never an executable script, template string, or LLM-generated process:

| Step type | Meaning |
|---|---|
| `checklist` | A plain confirm-this item |
| `collect_information` | A field the rep must fill in |
| `crm_activity_required` | A specific CRM activity type must exist |
| `follow_up_required` | A CRM follow-up must be scheduled |
| `workflow` | References a Workflow Engine definition |
| `approval` | A decision requiring an approval request |
| `artifact_required` | A required artifact (e.g. a proposal document) must exist |
| `stage_recommendation` | Recommends — never applies — a CRM opportunity stage move |
| `manual_decision` | A rep's own judgment call, recorded by completing the item |

No code path in this module lets an LLM invent a required step at runtime — steps are always authored explicitly through `addPlaybookStep`, before a version is ever published and run against a real lead/opportunity.

## Lead qualification execution

`src/lib/sales-os/qualification.ts`. `startQualificationRun` resolves the target playbook version (explicit, or the organization's `defaultQualificationPlaybookId`), requires it to be `published`, and seeds one `sales_lead_qualification_items` row per step, all `pending`. Only one non-terminal run (`not_started`/`in_progress`/`waiting`) is allowed per lead at a time — enforced by a partial unique index, surfaced as `DuplicateActiveRunError`.

`completeQualificationItem` marks one item `complete`/`skipped` and recomputes the run's `missingInformation` (the list of still-`pending` **required** steps' keys) — a real, persisted snapshot kept in sync on every item change, not a lazily-computed join every read has to redo.

`qualifyLeadViaRun`/`disqualifyLeadViaRun` are the only two functions that ever move a run to a terminal state, and both do so by calling CRM Core's own `qualifyLead`/`disqualifyLead` first — **the CRM lead's `status` is the sole qualification truth; this run only documents how the decision was reached.** If CRM's own transition/revision guard rejects the call (e.g. the lead was already qualified through the plain CRM UI), the Sales OS run update never happens either — no path exists where the run and the CRM lead can disagree about the outcome.

## Opportunity playbook execution

`src/lib/sales-os/opportunity-playbooks.ts` — structurally identical to qualification execution, but for `sales_opportunity_playbook_runs`/`items` against a CRM opportunity. The one meaningful difference: `currentStepId` tracks the run's position, advancing automatically to the next incomplete step whenever an item completes. A `stage_recommendation` step being marked `complete` means "the rep reviewed the recommendation" — it never itself calls `moveOpportunityStage`; an actual stage change, if the rep takes it, happens through CRM's own opportunity UI/service, entirely separately.

## Next-best-action engine

`src/lib/sales-os/next-best-action.ts` — deterministic by construction, not LLM reasoning. `computeNextBestActionsForUser` gathers a bounded set of real signals for every lead/opportunity a user owns (or, for opportunities, via `computeOpportunityHealthForMany` — reusing `health.ts`'s own signals rather than a second scoring pass) and maps each true condition to exactly one of seven closed action types, each with:

- `actionType` (one of `contact_lead`, `complete_qualification_field`, `schedule_follow_up`, `review_proposal`, `move_opportunity`, `resolve_pending_approval`, `review_stale_opportunity`)
- `recordType`/`recordId` — the exact source record
- `reasonCode` — a closed, stable string
- `explanation` — a template-filled sentence, never freeform generated text
- `priority` — a plain integer used only for sort order
- `dueAt` — real, when the signal has one (e.g. an approval's `expiresAt`)
- `sourceSignals` — the exact bounded data that produced the recommendation, ids/enums only, never PII

Recommendations are sorted by `priority` descending before being returned. A `sales_next_action_generated` audit event is recorded on every computation (bounded metadata: `forUserId`, `count`).

## Follow-up sequences

`src/lib/sales-os/sequences.ts`. A sequence (`sales_follow_up_sequences`) targets either `lead` or `opportunity`; its published version's steps (`sales_follow_up_sequence_steps`) each carry a `dayOffset` (days since enrollment) and one of four bounded action types:

- `crm_follow_up` — calls CRM Core's own `createFollowUp`. Fully real.
- `internal_reminder` — creates no external record at all; its existence in `sales_sequence_step_runs` at its due date is itself the reminder, surfaced through the work queue. Never a fabricated CRM activity.
- `workflow_human_task` — starts the **Follow-Up Sequence Workflow** template (via CRM's own `startWorkflowWithCrmContext`), whose `human_task` node is what actually creates the task. The started execution's id is recorded on the step run.
- `approval_request` — calls `agents.ts`'s `requestOpportunityContinuationApproval`/`requestLeadReviewApproval`, which drives a fresh agent execution to `executing` and calls the real Runtime `requestApproval`.

`enrollInSequence` allows exactly one active enrollment per target (`sales_sequence_enrollments_active_unique`, surfaced as `DuplicateActiveEnrollmentError`). `advanceDueSequences` is the durable advancement sweep:

1. For every enrollment whose `nextStepDueAt` has passed, first re-check the target's **current, live** CRM state via `isEnrollmentTargetStillEligible` — a lead already `qualified`/`disqualified`/`converted`, or an opportunity no longer `status = "open"`, is stopped immediately (`status: "stopped"`, a `sales_sequence_stopped` audit event), regardless of which code path changed that state. This is a deliberate belt-and-suspenders design: it does not rely on every CRM-mutating call site remembering to call `stopActiveEnrollmentsForTarget`.
2. Otherwise, find the next step with no existing `sales_sequence_step_runs` row for this enrollment and execute it. The unique `(enrollmentId, sequenceStepId)` constraint on that table is the entire idempotency guarantee — re-running the sweep (a restart, an overlapping cron tick) after a step has already run is always a no-op for that step, verified directly by calling the sweep twice and asserting exactly one step-run row and one CRM follow-up exist.
3. Advance `nextStepDueAt` to the following step's `dayOffset` from the enrollment's `createdAt`, or mark the enrollment `completed` if there is no next step.

`stopActiveEnrollmentsForTarget` is available for callers that want to stop a sequence proactively (e.g. immediately on qualification, rather than waiting for the next sweep tick) — the sweep's own live-state check is the backstop that makes this optional rather than load-bearing.

## Agent-assisted sales

Full architectural detail in `MODULE_13_SALES_OS.md`'s "Agent-assisted sales" section and `MODULE_13_SALES_AUTHORIZATION.md`'s "Agent CRM access" section. In summary: two agents (Lead Research Assistant, Opportunity Summary Assistant), each driven synchronously through the real Agent Runtime execution lifecycle, reading CRM data only through existing narrow grants, producing a `report` artifact as their sole output. Neither can mutate CRM.

## Workflow Engine integration

`src/lib/sales-os/templates.ts` seeds three starter templates via the Workflow Engine's own `seedTemplate` helper (exported from `src/lib/workflows/templates.ts` for reuse — the identical definition→version→nodes→edges→validate→publish sequence Module 11's Knowledge Report template uses, not a reimplementation):

- **Lead Qualification Workflow** (`LEAD_QUALIFICATION_TEMPLATE`) — `start` → `human_task` ("Complete lead qualification checklist") → `end`.
- **Opportunity Review Workflow** (`OPPORTUNITY_REVIEW_TEMPLATE`) — `start` → `approval` (against the Opportunity Summary Assistant) → `end`.
- **Follow-Up Sequence Workflow** (`FOLLOW_UP_SEQUENCE_TEMPLATE`) — `start` → `human_task` ("Sequence follow-up due") → `end`; this is the real target of `workflow_human_task` sequence steps.

See `MODULE_13_SALES_OS.md`'s contradiction-reconciliation section for why none of these use an `agent_execution` node. All three are started scoped to a specific CRM lead/opportunity via CRM Core's existing `startWorkflowWithCrmContext` — never a bespoke CRM-context-carrying mechanism.
