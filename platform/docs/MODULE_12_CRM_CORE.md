# Module 12 — LYNQ CRM Core

The canonical customer/prospect layer Sales OS, Marketing OS, Projects, Workflows, and Agents build on later — never a second contact/customer model inside any future module. Built directly on the existing organization/workspace tenancy, Projects Core, Workflow Engine, Agent Registry, Agent Runtime, Tool Runtime, background workers, Brain, approvals, artifacts, and audit systems. No Kids Coding, Home Renovation Rebates, Sales OS, Marketing OS, Founder Workspace, or external communications integrations in this module.

> **Built on by Module 13 (Sales OS)**: leads/opportunities/pipelines/follow-ups/activities/notes remain exactly as defined here — Sales OS never duplicates them, only adds an operational layer (assignment, qualification execution, playbooks, sequencing) that calls this module's own service functions for every CRM mutation. See `MODULE_13_SALES_OS.md`.

> **Built on by Module 15 (Marketing OS)**: campaigns/audiences/content reference contacts/companies/leads/opportunities/sources by id only — Marketing OS never duplicates them, and every CRM mutation it triggers (e.g. Sales handoff creating a lead) calls this module's own service functions, inheriting their authorization unchanged. See `MODULE_15_MARKETING_OS.md`.

## Contradiction reconciliation (pre-implementation review)

None found. Reviewed the organization/workspace tenancy model, Projects Core, Workflow Engine, Brain permissions and Agent Read API, Agent Runtime, Tool Runtime, dashboard conventions, audit conventions, and authorization patterns. The spec's own hard distinctions are structurally satisfied rather than merely followed by convention:

- **CRM activities vs. project tasks vs. workflow human tasks vs. agent executions** — four genuinely separate tables (`crm_activities`, `project_tasks`, `workflow_human_tasks`, `agent_executions`), never merged. A CRM `activity_type` enum has no operational-work semantics at all (call/email/meeting/message/note/form_submission/website_event/other) — it cannot represent "do X by Friday," which is exactly what the other three tables exist for.
- **CRM follow-ups vs. project tasks** — `crm_follow_ups` is a new, minimal table (title/assignee/due/status/priority), deliberately not a reuse of `project_tasks`. A follow-up is customer-facing sales/service work; a project task is operational project work — conflating them would make Projects Core's own progress calculations and dependency graph silently absorb sales activity it was never designed to model.
- **CRM agent permissions vs. Brain grants** — `crm_agent_permission_grants` is a wholly separate table with its own 6-value permission enum, checked independently of `brain_permission_grants` everywhere in this module. An agent's Brain domain read access never implies CRM access, verified directly by a test granting Brain `identity` read and confirming CRM reads still fail. See `MODULE_12_CRM_AUTHORIZATION_AND_PRIVACY.md`.

## Files created and modified

**Schema**: `src/db/schema.ts` (appended) — 17 new tables, 15 new enums. Migration: `drizzle/0026_powerful_quicksilver.sql`.

**Services** (`src/lib/crm/`, 17 files): `errors.ts`, `validation.ts`, `authz.ts`, `normalize.ts`, `contacts.ts`, `companies.ts`, `relationships.ts`, `leads.ts`, `pipelines.ts`, `stages.ts`, `opportunities.ts`, `activities.ts`, `notes.ts`, `follow-ups.ts`, `tags.ts`, `custom-fields.ts`, `sources.ts`, `project-links.ts`, `workflow-integration.ts`, `agent-permissions.ts`, `agent-reads.ts`, `search.ts`, plus `test-helpers.ts`.

**Modified existing modules**: `src/lib/audit.ts` (+34 `AuditEventType` values), `src/lib/dashboard/nav-items.ts` (+"CRM" real link).

**APIs**: 24 org-facing route files under `src/app/api/organizations/[organizationId]/crm/...`, 7 agent-facing route files under `src/app/api/agent/crm/...`.

**Dashboard**: `src/lib/dashboard/actions/crm.ts` (~25 server actions); 11 pages under `src/app/app/[organizationSlug]/crm/...`; 21 components under `src/components/dashboard/crm/`.

**Tests**: 6 integration files (66 tests) under `src/lib/crm/`; 6 a11y files (15 tests) under `src/components/dashboard/crm/`.

## Schema and migrations

17 new tables, every one tenant-scoped by a direct `organizationId` FK (`onDelete: cascade`), verified empty after a full test-suite run (see Verification below). Child-of-a-CRM-record tables use the composite `(id, organizationId)` tenant-safe FK pattern this codebase established from Module 6 onward; "soft back-reference" pointer columns (e.g. `crm_leads.convertedOpportunityId`) are single-column FKs, matching the fix Module 11 already established for the same class of composite-FK/`SET NULL` interaction.

Key constraints: `crm_contacts_idempotency_unique`/`crm_companies_idempotency_unique`/`crm_leads_idempotency_unique`/`crm_opportunities_idempotency_unique` (partial unique on `(organizationId, idempotencyKey)` `WHERE idempotencyKey IS NOT NULL`) — the one real, atomic duplicate-prevention guarantee for otherwise-conservative dedup (see Deduplication below); `crm_contact_company_rel_active_unique` (partial unique on `(contactId, companyId, relationshipType)` `WHERE status = 'active'`) and `crm_contact_company_rel_primary_unique` (partial unique on `contactId` `WHERE isPrimary AND status = 'active'`); `crm_pipeline_stages_pipeline_sequence_unique` + gap-based `sequence` (identical mechanism to `project_phases.reorderPhase`); `crm_pipeline_stages_won_lost_exclusive_check` and `crm_pipeline_stages_won_lost_implies_closed_check` (real Postgres `CHECK` constraints — a stage can never be both won and lost, and won/lost always implies closed); `crm_opportunities_lost_reason_check` (`status <> 'lost' OR lost_reason IS NOT NULL`); `crm_pipelines_org_default_unique` (partial unique on `organizationId` `WHERE isDefault`); `crm_tag_assignments_unique`, `crm_project_links_unique`, `crm_agent_permission_grants_active_unique` (partial unique `WHERE revokedAt IS NULL`) — every "duplicate X" requirement in the spec is backed by a real, atomic constraint, not an application-only check.

`crm_companies.domain` deliberately has **no** uniqueness constraint at all, at any scope — two records may legitimately share a parent domain (subsidiaries, franchises); `normalizedDomain` is indexed for search and warning-detection only.

Migration generated via `drizzle-kit generate`, applied via the established scratch-integration-test workaround (`neon-http` has no migration runner), verified against the full schema dump. `npx drizzle-kit check` reports "Everything's fine."

## Contact model

`crm_contacts`: `id, organizationId, workspaceId?, firstName?, lastName?, displayName, primaryEmail?, primaryPhone?, jobTitle?, department?, lifecycleStage, status, ownerUserId?, sourceId?, createdByUserId?, revision, archivedAt?, createdAt, updatedAt`, plus `normalizedPrimaryEmail`/`normalizedPrimaryPhone` (indexed, dedup-detection only). Lifecycle: `subscriber, lead, qualified_lead, opportunity, customer, former_customer, partner, other` — the smallest useful set, never inferred automatically (no code path in this module writes `lifecycleStage` except an explicit caller-supplied value). Email and phone are never required — `createContact` accepts a bare first/last name or even a bare email as the one required "stable identity," verified directly by a test creating a contact with only a first/last name. `status: active | archived` — archival never deletes (`archivedAt` timestamp, excluded from default list queries).

## Company model

`crm_companies`: `id, organizationId, workspaceId?, name, legalName?, domain?, website?, industry?, employeeRange?, annualRevenueRange?, phone?, address? (jsonb), lifecycleStage, status, ownerUserId?, sourceId?, createdByUserId?, revision, archivedAt?, createdAt, updatedAt`. Revenue and employee count are free-text ranges (`employeeRange`/`annualRevenueRange`), never required, never validated against a fixed enum — different organizations describe company size differently, and this module makes no attempt to normalize that. No third-party enrichment integration exists or is called.

## Relationship model

`crm_contact_company_relationships`: many-to-many, `relationshipType` (`employee, owner, decision_maker, billing_contact, technical_contact, advisor, partner_contact, former_employee, other`), `status: active | ended`, `isPrimary`. A contact may belong to multiple companies simultaneously (verified directly). Duplicate **active** relationships of the same type between the same pair are rejected by `crm_contact_company_rel_active_unique`; ending a relationship (`endContactCompanyRelationship`) frees that exact type up for a new relationship, verified directly. At most one active `isPrimary` company per contact, enforced by `crm_contact_company_rel_primary_unique`.

## Lead lifecycle

`crm_leads`: an explicit qualification object, never merely a contact status — `id, organizationId, contactId?, companyId?, ownerUserId?, sourceId?, status, score? (0-100), estimatedValueAmount?, estimatedValueCurrency?, qualificationNotes?, nextAction?, convertedOpportunityId?, createdByUserId?, revision, qualifiedAt?, disqualifiedAt?, convertedAt?, createdAt, updatedAt`.

States: `new, contacted, engaged, qualified, disqualified, converted`. `updateLead` handles general field edits plus the two "soft" in-progress transitions (`new → contacted → engaged`) only; `qualifyLead` (from `new`/`contacted`/`engaged`) and `disqualifyLead` (from any pre-converted state) are their own dedicated, separately-audited operations — qualification is always explicit and auditable, never inferred, and no agent-callable path exists anywhere in this module that could qualify or disqualify a lead. `converted` and `disqualified` are both terminal — verified directly that a converted lead can never be re-qualified or re-disqualified.

## Lead conversion

`convertLead` creates a real `crm_opportunities` row (carrying the lead's `contactId`/`companyId`/`ownerUserId`/estimated value forward) and marks the lead `converted`. **Idempotent by construction**: the opportunity is created with `idempotencyKey: "lead-conversion:${leadId}"`, so repeated conversion calls — including a genuine concurrent race, verified directly with `Promise.allSettled` — always return the same, single opportunity, never a duplicate. Only a `qualified` lead may convert (`LeadNotQualifiedError` otherwise); a call against an already-converted lead short-circuits to the existing linked opportunity without re-running any conversion logic.

## Pipeline/stage model

`crm_pipelines`: `id, organizationId, workspaceId?, name, pipelineKey, description?, status, isDefault, revision, archivedAt?, createdAt, updatedAt`. Pipeline keys unique per organization. Multiple pipelines are fully supported — no hardcoded single sales process. `isDefault` is unique per organization (not per workspace, the smallest useful scope); promoting a new default (`setDefaultPipeline`) is an explicit two-step demote-then-promote operation, safe under a concurrent race specifically because `crm_pipelines_org_default_unique` is the real atomic guarantee — a losing racer's promote attempt simply fails the unique check, verified directly.

`crm_pipeline_stages`: `id, organizationId, pipelineId, name, stageKey, sequence, stageType? (free text), probability?, isClosed, isWon, isLost, revision, createdAt, updatedAt`. Stage keys unique per pipeline; gap-based `sequence` (1000-increments, identical mechanism to `project_phases.reorderPhase` — `reorderStage` moves only the target stage's own sequence to the midpoint of its new neighbors, falling back to a full renumber only when a gap is exhausted). A stage can never be both won and lost (`CHECK`), and won/lost always implies closed (`CHECK`) — both enforced at the database level, not just application-checked. A pipeline must have at least one open (non-closed) stage before it can be used to create new opportunities (`assertPipelineHasOpenStage`, checked at opportunity-creation time — a pipeline mid-setup is allowed to be temporarily empty or all-closed).

## Opportunity lifecycle

`crm_opportunities`: `id, organizationId, workspaceId?, pipelineId, stageId, name, primaryContactId?, companyId?, ownerUserId?, amount? (numeric), currency?, expectedCloseDate?, probabilityOverride?, sourceId?, status, lostReason?, wonAt?, lostAt?, createdByUserId?, revision, archivedAt?, createdAt, updatedAt`. Monetary value is never required. `status` (`open | won | lost`) is **always derived from the stage moved into** — never accepted as a direct input field on create or update, verified directly.

`moveOpportunityStage` refuses to operate on an already-closed opportunity (`OpportunityClosedError`) — a closed opportunity requires the explicit `reopenOpportunity` operation, the one door back to `open`, verified directly (an ordinary move attempt against a won opportunity is rejected; `reopenOpportunity` against an opportunity that's already `open` is rejected with `OpportunityNotClosedError` — "nothing to reopen"). Moving into a won stage sets `status`/`wonAt` atomically in the same revision-guarded `UPDATE`; moving into a lost stage requires an explicit `lostReason` (`LostReasonRequiredError` if omitted, `CHECK`-enforced at the database level too) and sets `status`/`lostAt`/`lostReason` together. A stage's target must belong to the opportunity's own pipeline — structurally enforced by the `crm_opportunities_stage_pipeline_fk` composite FK (`[stageId, pipelineId] → crm_pipeline_stages(id, pipelineId)`), not just app-checked.

## Activity/notes/follow-up model

**Activities** (`crm_activities`): `contactId?, companyId?, leadId?, opportunityId?, activityType, direction?, occurredAt, subject?, summary?, createdByUserId?, agentId?, externalReference?, createdAt` — at least one target required (`CHECK`, and re-checked at the service layer for a friendly error before the raw constraint fires). **Append-only by construction**: `activities.ts` exports exactly `createActivity` and `listActivitiesForUser` — no update or delete function exists anywhere in this module, verified directly by asserting the module's own runtime export list. No real email/call integration exists yet; `externalReference` is the reserved hook for a future integration to store content separately and point at it, never inline.

**Notes** (`crm_notes`): internal only, never exposed through any public/unauthenticated API. Unlike activities, notes are editable (`updateNote`, revision-guarded) and archivable (`archiveNote`) — verified directly. Note content is never copied into audit metadata (only the note's id/target are recorded).

**Follow-ups** (`crm_follow_ups`): `title, dueAt?, status (open/completed/cancelled), priority, completedAt?, assignedUserId, createdByUserId?, revision` — deliberately a new, minimal table, never a reuse of `project_tasks` or `workflow_human_tasks` (see Contradiction reconciliation above). `completeFollowUp`/`cancelFollowUp` are two distinct terminal transitions from `open`; both verified directly, including that a second transition attempt against an already-terminal follow-up is rejected (`InvalidCrmTransitionError`).

## Tags/custom fields

**Tags** (`crm_tags`/`crm_tag_assignments`): organization-scoped, never created or assignable across tenants — verified directly that another org's tag cannot be assigned to a record in this org (rejected as a tenant-scoped foreign-key violation, since the tag row itself is invisible cross-tenant). Duplicate active assignments rejected by `crm_tag_assignments_unique`; unassigning (a real row delete) frees the pair for reassignment.

**Custom fields** (`crm_custom_field_definitions`/`crm_custom_field_values`): a safe foundation, deliberately **not** a dynamic schema engine. `fieldType` is a fixed, closed list (`short_text, long_text, number, boolean, date, datetime, single_select, multi_select`); `validationRules` is bounded metadata only (`minLength/maxLength/min/max/pattern`), enforced by a `.strict()` zod shape at the route boundary — no field anywhere can hold code, SQL, or a formula. `validateCustomFieldValue` is a pure function checked server-side before every write, verified directly for both numeric range violations and `single_select`-outside-declared-options violations. Custom fields can never replace or override a core identity/tenant field — there is no code path that reads a custom field value in place of `organizationId`, `id`, or any other structural column.

## Source attribution

`crm_sources`: organization-scoped source definitions (`sourceKey, name, sourceType, description?, isActive`), seeded with the fixed built-in list (`manual, website, referral, event, paid_search, organic_search, social, partner, import, api`) via `seedBuiltInSources` (idempotent by `sourceKey`, safe to call repeatedly). Contacts/companies/leads/opportunities each carry an optional `sourceId` FK, preserving the *original* source at creation time. No Marketing attribution modeling (multi-touch, campaign weighting) exists — this module simply preserves trustworthy source data for a future module to build on.

## Ownership

`ownerUserId` on contacts/companies/leads/opportunities is a label only — it never grants permission (verified directly: an ordinary org member cannot edit a contact merely because they're its owner; CRM manage-authority is checked independently of ownership everywhere in this module). Every owner assignment validates the target is an eligible organization member (and, for a workspace-scoped record, a member of that workspace too) before the write — `validateOwner`, called from every create/update path that accepts `ownerUserId`. Agents are never stored in an owner column — every owner FK references `users.id`, not `agents.id`; agent responsibility, if it's ever needed, would require a separate agent-assignment relationship this module does not implement.

## Search

`src/lib/crm/search.ts` — deterministic keyword/exact-filter search only, no semantic/vector search (explicitly deferred). Every query scopes by `organizationId` first, before any other condition — verified directly that a search in one org never returns another org's records regardless of query content. Contacts search by name (`ILIKE`) or exact normalized email/phone; companies by name or domain substring; leads/opportunities by status/owner/contact/company filters plus (for opportunities) a name substring. Bounded `limit`/`offset` pagination on every query (default 20, max 100).

## Deduplication

Conservative by design — normalized exact email/phone (contacts) and normalized domain (companies) are **warning signals only**, never automatic merges (verified directly: a second contact sharing a normalized email is created successfully, with a `duplicateWarnings` array in the response). The one real, atomic duplicate-prevention mechanism is `idempotencyKey` — a partial unique index per entity type, with the create path catching a concurrent-race unique violation and returning the winning row as a replay rather than surfacing a raw constraint error (a real bug found and fixed during this module's own concurrency testing — see the final report). Full merge functionality is explicitly deferred; this module only prevents *obvious duplicate submissions* via idempotency, exactly as scoped.

## Projects integration

See `MODULE_12_CRM_WORKFLOW_AND_PROJECT_INTEGRATION.md`.

## Workflow integration

See `MODULE_12_CRM_WORKFLOW_AND_PROJECT_INTEGRATION.md`.

## Agent CRM permission model

See `MODULE_12_CRM_AUTHORIZATION_AND_PRIVACY.md`.

## APIs

24 org-facing routes under `/api/organizations/{organizationId}/crm/...` (contacts, companies, leads + qualify/disqualify/convert, pipelines + stages, opportunities + move/reopen, activities, notes, follow-ups + complete/cancel, search, tags + assignments, sources, relationships, project-links, agent-permissions + revoke, custom-fields + values) and 7 agent-facing routes under `/api/agent/crm/...` (contacts, contacts/{id}, companies, companies/{id}, leads, opportunities, activities, notes), all following this codebase's established `parseUuidParam`/`.strict()` Zod/`getAuthenticatedUser` (or `authenticateAgentFromHeader`)/`jsonSuccess`/`handleRouteError` pattern. Route handlers are thin.

## UI and accessibility

11 pages under `/app/[organizationSlug]/crm/...`: overview (`/crm`), contacts list/detail, companies list/detail, leads list/detail, opportunities list/detail, pipelines (structured stage list + stage editing, deliberately not a drag-and-drop Kanban board), settings (tags/sources/agent grants). CRM overview shows real counts only (contacts, companies, open leads, open opportunities), open follow-ups due, and a pipeline summary — no fake metrics anywhere; a zero-record organization shows explicit empty states ("No contacts yet," "No pipelines yet").

21 components, all typechecked/linted clean. 6 dedicated `.a11y.test.tsx` files (15 tests) cover the genuinely novel interactive patterns: `LeadQualificationControls` (status-gated qualify/disqualify/convert), `OpportunityStageControls` (open-vs-closed move/reopen gating), `CreateContactForm` (optional-identity validation), `CreateOpportunityForm` (pipeline-driven stage selection), `FollowUpRow`, `NoteCard` — every one passes with zero axe violations. Destructive/state-changing actions (archive contact/company) use the existing `ConfirmDialog` component unmodified.

## Audit events

34 new `AuditEventType` values (30 from the spec's exact list plus 4 structurally necessary additions — `crm_note_updated`, `crm_note_archived`, `crm_follow_up_cancelled`, `crm_tag_unassigned`, `crm_custom_field_value_set`, `crm_workflow_execution_started`, `crm_permission_denied` — matching every prior module's own precedent of adding the denial/completion events its own authorization and lifecycle model structurally requires). Every one carries bounded metadata (ids, enum values, field-name lists) — never PII, note content, or custom field values; verified directly by a test asserting an org's full audit log never contains a contact's email, phone, or a note's content string.

## Tests

66 integration tests across 6 files (`contacts-companies`, `leads`, `pipelines-opportunities`, `history-and-config`, `agent-access-and-pii`, `concurrency`) plus 15 a11y tests across 6 files — covering every required scenario from the module spec, including a real bug found and fixed by the concurrency tests themselves (see the final report's Bugs discovered section).

## Verification

- `npm run typecheck` — clean.
- `npm run lint` — clean (0 errors, 0 warnings).
- `npm test` (unit) — 196/196 passing, no regressions (this module added no unit-tier logic — everything is integration-tested against the real database).
- `npm run test:integration` — see final report for the full-suite count including this module's 66 new tests.
- `npm run test:a11y` — 103/103 passing (30 files), up from 88/24, zero regressions.
- `npx drizzle-kit check` — "Everything's fine."
- `npm run build` — production build succeeds; all 31 new API routes and 11 new pages compile and appear in the route manifest.
- Direct Postgres verification: all 17 `crm_*` tables confirmed empty after a full test-suite run.
- Manual end-to-end verification: see the final report.

## Deferred (explicitly, per this module's own scope)

Sales OS, Marketing OS, Kids Coding, Home Renovation Rebates, Founder Workspace, external communications integrations (email/call/SMS sync), CSV import UI (the batch-import contract is documented and the service layer already supports it — see below), third-party enrichment, full duplicate-merge functionality, multi-touch marketing attribution modeling, semantic/vector search, a dedicated custom-field-definition builder UI (managed via the API for now), CRM automation triggers from workflows, automatic project creation from a won opportunity, automatic lead scoring.

### Future batch import contract

`createContact`/`createCompany`/`createLead`/`createOpportunity` already support everything a future batch importer needs without any service-layer change: an `idempotencyKey` per input row (so a retried or duplicate-submitted import batch never creates duplicate records — the same partial-unique-index guarantee this module's own concurrency tests exercise), a `sourceId` for attribution (an importer would create or reuse a `source` with `sourceType: "import"`), structured validation errors per record (every create function throws a typed `DomainRuleViolationError` subclass with a `reason` code, ready to be collected per-row by a future batch wrapper rather than aborting the whole batch), duplicate warnings returned inline (`duplicateWarnings` on the contact/company create result, ready to surface per-row without blocking import), bounded audit metadata (never row content), and actor attribution (`actorUserId`, always required). A future CSV import UI would be a thin wrapper: parse rows, call the existing create functions in a loop with a deterministic per-row `idempotencyKey` (e.g. `import:{batchId}:{rowNumber}`), and collect the per-row result/error — no new service-layer capability required.

## Update (LYNQ Marketing OS Core, Module 15, now complete)

Marketing OS references this module's own data by id only, never duplicating it: campaigns reference a `crm_sources` row via `sourceId`; audiences compile a bounded, safe filter registry (never raw SQL) against a fixed set of approved contact/company/lead/opportunity fields and evaluate it live against these tables through `requireCrmViewAuthority` — the identical CRM authorization gate every other caller of this module already goes through, composed with Marketing OS's own independent permission layer, never substituted for it. Sales handoff (`createLeadFromCampaign`, Marketing OS's own module) calls this module's completely unmodified `createLead`, so a marketing-originated lead is, at the database level, indistinguishable from a lead created any other way — its campaign/source/UTM provenance lives entirely in a separate Marketing OS attribution record, not in `crm_leads` itself. **The "multi-touch marketing attribution modeling" item this doc's own Deferred list named is intentionally still not built** — Module 15 ships only single-touch (first-touch/last-touch) attribution, explicitly scoped that way. This module's own service functions, schema, and authorization are entirely unchanged. See `MODULE_15_MARKETING_OS.md` and `MODULE_15_MARKETING_ATTRIBUTION_AND_ANALYTICS.md`.

## Update (LYNQ Communications & Integrations Core, Module 16, now complete)

The "external communications integrations (email/call/SMS sync)" item this doc's own Deferred list named above is now built, as its own separate, canonical Communications OS module — never folded into CRM Core itself. Communications OS creates a real `crm_activities` row through this module's completely unmodified `createActivity` exactly twice per message: once when a real outbound send is confirmed accepted by a provider, once when a real inbound message is received — never at draft time, never with the message body duplicated into the activity's `summary` (a bare `communication_message:{id}` external reference instead). Identity resolution (email/phone → contact) reuses this module's own `normalizeEmail`/`normalizePhone` (`crm/normalize.ts`) directly, and is conservative in the same spirit this module's own duplicate-detection already is: an ambiguous match (more than one active contact shares an identity) resolves to nothing rather than guessing, and no contact is ever auto-created or auto-merged. This module's own service functions, schema, and authorization are entirely unchanged. See `MODULE_16_COMMUNICATIONS_CORE.md` and `MODULE_16_COMMUNICATIONS_DELIVERY_AND_RECOVERY.md`.

## Update (LYNQ Analytics OS, Module 17, now complete)

Analytics OS reads this module's own canonical tables (`crm_contacts`, `crm_leads`, `crm_opportunities`, `crm_follow_ups`) by reference only — 8 read-only metrics (`crm_contacts_total`, `crm_leads_open`, `crm_leads_qualified`, `crm_opportunities_open`, `crm_opportunities_won`, `crm_pipeline_value`, `crm_won_value`, `crm_followups_overdue`), plus the CRM lead→qualified→opportunity→won funnel. Every metric independently re-checks this module's own unmodified `requireCrmViewAuthority` before ever running a query — the Analytics-side `analytics_view_crm` capability never substitutes for it. No CRM contact email/phone/note is ever exposed through a general Analytics endpoint; a drill-down into an overdue follow-up returns bounded ids only, never the follow-up's own content. Sales weighted pipeline (computed in Sales OS's own analytics metrics, joining through this module's `crm_opportunities`) is always labeled `estimated`. This module's own service functions, schema, and authorization are entirely unchanged. See `MODULE_17_ANALYTICS_OS.md` and `MODULE_17_ANALYTICS_AUTHORIZATION_AND_PRIVACY.md`.
