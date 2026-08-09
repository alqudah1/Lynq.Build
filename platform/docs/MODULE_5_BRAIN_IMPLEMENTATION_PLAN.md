# Module 5 — Brain Implementation Plan

**Status: engineering roadmap only. No implementation code, migrations, schema changes, or packages exist yet as a result of this document. `MODULE_2_AUTH_AND_TENANCY_DESIGN.md`, `MODULE_3_BRAIN_ARCHITECTURE.md`, `MODULE_3_BRAIN_GRAPH_AND_REASONING.md`, and `MODULE_4_AGENT_RUNTIME_ARCHITECTURE.md` are not modified.**

Modules 2–4 designed *what* the Brain is, how reasoning works on top of it, and how agents will eventually execute against it. This document is the bridge from that architecture to actual engineering: twenty independently buildable, testable, and deployable modules that together implement the storage and access layers Module 3 defined, plus the specific reasoning-adjacent surfaces (retrieval, citation, agent read/draft APIs) Module 3.1 anticipated. **Module 4's agent runtime is out of scope here** — this plan builds the Brain the runtime will eventually execute against, not the runtime itself.

**Update — Module 4's runtime is now built.** Once #7 (Permissions), #16 (Agent Read API), and #17 (Agent Attribution) below shipped, the Agent Registry (`MODULE_6_AGENT_REGISTRY.md`) and Agent Runtime Core (`MODULE_7_AGENT_RUNTIME_CORE.md`) were implemented on top of this Brain — a durable, permission-aware execution state machine (queued → assigned → gathering_context → planning → reasoning → executing → verifying → completed → archived, plus waiting/delegating/human_approval/paused) that reads the Brain and creates Brain drafts through exactly the #16/#17 interfaces this plan anticipated, never a parallel access path. Foundation only: no LLM provider, no external tools, no workflow engine yet.

**Update — Tool Runtime Foundation (`MODULE_8_TOOL_RUNTIME_FOUNDATION.md`) and the first working agent (`MODULE_8_FIRST_WORKING_AGENT.md`) are now built** on top of the runtime above. (Note the numbering collision: this plan's own "#7"/"#16"/"#17" above refer to Brain sub-modules — Permissions, Agent Read API, Agent Attribution — not the platform-level Module 7/8 filenames, which are a separate, later numbering track for the Agent Runtime and everything built on it.) A real gap surfaced here: this plan's #16 never specified a search endpoint for agents, only list/get/versions/relationships/context — closed by extending `src/lib/brain/search.ts`'s existing human search with a `searchKnowledgeItemsForAgent` sibling, the same shared-core pattern this plan's own #7/#16/#17 already established, not a new search implementation. The first working agent — a deterministic "Company Knowledge Analyst" — proves the full stack end to end: real Brain grants (#7), real citation-ready retrieval (#16), real attributed artifact creation (patterned on #17), all driven through the real Runtime's own completion-evidence gate, with an LLM nowhere in the path.

**Update — Runtime Recovery, Reconciliation, and Background Worker Foundation (`MODULE_9_RUNTIME_RECOVERY_AND_WORKERS.md`) is now built.** A durable Postgres-backed job queue and worker (no external queue provider — `SKIP LOCKED` proved fully sufficient at this scale) close the last gap the runtime layer above depended on but never implemented: recovery after a crashed process, a stuck tool invocation, or an interrupted execution. This is infrastructure underneath the Agent Runtime and Tool Runtime, not a change to this plan's own Brain modules — every Brain grant/read/write path (#7/#16/#17) this plan defined is called by the worker exactly as already documented, never bypassed or duplicated.

---

## Goals

- Every module below is buildable, testable, and deployable **on its own** — no module requires a later one to already exist to be shippable and correct.
- Every module preserves production stability: additive schema only (new tables, never altered or renamed existing ones — including Module 2's own tables, which this plan never touches), new routes that are unused/unlinked until explicitly wired in, and a clear rollback path.
- The order below is a dependency order, not an arbitrary checklist — each module's own section states what it needs already built and what it unlocks next.

---

## Engineering conventions this plan follows

Stated once here rather than repeated in every module section. This plan deliberately reuses the exact patterns Module 2's already-shipped implementation established in this codebase, rather than introducing new ones:

- **Schema**: additive-only changes to `src/db/schema.ts` — new tables, new columns with safe defaults, never a destructive change to an existing table. Every table gets `deletedAt`/soft-delete or an equivalent lifecycle-state column where the architecture calls for it (Module 3 never truly deletes except the single narrow Purge case).
- **Domain services**: `src/lib/brain/*.ts`, one file per concern, mirroring the existing `src/lib/organizations/`, `src/lib/workspaces/`, `src/lib/invitations/` structure — each function independently re-verifies authorization via the shared `requireXxx` helpers (Module 2 §14's existing API Contract Principles), never trusting a caller's claimed identity or role.
- **Authorization**: extends, never replaces, the existing chain in `src/lib/authz/helpers.ts` (`requireOrganizationMembership`, `requireTenantScopedResource`, etc.) with Brain-specific helpers in `src/lib/brain/authz.ts` — the "fourth, independent gate" Module 2 §12 already promised.
- **HTTP routes**: tenant-scoped under `src/app/api/organizations/[organizationId]/brain/...`, matching the existing route-nesting convention exactly (Module 2 §14).
- **Dashboard UI**: `src/app/app/[organizationSlug]/brain/...`, matching the existing `/app/{org}/invitations`-style convention from the platform's already-shipped admin UI.
- **Server actions**: `src/lib/dashboard/actions/brain-*.ts`, following the existing `ActionResult`/`toActionResult` pattern already established.
- **Audit**: extends the existing `audit_logs` table and `recordAuditEvent` helper with new, free-text `event_type` values — never a parallel audit mechanism (Module 3 §11's explicit design decision).
- **Tests**: the existing three-tier suite — `*.test.ts` (unit, no DB), `*.integration.test.ts` (real Neon database, via `vitest.integration.config.mts`), `*.a11y.test.tsx` (jsdom + `jest-axe`, via `vitest.a11y.config.mts`) — every module ships with tests in whichever tiers apply to it.
- **Migrations**: `drizzle-kit` generated migrations, one per module, additive only — rollback for a module with no shipped dependents is "don't apply/revert the migration and stop linking its routes"; rollback for a module with dependents is scoped explicitly per-module below, since it stops being trivial once other modules read its tables.

---

## Implementation Order Overview

| # | Module | Depends on | Primarily unlocks |
|---|---|---|---|
| 1 | Core Knowledge storage | Module 2 (org/workspace) | Everything |
| 2 | Version history | 1 | Trust, Sources, Citation, Timeline |
| 3 | Relationships | 1 | Observation, Decision, Retrieval, Execution Graph (Module 4, later) |
| 4 | Trust model (+ Evidence) | 2 | Citation, Confidence, Retrieval ranking |
| 5 | Sources | 2 | Trust conflict resolution, Citation |
| 6 | Domains (management) | 1 | Permissions, Draft workflow |
| 7 | Permissions | 6, Module 2 | Every write path from here on |
| 8 | Draft workflow | 7 | Review/Approval, Agent draft API |
| 9 | Review / approval | 8 | Published knowledge, Decision tracking |
| 10 | Search interface (keyword only) | 1, 7 | Retrieval layer |
| 11 | Retrieval layer | 3, 4, 5, 7, 10 | Citation, Agent read API |
| 12 | Citation generation | 4, 5, 11 | Agent read API |
| 13 | Observation generation | 3, 8 | Decision tracking (as evidence) |
| 14 | Decision tracking | 3, 4, 9 | Human editing interface |
| 15 | Audit integration | 1–9 | Timeline interface, all later observability |
| 16 | Agent read API | 11, 12, 15 | Module 4's Reasoning state |
| 17 | Agent draft API | 8, 15, 16 | Module 4's agent-authored Artifacts/Observations |
| 18 | Human editing interface | 6, 7, 8, 9, 14 | Timeline interface |
| 19 | Timeline / history interface | 2, 15, 18 | — (leaf) |
| 20 | Future embedding integration (interface only) | 1, 3 | A later, separately-approved search module |

---

## 1. Core Knowledge Storage — ✅ COMPLETE

**Implemented, hardened, and verified. Full detail: `MODULE_5_BRAIN_MODULE_1_CORE_STORAGE.md`.** Two deliberate, reported narrowings from this section's original sketch: no `KnowledgeCategory` table shipped in Module 1 after all (deferred whole to Module 6, addable as a purely additive `category_id` column later); and a minimal two-state (`draft`/`archived`) lifecycle shipped now rather than waiting for Modules 8/9, since the implementation task's own explicit required scope called for it. Neither is a security or architectural contradiction — both are documented in the Module 1 doc's own "Deviations" section. `KnowledgeVersion` was **not** built — Module 1 stores content directly on the item row, protected by a lightweight `revision` optimistic-concurrency counter instead; real immutable version history remains Module 2's job, unstarted.

**Post-approval hardening pass**: a conditional-approval review correctly identified that the original temporary authorization policy let an organization owner/admin update/archive a workspace-scoped item without workspace membership, even though reading the same item correctly required it. Fixed by making organization role irrelevant to every workspace-scoped action (create/read/update/archive alike), not just reads. In the same pass: a database-level CHECK constraint was added for `classification` (previously application-validated only), and archived-item/audit-metadata behavior was confirmed by direct tests rather than left implicit. See the Module 1 doc's own "Hardening pass" section for the full write-up; no table was added, and the only schema change was one additive `ALTER TABLE ... ADD CONSTRAINT`.

**Purpose**: the atomic unit everything else attaches to — `KnowledgeDomain`, `KnowledgeCategory`, `KnowledgeItem`, and a minimal `KnowledgeVersion` (single current version only, no history yet — Module 3's own recommended step 1). An item without this exists nowhere.

**Why this order**: nothing else in the Brain can exist without an addressable item to attach to. Domains/Categories ship here only as **schema with a fixed, seeded set of rows** (LYNQ's 8 domains, seeded via migration data) — no management UI or API yet; real domain/category *management* is deliberately deferred to Module 6, once Trust/Sources exist to make that management meaningful.

**Depends on**: Module 2's `organizations`/`workspaces` tables (referenced, never altered).

**Enables**: literally every module below.

**Can be deferred**: full version history (→ #2), any trust/evidence, relationships, permissions beyond "must belong to an organization," and all UI.

**Files likely required**:
- `src/db/schema.ts` — add `knowledgeDomains`, `knowledgeCategories`, `knowledgeItems`, `knowledgeVersions` tables.
- `src/lib/brain/domains.ts`, `src/lib/brain/categories.ts` — minimal read-only accessors (seeded data only).
- `src/lib/brain/items.ts`, `src/lib/brain/versions.ts` — create item + its first version, read by id.
- `drizzle/` — migration + seed data for the 8 domains.

**Database entities**: `KnowledgeDomain`, `KnowledgeCategory`, `KnowledgeItem`, `KnowledgeVersion` (Module 3 §13, entities 1–4).

**APIs required**: none public yet — internal domain-service functions only, called by later modules. No HTTP route ships in this module.

**UI required**: none.

**Security considerations**: every table carries `organizationId` from creation, matching Module 2's tenant-scoping discipline; no query in this module is ever allowed to omit an organization filter, proven by tests, not by convention.

**Tests required**: unit tests for id/shape validation; integration tests proving an item cannot be created without a valid organization, and that a cross-organization category reference is rejected at the database level (composite-key style, matching Module 2's own workspace/organization FK trick).

**Acceptance criteria**: an item + its first version can be created, read back, and is provably scoped to exactly one organization; the 8 seed domains exist identically in every organization created from this point forward.

**Rollback strategy**: drop the four new tables; nothing else in the codebase references them yet, so this is a clean, zero-blast-radius revert.

---

## 2. Version History — ✅ COMPLETE

**Shipped as**: `src/lib/brain/knowledge-item-versions.ts` (service layer: list/get/current/restore) plus `createNextKnowledgeItemVersion` in `src/lib/brain/knowledge-items.ts` (the shared atomic version-creation engine used by both a plain update and a restore), the new `knowledge_item_versions` table, and three new routes under `.../knowledge/{knowledgeItemId}/versions/...`. Full write-up: `MODULE_5_BRAIN_MODULE_2_VERSION_HISTORY.md`.

**Deviations from this section's original sketch, both explicitly allowed by this section's own "Can be deferred" line**: (1) **diff computation was not built** — only version *metadata* (number, author, timestamp, change reason, current flag) is exposed; computing/rendering a diff between two versions is deferred to whichever later module first needs to display one. (2) **No rollback UI** — restore is a service function + a thin API route only, matching this whole module's "no UI" scope, identical to Module 1. Everything else in this section's acceptance criteria was met: full version history is reconstructable in order; restore creates a new version and moves `currentVersionId` forward, leaving every prior version row untouched; a version's `changeReason` and author are immutable once written, with no `updateVersion` function anywhere in the codebase.

**Original sketch, for reference**:

**Purpose**: real immutable version history — `currentVersionId` pointer, rollback, diff, mandatory `changeReason` (Module 3 §6).

**Why this order**: proves "nothing important disappears" before Trust is layered on top of something that could still silently change shape.

**Depends on**: #1.

**Enables**: #4 (Trust, assessed per version), #5 (Sources, one per version), #12 (Citation, cites a specific version), #19 (Timeline).

**Can be deferred**: rollback UI (data model can ship before any human-facing rollback control exists); diff computation can start as a simple full-content comparison and be optimized later without a schema change.

**Files likely required**: `src/lib/brain/versions.ts` (extended — `createVersion`, `rollback`, `diff`), `src/lib/brain/items.ts` (extended — move `currentVersionId`).

**Database entities**: `KnowledgeVersion` (full history now, not single-row); no new tables beyond #1, just real usage of the version chain.

**APIs required**: none public yet.

**UI required**: none yet (consumed by #19 later).

**Security considerations**: a version's `changeReason` and author are immutable once written — no update path exists for a version row at all, structurally, not just by convention (no `updateVersion` function is ever written).

**Tests required**: integration tests proving a version, once created, cannot be mutated; proving rollback moves the pointer without deleting intervening versions; proving `changeReason` is required and rejected when empty.

**Acceptance criteria**: an item's full version history is reconstructable in order; rollback correctly changes `currentVersionId` while leaving every version row untouched; a diff between any two versions of the same item is computable.

**Rollback strategy**: additive column/table changes only; revertible via down-migration since no other module has shipped consumers yet at this point in the sequence.

---

## 3. Relationships — ✅ COMPLETE

**Shipped as**: `src/lib/brain/relationships.ts` (create/list/get/archive), the new `knowledge_relationships` table + `relationship_type` enum, and four new routes under `/knowledge-relationships` and `.../knowledge/{knowledgeItemId}/relationships`. Full write-up: `MODULE_5_BRAIN_MODULE_3_RELATIONSHIPS.md`.

**This section's own "open question" note below (§15.11) is resolved, not left symmetric**: `MODULE_3_BRAIN_ARCHITECTURE.md` §13 entity 8 turns out to answer it directly — creation requires only that the actor can currently *see* both endpoints (§7), while removal requires the *same authority that could edit* either endpoint, on both ends. These are different, asymmetric authority levels (read vs. update), not the "simpler symmetric rule" this section originally speculated it would ship with — implemented exactly as entity 8 states, not as a placeholder.

**Deviation from this section's original sketch, explicitly allowed by its own "Can be deferred" line**: cycle detection was **not** implemented, and is not merely deferred to a later pass of this same module — `MODULE_3_BRAIN_GRAPH_AND_REASONING.md` (Module 3.1) §15 marks the actual cycle-handling *policy* as an unresolved open question and frames cycle detection as an inherently traversal-time concern, which this module's own scope explicitly excludes ("do not implement graph traversal yet"). This section's own "Tests required" line anticipated a cycle-detection test; see `MODULE_5_BRAIN_MODULE_3_RELATIONSHIPS.md`'s "Cycle detection" section for the full reasoning on why implementing even a narrow 2-node case would mean silently resolving an open architectural question this module has no authority to decide. Every other acceptance criterion below was met: all nine types creatable/queryable in both directions; no cross-tenant edge can ever be persisted (application- and database-level).

**Original sketch, for reference**:

**Purpose**: typed, directed edges between items — `supports`, `contradicts`, `depends_on`, `supersedes`, `related_to`, `created_from`, `references`, `used_by`, `required_for` (Module 3 §7).

**Why this order**: Observation (#13) and Decision (#14) generation are structurally impossible without edges to attach evidence/alternatives to; Retrieval (#11) needs graph traversal as a retrieval path.

**Depends on**: #1.

**Enables**: #11 (graph-traversal retrieval), #13, #14, and — later, in Module 4's own implementation — the Execution Graph's delegation/dependency edges are a distinct concept but reuse the same cycle-prevention discipline proven here.

**Can be deferred**: relationship-based ranking/weighting in retrieval (#11 can ship with keyword+permission filtering only at first, adding graph expansion once this module is stable); a UI for browsing the relationship graph (not required until #18/#19).

**Files likely required**: `src/lib/brain/relationships.ts` (create/remove edge, cycle check, cross-org rejection).

**Database entities**: `KnowledgeRelationship` (Module 3 §13, entity 8).

**APIs required**: none public yet.

**UI required**: none yet.

**Security considerations**: an edge can only ever be created between two items the creating actor can currently see (Module 3 §7's structural rule) — enforced by re-running the same permission check on *both* endpoints, not just the source item; cross-organization edges are rejected at creation, never merely filtered at read time.

**Tests required**: integration tests for every relationship type's creation; a cycle-detection test (A→B→A rejected or flagged, per the exact policy chosen — see Open Question below); a cross-organization edge rejection test; a permission test proving an edge cannot be created to an item the actor cannot see.

**Acceptance criteria**: all nine relationship types can be created and queried in both directions; no cycle or cross-tenant edge can ever be persisted.

**Rollback strategy**: one new table, no other module depends on real data in it yet; drop and revert cleanly.

*(Note: Module 3.1 §15.11 left "does relationship removal require the same authority as creation" as an open question — this module ships the simpler symmetric rule first, revisitable without a schema change since authority is an application-layer check, not a column.)*

---

## 4. Trust Model (+ Evidence) — ✅ COMPLETE

**Shipped as**: `src/lib/brain/trust.ts` (Source + Trust, both keyed off a version — combined in one file since they're always submitted together via `attachTrustMetadata`) and `src/lib/brain/evidence.ts` (create/list), the three new tables + three new enums, and four new routes under `.../knowledge/{knowledgeItemId}/versions/{versionNumber}/trust` and `.../evidence`. Full write-up: `MODULE_5_BRAIN_MODULE_4_TRUST_AND_EVIDENCE.md`.

**Two real contradictions were caught and resolved before implementation began** (both required stopping and asking, per this module's own explicit instruction not to silently reinterpret prior decisions): the specific task driving this module's implementation initially asked for trust/evidence changes to create new *content* versions, directly contradicting entities 6–7's explicit mutable-in-place/append-only design below — resolved in favor of the approved architecture, exactly as written in this section already. It also asked for a "verification stage" field, a term `MODULE_3_BRAIN_GRAPH_AND_REASONING.md` §9 ties to the full lifecycle state machine this implementation plan explicitly defers to Modules 8–9 (unreached) — resolved by omitting it entirely from Module 4, exactly as this document already implies by never mentioning verification stage as part of Module 4's own scope.

**Deviations from this section's own sketch**: (1) **`APIs required: none public yet` did not hold** — the specific task driving this module's build explicitly required thin HTTP routes now, which this module ships (see "APIs required" note below, superseded). (2) **Evidence staleness marking was not implemented** — this section's own "Tests required" line anticipated "evidence... never deleted, only marked stale," but `evidence_trust_tier`/`is_stale` shipped as real, storage-ready columns with no mutation path yet (the driving task's own Operations list named only creation and listing for evidence) — adding the mutation is a pure service-layer addition, not a schema change, deferred to whichever later module first needs it. Every other acceptance criterion below was met exactly.

**Original sketch, for reference**:

**Purpose**: the six-tier trust assessment per version (Verified/Approved/Observed/Hypothesis/Unknown/Deprecated) plus the `Evidence` records that justify it (Module 3 §5, §13 entities 6–7). Evidence is built here, not as its own numbered module, since it exists specifically to justify a trust assessment and the two are always authored together.

**Why this order**: needs real versions (#2) to attach to; comes before Domains-management (#6) and Permissions (#7) because trust/evidence data has no authorization dependency of its own yet — it's pure storage, safe to build early.

**Depends on**: #2.

**Enables**: #5 (source-hierarchy conflict resolution needs a trust tier to check against), #11 (retrieval ranking), #12 (citation includes the evidence backing a trust tier).

**Can be deferred**: automatic same-tier-conflict detection can ship as a simple query (do two Approved-tier items disagree, flagged manually) before any smarter detection is built; evidence "ranking" (Module 3.1 §3) can start as a flat list before independence-discounting logic exists.

**Files likely required**: `src/lib/brain/trust.ts`, `src/lib/brain/evidence.ts`.

**Database entities**: `KnowledgeTrust`, `Evidence` (Module 3 §13, entities 6–7).

**APIs required**: none public yet.

**UI required**: none yet (consumed by #18).

**Security considerations**: changing a trust tier is itself a privileged action (requires `approve`-level Domain Grant, per Module 3 §13) — this module should ship the *check* even before #7's full Domain Grant system exists, using a temporary "owner/admin of the organization" stand-in check, explicitly marked for replacement once #7 ships (see Migration Risks).

**Tests required**: unit tests for the tier enum and its ordering; integration tests proving a trust change is recorded as a distinct, auditable event, never a silent overwrite; a test proving evidence can be attached to a version and is never deleted, only marked stale.

**Acceptance criteria**: every version has exactly one current trust assessment; every trust assessment has zero or more evidence records; changing a trust tier produces a permanent record of the change (feeding #15).

**Rollback strategy**: additive tables; the temporary "org owner/admin" authorization stand-in (see Security) must be explicitly swapped for the real Domain Grant check in #7's own migration — tracked as a follow-up task, not left silently in place.

---

## 5. Sources — ✅ COMPLETE (built inside Module 4, not as a separately-scoped effort)

**Shipped as**: `knowledge_item_sources` (Brain Module 4's schema — `src/db/schema.ts`) and `recordSourceOnce`/`attachTrustMetadata` (`src/lib/brain/trust.ts`). Source and Trust are tightly coupled (§13's ER diagram ties both to one version) and are always submitted together through Module 4's single `attachTrustMetadata` operation, so this section's entire scope was completed as a natural part of Module 4's work rather than as its own standalone build — see `MODULE_5_BRAIN_MODULE_4_TRUST_AND_EVIDENCE.md` for the full write-up (schema, immutability enforcement, tests).

**A distinct, later capability — deterministic rank comparison over these already-stored source types — was built afterward, in a session also called "Brain Module 5" despite this section already being complete.** That work (list/get/compare/resolve-ordering over the fixed hierarchy, plus a tenant-scoped assignment-validation read) is **not** what this section originally scoped; it has no number of its own in this plan and is documented separately in `MODULE_5_BRAIN_MODULE_5_SOURCE_HIERARCHY.md`, which also records how this exact numbering ambiguity was raised and resolved before that work began.

Every acceptance criterion below was met by the Module 4 work: every version has exactly one source record with a valid hierarchy rank; a source record cannot be edited after creation (no `updateSource` function exists).

**Original sketch, for reference**:

**Purpose**: records where a version's content originated and its Source Hierarchy rank (Module 3 §7's nine tiers — Founder decision, company documentation, client-approved, internal SOP, meeting notes, AI draft, external research, open internet, unverified).

**Why this order**: needed before real cross-tier conflict resolution (Module 3.1 §6) can work, and before Citation (#12) can name a source. Independent of Trust's own schema, so buildable in parallel with #4 if convenient, but listed after it since Trust is the more foundational concept.

**Depends on**: #2.

**Enables**: #12 (citation names the source), cross-tier conflict resolution logic used throughout retrieval/reasoning (Module 3.1 §6).

**Can be deferred**: nothing meaningful — this is a small, self-contained module.

**Files likely required**: `src/lib/brain/sources.ts`.

**Database entities**: `KnowledgeSource` (Module 3 §13, entity 5).

**APIs required**: none public yet.

**UI required**: none yet.

**Security considerations**: a source record is immutable with its version (Module 3 §13) — correcting a misattributed source requires a new version, never an edit to the source record, structurally enforced (no `updateSource` function exists).

**Tests required**: integration test proving the nine-tier rank is correctly assigned per source type; a test proving a source record cannot be edited after creation.

**Acceptance criteria**: every version has exactly one source record with a valid hierarchy rank.

**Rollback strategy**: one small additive table; clean revert.

---

## 6. Domains (Management) — ⚠️ PARTIALLY COMPLETE (metadata only; Category CRUD deferred)

**Shipped as**: `src/lib/brain/domains.ts` (`listDomains`, `getDomain` — read-only) and the new `knowledge_domain_metadata` table, seeded via a dedicated migration. Two new routes under `/api/brain/domains` (deliberately not organization-scoped — this data has no tenant dimension). Full write-up: `MODULE_5_BRAIN_MODULE_6_DOMAIN_MANAGEMENT.md`.

**This section's own scope was only partially built.** The driving request for this work asked specifically for domain-level *metadata* (description, display order, ownership field, retirement flag — entity 1) and never mentioned `KnowledgeCategory` (entity 2) at all. `KnowledgeCategory` — the extensible, department-owned sub-classification this section's "Purpose" line centers on — **remains entirely unimplemented**, deferred in full to whichever future module actually builds it (unblocked: it needs only `knowledge_items.category_id`, an additive nullable column, per Module 1's own already-documented deviation).

**A real authorization gap was also discovered and is documented as a deviation, not silently worked around**: this section's own "Security considerations" line assumed "organization owner/admin... until #7's Domain Grant system exists" would be a safe temporary stand-in for domain-management mutation, mirroring #4's pattern. It is not — domains, unlike Trust, are **global** data (Module 1 already chose a shared enum over per-organization rows), so an organization-scoped role is the wrong shape of check entirely: it would let any one organization's admin mutate metadata every other organization sees. No safe stand-in exists for a genuinely global privileged action anywhere in this codebase yet. The driving task's own text anticipated exactly this possibility ("if [domains] remain immutable, implement read-only services only") and that is the path taken: `updateDomainMetadata` and activate/deactivate are **not implemented**. This should be revisited once a real platform-/founder-level authorization concept exists — not necessarily the same thing #7's org-scoped Domain Grant system will provide.

**Original sketch, for reference**:

**Purpose**: upgrades the seeded, unmanaged `KnowledgeDomain`/`KnowledgeCategory` rows from #1 into a real, manageable concept — extensible categories (owned by a department), the taxonomy rules from Module 3 §3.

**Why this order**: deliberately *after* Trust/Sources, because domain/category management only becomes meaningful once there's real content with real trust/source data to organize — building the management layer first, against empty seeded data, would be premature.

**Depends on**: #1.

**Enables**: #7 (Permissions grant against real, manageable domains/categories), #8 (Draft workflow needs a category to file a new item under).

**Can be deferred**: renaming/retiring a domain itself (Founder-level, rare — Module 3 §3) can ship later than category CRUD, which the owning department needs immediately.

**Files likely required**: `src/lib/brain/domains.ts` (extended — create/retire category, assign department ownership), `src/lib/dashboard/actions/brain-domains.ts`.

**Database entities**: `KnowledgeDomain`, `KnowledgeCategory` (now with a `department` ownership field/reference).

**APIs required**: `GET/POST /api/organizations/{organizationId}/brain/domains/{domainId}/categories`.

**UI required**: none yet — this module is API/service-layer only; the human-facing category management screen ships as part of #18 to avoid a UI module with nothing else to pair it with.

**Security considerations**: creating/retiring a category requires organization owner/admin (a Module 2 role check) until #7's Domain Grant system exists to make this a domain-specific authorization instead of an organization-wide one — same temporary-stand-in caveat as #4, tracked identically.

**Tests required**: integration tests for category creation/retirement, department-ownership assignment, and rejection of an attempt to create a 9th top-level domain (fixed set, per Module 3 §3 — this needs to be enforced as a real system constraint, not just documentation).

**Acceptance criteria**: a department can create and retire categories within its own domain without needing Founder-level involvement; the 8-domain ceiling is enforced, not just assumed.

**Rollback strategy**: additive columns on existing #1 tables only; safe to revert, reverting simply removes category-management capability while leaving the seeded data from #1 intact.

---

## 7. Permissions

**STATUS: COMPLETE** — see `platform/docs/MODULE_5_BRAIN_MODULE_7_PERMISSIONS.md` for the full implementation report. Delivered as `brain_permission_grants` (not a separately-named `DomainGrant` table — one grant per `(organization, domain, workspace|null, grantee, capability)` row) plus `src/lib/brain/permissions.ts` (not `grants.ts`) and five thin routes under `/api/organizations/{organizationId}/brain-permissions`. `AccessOverride` (private/agent-only item-level visibility) was **not** built — nothing in Modules 1–6 introduced a use case requiring it yet, and the task driving this implementation scoped it to the DomainGrant layer only; it remains a real, separately-scoped gap (§10's gate 5) for whichever future module first needs private/personal-memory knowledge. Every temporary "org owner/admin" stand-in this section's own "Enables" line named was retired, not merely supplemented, in the same pass.

**Purpose**: the "fourth, independent gate" Module 2 §12 already promised — `DomainGrant` and `AccessOverride` (Module 3 §10, §13 entities 12–13), composed on top of the existing organization/workspace chain, never inheriting from it.

**Why this order**: everything from here on writes real content that must be gated properly; this module must exist before Draft workflow (#8) so that "who may draft in this domain" is answered by a real grant, not a temporary stand-in.

**Depends on**: #6, and Module 2's existing organization/workspace membership chain.

**Enables**: every write-capable module from #8 onward; also the moment to retire the temporary "org owner/admin" stand-in checks used provisionally in #4 and #6.

**Can be deferred**: nothing — this is the module every later write path is gated by, and shipping it late would mean retrofitting authorization into several already-built write paths at once, which this plan avoids by sequencing it here instead.

**Files likely required**: `src/lib/brain/authz.ts` (new — `requireDomainGrant`, `requireAccessOverridePass`), `src/lib/brain/grants.ts` (grant CRUD), `src/lib/dashboard/actions/brain-grants.ts`.

**Database entities**: `DomainGrant`, `AccessOverride`.

**APIs required**: `GET/POST/DELETE /api/organizations/{organizationId}/brain/domains/{domainId}/grants`.

**UI required**: none yet (ships as part of #18).

**Security considerations**: this is the single highest-stakes module in the whole plan — grants are never inherited from organization or workspace role (Module 3 §10's explicit rule, mirroring Module 2's existing workspace-membership discipline); every prior module's temporary stand-in checks must be swapped over to real Domain Grant checks in this same migration, verified by re-running every earlier module's integration test suite against the new checks.

**Tests required**: exhaustive integration tests for every access level (read/draft-write/approve/archive/purge) against every actor type (owner/admin/member/viewer, and a stand-in for a future agent identity per Module 3 §15.8's open question); tests proving a Domain Grant is never satisfied by organization or workspace role alone; tests proving an Access Override correctly narrows an otherwise-broader grant.

**Acceptance criteria**: a member with no Domain Grant cannot read or write anything in a domain even if they are an organization owner; every access level is independently, correctly enforced; every earlier module's provisional check is fully replaced, with no dead code left behind.

**Rollback strategy**: this module's rollback is the first genuinely non-trivial one in the sequence — reverting it means every write path built after it loses its real authorization check. The mitigation is sequencing (§ above): nothing depends on it existing *yet* at the moment it ships, since #8 onward hasn't been built. Once #8+ exist, this module is effectively permanent; treat any future change to it as a "coexist, verify, cut over" migration (Module 4's own stated migration discipline), never a direct alteration.

---

## 8. Draft Workflow

**STATUS: COMPLETE** (built together with #9 — see `platform/docs/MODULE_5_BRAIN_MODULE_8_9_LIFECYCLE.md`). Delivered as an extension of the existing `knowledge_item_status` enum (not a new `lifecycleState` column, per that enum's own original comment) plus `src/lib/brain/lifecycle.ts`. Dedicated `LifecycleEvent` table still deferred to #15 exactly as planned — transitions reuse `audit_logs` in the interim, matching every other Brain module's own audit approach.

**Purpose**: the Idea → Draft → Review transitions (Module 3 §4) and their `LifecycleEvent` records.

**Why this order**: needs #7 to know who may draft in a given domain/category.

**Depends on**: #7.

**Enables**: #9 (Review/Approval), #17 (Agent draft API — agents only ever reach Draft, never beyond).

**Can be deferred**: the "send back to Draft from Review" loop can ship as a simple state transition before any UI exists to trigger it manually (the UI comes in #18).

**Files likely required**: `src/lib/brain/lifecycle.ts` (state machine + transition guards).

**Database entities**: adds a `lifecycleState` column to `KnowledgeItem`/`KnowledgeVersion`; no new table beyond the `LifecycleEvent` log (built fully in #15, referenced here).

**APIs required**: `POST /api/organizations/{organizationId}/brain/items` (create Draft), `POST .../items/{itemId}/submit-for-review`.

**UI required**: none yet.

**Security considerations**: an agent identity may create a Draft but the transition to Review must record whether a human or an agent initiated it (Module 3 §9) — this module must not allow an agent-authored item to skip straight past Draft under any permission level, structurally (no code path exists that both creates an item and marks it Approved in the same call).

**Tests required**: integration tests for every valid transition and rejection of every invalid one (e.g., Draft → Approved directly is never a legal transition, even for an organization owner); a test proving an agent-authored draft is indistinguishable in permission terms from a human-authored one at this stage (both are just Draft).

**Acceptance criteria**: an item can move Idea → Draft → Review and back, with every transition recorded; no transition ever skips Review to reach Approved, for any actor.

**Rollback strategy**: one additive column plus service logic; revertible cleanly since #9 (its only real dependent) hasn't shipped yet at this point in the sequence.

---

## 9. Review / Approval

**STATUS: COMPLETE** — see `platform/docs/MODULE_5_BRAIN_MODULE_8_9_LIFECYCLE.md`. The `publish`-level-grant question (§15.5) was resolved as planned: ships sharing `approve`'s grant level, revisitable without a schema change. `Purged` (Draft/Approved → Purged) was **not** implemented — no organizational-role model exists anywhere in this codebase for "Founder's Office and Security & Trust jointly," and building a fake mapping onto an irreversible-deletion path was judged a real data-loss risk rather than a safe approximation. `idea` and `purged` remain real, storage-ready enum values with no producing code path.

**Purpose**: Review → Approved → Published (Module 3 §4) — the one gate with structurally no agent bypass, ever.

**Why this order**: directly extends #8's state machine; needed before Decision tracking (#14), since a Decision's "Approved" status means something specific here.

**Depends on**: #8.

**Enables**: #14, real Published-tier content for #10/#11 to ever surface as fully-trusted.

**Can be deferred**: a distinct `publish`-level grant separate from `approve` (Module 3 §15.5's open question) — ships initially with `approve` and `publish` using the same grant level, revisitable without a schema change since it's an authorization-level policy, not a structural one.

**Files likely required**: `src/lib/brain/lifecycle.ts` (extended).

**Database entities**: no new tables — extends #8's state column and #4's trust column together (approval commonly accompanies a trust-tier change, though the two remain independently modeled per Module 3 §5).

**APIs required**: `POST .../items/{itemId}/approve`, `POST .../items/{itemId}/publish`, `POST .../items/{itemId}/archive`.

**UI required**: none yet.

**Security considerations**: the single hardest-enforced rule in this entire plan — the code path that transitions an item to Approved must check that the acting identity is a **human**, not merely that it holds sufficient permission level, with no exception for any future agent permission tier (Module 3.1 §9, AGENT_FRAMEWORK §4/§5's explicit statement that even an Executive-tier agent cannot self-promote).

**Tests required**: an integration test that attempts an agent-identity approval and asserts it is rejected regardless of the agent's declared grant level — this specific test is treated as a permanent regression guard, never removed even if it seems redundant later.

**Acceptance criteria**: only a named human can move an item to Approved; every approval records who approved it and why; archived items remain fully readable, never deleted.

**Rollback strategy**: extends existing columns; safe to revert at this point since #14 (its dependent) hasn't shipped yet.

---

## 10. Search Interface (keyword only)

**STATUS: COMPLETE** — see `platform/docs/MODULE_5_BRAIN_MODULE_10_SEARCH.md`. Internal function only (`searchKnowledgeItems`), no public route yet, exactly as planned.

**Purpose**: a real, simple keyword-search primitive (Postgres full-text or `ILIKE`-based) over item/version content — explicitly **not** semantic or hybrid search (Module 3.1 §13 names keyword search as always available without an embedding pipeline).

**Why this order**: needed as one of Retrieval's (#11) input sources; comes after Permissions (#7) so results can be filtered correctly from day one, never as an afterthought bolted onto an already-shipped unfiltered search.

**Depends on**: #1, #7.

**Enables**: #11.

**Can be deferred**: relevance ranking sophistication (stemming, fuzzy matching) — ships first as exact/substring matching, improved later without a schema change.

**Files likely required**: `src/lib/brain/search.ts`.

**Database entities**: none new; a `tsvector`-backed index on existing version content is the only schema addition (an index, not a new table).

**APIs required**: internal function only at this stage — no public HTTP route until #11 composes it into something agent/human-facing.

**UI required**: none yet.

**Security considerations**: **every** search query is filtered by the same Domain Grant/Access Override chain as direct item access (Module 3.1 §8's explicit rule) — this is proven with a test that plants a restricted item and confirms it never appears in an unauthorized actor's search results, before any other search feature is considered done.

**Tests required**: the permission-filtering test above; basic relevance tests (exact term match ranks above no match).

**Acceptance criteria**: a keyword query returns only items the querying identity could already read directly; results are ordered by basic relevance.

**Rollback strategy**: drop the index; no new table to revert.

---

## 11. Retrieval Layer

**STATUS: COMPLETE** — see `platform/docs/MODULE_5_BRAIN_MODULE_11_RETRIEVAL.md`. `maxDepth` defaults to 2 (capped at 5) per §15.4's own deferred tuning note. Internal function only, as planned.

**Purpose**: the composed "relevant nodes" step from Module 3.1 §2's pipeline — unions keyword search (#10) results with graph-traversal expansion (via #3's relationships), de-duplicated, still fully permission-filtered.

**Why this order**: needs #3 (relationships to traverse), #4/#5 (trust/source to evaluate what's returned), #7 (permission filtering), and #10 (its first candidate source) all already built.

**Depends on**: #3, #4, #5, #7, #10.

**Enables**: #12 (citation needs a real retrieval trace to cite), #16 (the agent read API is largely this layer, exposed).

**Can be deferred**: graph-traversal depth limits can start conservative (a small fixed bound) and be tuned later (Module 3.1 §15.4's open question) without a schema change.

**Files likely required**: `src/lib/brain/retrieval.ts`.

**Database entities**: none new — a composition service over existing tables.

**APIs required**: internal function, consumed by #12/#16; no direct public route of its own.

**UI required**: none.

**Security considerations**: cycle detection (Module 3.1 §9) during traversal is a hard requirement here, not an optimization — a visited-node set with a hard stop, tested explicitly with a deliberately-cyclic fixture.

**Tests required**: integration tests combining keyword hits and graph-traversal hits, proving de-duplication; a cycle-safety test; a permission test proving traversal never surfaces an item the actor couldn't already read directly (Module 3.1 §7's "traversal never grants visibility" rule).

**Acceptance criteria**: a query returns a permission-correct, de-duplicated candidate set from both keyword and graph-traversal sources, bounded and cycle-safe.

**Rollback strategy**: a pure service-layer module with no schema of its own; revert by removing the file and its call sites.

---

## 12. Citation Generation

**STATUS: COMPLETE** — see `platform/docs/MODULE_5_BRAIN_MODULE_12_CITATIONS.md`.

**Purpose**: mechanically builds the `{node, version, evidence, source, assumptions}` citation structure from a real retrieval trace (Module 3.1 §11) — never regenerated from finished text after the fact.

**Why this order**: needs #4, #5, and #11 all producing real data to cite.

**Depends on**: #4, #5, #11.

**Enables**: #16 (every agent-read response must carry citations).

**Can be deferred**: nothing meaningful — this is a small, focused module and a prerequisite for #16 to be safe at all.

**Files likely required**: `src/lib/brain/citations.ts`.

**Database entities**: none new — citations are generated at read time, not persisted (a citation is a property of one specific answer/reasoning run, not company knowledge itself).

**APIs required**: internal function only.

**UI required**: none yet (surfaced wherever #16's consumers render an answer).

**Security considerations**: a citation must only ever be built from nodes the retrieval trace *actually* returned — this module accepts a retrieval-trace object as its only input, structurally preventing any caller from fabricating a citation for a node that was never really retrieved (Module 3.1 §9's anti-fabrication rule, enforced by the function signature itself, not by a runtime check that could be bypassed).

**Tests required**: a test proving the citation list exactly matches the input retrieval trace's node set, with no additions or omissions; a test proving an assumption is never silently merged into the evidence list.

**Acceptance criteria**: every citation entry names a real node, version, evidence set, and source; assumptions are listed separately and explicitly.

**Rollback strategy**: pure function module; remove the file and its call site.

---

## 13. Observation Generation

**STATUS: COMPLETE** — see `platform/docs/MODULE_5_BRAIN_MODULE_13_OBSERVATIONS.md`.

**Purpose**: the workflow for drafting an Observation-type Knowledge Item from a pattern noticed across several lower-level items (Module 3.1 §4's worked example — three meeting-derived Facts becoming one Observation).

**Why this order**: needs #3 (the `supports`/`created_from` edges linking sources to the Observation) and #8 (the Draft state it enters at).

**Depends on**: #3, #8.

**Enables**: #14 (an Observation is common evidence for a Decision).

**Can be deferred**: automatic pattern-detection ("suggest this Observation because three similar Facts exist") can ship later as a convenience; the module is fully functional with a human or agent manually authoring the Observation and linking its sources by hand first.

**Files likely required**: `src/lib/brain/observations.ts` (a thin, `knowledgeType`-specific wrapper over #1/#8's general item-creation path, adding the "must cite at least one source via `created_from`/`supports`" rule).

**Database entities**: none new — Observation is a `knowledgeType` value on the existing `KnowledgeItem` (Module 3 §1's explicit design decision against a separate table per content shape).

**APIs required**: `POST .../items` with `knowledgeType: "observation"` — no separate route, reusing #8's endpoint with a validation rule specific to this type.

**UI required**: none yet (part of #18).

**Security considerations**: an Observation's natural trust ceiling is Approved, never Verified (Module 3.1 §4) — enforced as a validation rule in #4's trust-assignment path specifically for this `knowledgeType`, not left to reviewer discretion.

**Tests required**: a test proving an Observation cannot be created with zero supporting edges; a test proving an attempt to set Verified-tier trust on an Observation-type item is rejected.

**Acceptance criteria**: an Observation is always evidenced by at least one real edge to a source item, and its trust ceiling is structurally enforced.

**Rollback strategy**: a validation-rule addition on top of #1/#8; remove the rule, no data migration needed.

---

## 14. Decision Tracking

**STATUS: COMPLETE** — see `platform/docs/MODULE_5_BRAIN_MODULE_14_DECISIONS.md`. "Same or higher approval authority" resolved as "same exact-scope `approve` grant" (flat capability model, no seniority tiers).

**Purpose**: the structured Decision fields (who, why, evidence, alternatives, risks, outcome, status) and supersession mechanics (Module 3.1 §5).

**Why this order**: needs #3 (alternatives/evidence edges), #4 (trust stepping to Deprecated on supersession), and #9 (a Decision's Approved status must mean the same thing every other Approved item's does).

**Depends on**: #3, #4, #9.

**Enables**: #18 (the human editing interface's most structurally complex form).

**Can be deferred**: dedicated "risk" and "alternative" relationship/entity types (Module 3.1 §15.5's open question) — ships first using `related_to`/`references` edges plus free-text content, as this plan (following Module 3.1) recommends, revisitable later without breaking existing Decisions.

**Files likely required**: `src/lib/brain/decisions.ts`.

**Database entities**: none new beyond what #1–#9 already provide — Decision is a `knowledgeType`, its "outcome" field is captured via a new version of the same item (Module 3.1 §12's explicit rule: outcome tracking is new history on the same item, not a new item).

**APIs required**: `POST .../items/{itemId}/record-outcome` (creates a new version with the outcome field populated), `POST .../items/{itemId}/supersede`.

**UI required**: none yet (part of #18).

**Security considerations**: overturning a Decision (`supersede`) requires the same or higher approval authority as the original approval (Module 3.1 §5's explicit rule) — checked against #7's Domain Grant, not merely "any owner/admin."

**Tests required**: a test proving `supersede` correctly steps the old version's trust to Deprecated atomically with creating the new Decision; a test proving a lower-authority actor cannot supersede a Decision approved by a higher one.

**Acceptance criteria**: every Decision's who/why/evidence/alternatives/risks/outcome/status is queryable; supersession is atomic and correctly authorized.

**Rollback strategy**: service-layer only; no new schema to revert beyond what earlier modules already own.

---

## 15. Audit Integration

**STATUS: COMPLETE** — see `platform/docs/MODULE_5_BRAIN_MODULE_15_AUDIT_INTEGRATION.md`. §15.6's sampling question resolved as "agent reads always logged, human reads deferred entirely" — a real policy in `shouldLogAccess`, not silently decided.

**Purpose**: wires every prior module's mutations into the existing `audit_logs` table (Module 2's own infrastructure) with Brain-specific `event_type` values, plus the separate, higher-volume `AccessLogEntry` for reads (Module 3 §11).

**Why this order**: deliberately built after #1–#9 rather than alongside each, so this module can retrofit a complete, consistent audit trail across everything already built in one pass, rather than each earlier module inventing its own slightly-different logging call.

**Depends on**: #1–#9 (everything it audits).

**Enables**: #19 (the timeline interface is a direct read of this data); all future observability/health metrics (Module 3 §12, AGENT_FRAMEWORK §12).

**Can be deferred**: the separate `AccessLogEntry` table's sampling policy (Module 3 §15.6's open question) — ships first at full fidelity for agent reads only (matching AGENT_FRAMEWORK §11's non-negotiable requirement) with human-read logging deferred or sampled, a decision explicitly left open rather than silently resolved here.

**Files likely required**: `src/lib/brain/audit.ts` (extends the existing `recordAuditEvent` helper with Brain event types), `src/lib/brain/access-log.ts` (new, separate table's writer).

**Database entities**: new `AccessLogEntry` table; `audit_logs` itself is *not* altered (its `event_type` column is already free-text per Module 2's own design, so no schema change is needed there at all — only new values are ever written).

**APIs required**: none public — write-only, internal.

**UI required**: none yet (consumed by #19).

**Security considerations**: this module is write-only from the application's perspective — no update or delete path is ever written for either log, structurally matching "Historical Memory is append-only" (Module 3 §11).

**Tests required**: a test asserting every mutating function built in #1–#9 produces exactly one corresponding audit event (a completeness sweep, not a spot check); a test proving no code path can update or delete an existing log row.

**Acceptance criteria**: every mutation across every earlier module has a permanent audit trail; every agent read is logged at full fidelity.

**Rollback strategy**: the new `AccessLogEntry` table can be dropped independently; `audit_logs` itself is untouched, so there is nothing to revert there.

---

## 16. Agent Read API

**STATUS: COMPLETE** — see `platform/docs/MODULE_5_BRAIN_MODULE_16_AGENT_READ_API.md`. Delivered as a deterministic REST read surface (list/get/versions/relationships/citation-ready-context) under `/api/agent/brain/knowledge/...`, per an explicit, more specific later instruction that superseded this section's original "single Q&A-style interface exposing #11+#12" sketch — the underlying `retrieveRelevantKnowledge`/`buildCitations` graph-traversal machinery was deliberately NOT reused for this deterministic endpoint (that remains Module 4 Runtime's future reasoning-time concern); `getKnowledgeContextForAgent` instead assembles its citation-ready bundle directly from one item's own version/trust/source/evidence/relationship rows. Gated by the identical `brain_permission_grants` table Module 7 already built, widened to a real `(human | agent)` grantee union — not a second permission system, not Observer-tier-only (any of the 8 capability values can be granted to an agent; only `read`/`draft_write` currently have real call sites).

**Purpose**: exposes #11 (retrieval) + #12 (citation) as a single, callable, permission-checked interface for agent code — Observer-tier only, no write capability anywhere in this module.

**Why this order**: this is the first module Module 4's runtime (built separately, later) will actually call into for its Reasoning state — it must sit on top of a fully-working retrieval/citation/trust/permission stack, not be built in parallel with it.

**Depends on**: #11, #12, #15.

**Enables**: Module 4's Reasoning state (out of scope to build here, but this is the exact interface it will call).

**Can be deferred**: nothing about the read path itself; rate-limiting/quota policy per agent identity can start conservative and be tuned later without an interface change.

**Files likely required**: `src/lib/brain/agent-read.ts`, `src/app/api/organizations/[organizationId]/brain/agent/read/route.ts`.

**Database entities**: none new.

**APIs required**: `POST /api/organizations/{organizationId}/brain/agent/read` — accepts a question + the calling agent's identity, returns retrieved nodes + citations + confidence inputs (raw trust/evidence/freshness data, not a computed confidence band — that computation belongs to Module 4's reasoning runtime, not this API).

**UI required**: none — this is machine-to-machine only.

**Security considerations**: every request executes as the real, specific calling agent identity (Module 3.1 §9's rule) — there is no service-account or elevated internal caller anywhere in this route; every request re-validates live Domain Grants, never a cached snapshot.

**Tests required**: integration tests proving a scoped agent identity only ever receives results from its declared domain scope plus Identity (AGENT_FRAMEWORK §4); a full-fidelity access-logging test for every call.

**Acceptance criteria**: a registered agent identity can query the Brain and receive permission-correct, cited, evidence-backed results, with zero write capability reachable from this route.

**Rollback strategy**: one new route + one new service file; disable the route to fully rollback with no data migration involved.

---

## 17. Agent Draft API

**STATUS: COMPLETE (bounded scope)** — see `platform/docs/MODULE_5_BRAIN_MODULE_17_AGENT_ATTRIBUTION.md`. Delivered as the smallest bounded operation that proves real agent attribution end to end (`createDraftKnowledgeItemAsAgent` — create only, no refresh/update path), per an explicit later instruction to implement only what Module 17 requires to prove the ceiling, not the full Agent Draft API this section originally sketched. `AgentAttribution` was NOT built as a separate table (Module 3 §13 entity 17's original sketch) — the smaller, robust model instead widens `knowledge_items`/`knowledge_item_versions`/`audit_logs`/`brain_permission_grants` in place with paired `*_agent_id`/`*_type` columns and an "at most one actor" CHECK constraint, scoped only to the tables agents can actually write today (relationships/sources/trust/evidence remain human-only attribution, unextended, since no agent code path touches them under the current ceiling).

**Purpose**: the write side for agents — create or refresh a Draft-tier item only, ever, with `AgentAttribution` recorded (Module 3 §13, Module 3.1 §9).

**Why this order**: needs #8 (the draft state machine), #15 (audit), and #16 (an agent must be able to read before it can meaningfully draft) all already in place.

**Depends on**: #8, #15, #16.

**Enables**: Module 4's agent-authored Artifacts/Observations (out of scope to build here, but this is the exact interface it will call).

**Can be deferred**: nothing about the Draft-only ceiling — this is the single most load-bearing rule in the whole plan and ships with this module, not after it.

**Files likely required**: `src/lib/brain/agent-draft.ts`, `src/app/api/organizations/[organizationId]/brain/agent/draft/route.ts`.

**Database entities**: `AgentAttribution` (Module 3 §13, entity 17).

**APIs required**: `POST /api/organizations/{organizationId}/brain/agent/draft`.

**UI required**: none — machine-to-machine only.

**Security considerations**: **the single hardest test in this entire plan lives here** — an integration test that attempts, via this API, to create or transition an item to any state above Draft, for every possible agent permission level (including a hypothetical future Executive tier), and asserts every single attempt is rejected. This test is treated as permanent, never removed, never weakened.

**Tests required**: the above; a test proving `AgentAttribution` is recorded on every agent-authored version, never silently omitted; a test proving this API's write path is otherwise identical in behavior to a human's Draft-creation path (no separate, looser validation for agent-submitted content).

**Acceptance criteria**: an agent can create/refresh Draft-tier knowledge, fully attributed, through zero code path that reaches Approved.

**Rollback strategy**: one new route, one new table; disable the route and drop the table with no impact on human-authored content, which never touches this table.

---

## 18. Human Editing Interface

**Purpose**: the first UI-bearing module — dashboard pages for creating, editing, reviewing, approving, and managing categories/grants, reusing this platform's existing component library (`FormField`, `SelectField`, `ConfirmDialog`, `SubmitButton`, `StatusMessage`) and server-action pattern exactly.

**Why this order**: deliberately last among the write-path modules, once #6 (domains), #7 (permissions), #8/#9 (lifecycle), and #14 (decisions) all have stable, tested service-layer logic underneath — this UI is a thin layer over already-proven logic, never a place new business rules are introduced.

**Depends on**: #6, #7, #8, #9, #14.

**Enables**: #19 (shares navigation/shell).

**Can be deferred**: bulk-editing conveniences, keyboard shortcuts, and any UI polish beyond the core create/review/approve/grant flows — the minimal correct flow ships first.

**Files likely required**: `src/app/app/[organizationSlug]/brain/{page.tsx, [itemId]/page.tsx, domains/page.tsx, grants/page.tsx}`, `src/components/dashboard/Brain*.tsx` (forms, item rows, approval dialogs), `src/lib/dashboard/actions/brain-*.ts` (server actions wrapping #6–#9/#14's service functions — never re-implementing their rules).

**Database entities**: none new — pure presentation over existing entities.

**APIs required**: none new beyond what server actions call directly (following this platform's existing precedent of server actions calling domain services directly rather than round-tripping through its own HTTP API).

**UI required**: as above — this module *is* the UI.

**Security considerations**: every server action independently re-resolves the organization/item by slug/id and re-checks the Domain Grant chain — the UI never trusts a client-supplied id for authorization, and never duplicates a business rule already enforced in #6–#9/#14's service layer (this platform's own established, repeatedly-verified discipline from its prior admin-UI modules).

**Tests required**: integration tests for every server action (authz boundaries, exactly mirroring the pattern already used for this platform's organization/workspace/invitation admin UI); accessibility tests (`jest-axe`) for every new form and dialog; a manual verification pass against a real seeded session before sign-off, matching this platform's established practice.

**Acceptance criteria**: a human with the right Domain Grant can create, review, approve, and manage Brain content and grants end-to-end through the UI; every action is denied correctly for a human without the right grant; all new components pass automated accessibility checks.

**Rollback strategy**: this module's routes/pages are additive and unlinked from navigation until explicitly wired in (matching this platform's own established practice) — rollback is removing the nav links first, then the pages, with zero effect on the data or service layer underneath.

---

## 19. Timeline / History Interface

**Purpose**: the human-facing view of #2's version history, #15's audit trail, and #14's decision outcomes — "who changed what, when, why" made directly visible rather than left to a database query.

**Why this order**: the leaf of this plan — needs #2 (real history to show), #15 (a complete audit trail to show), and #18 (the dashboard shell/navigation it hangs off of) all already shipped.

**Depends on**: #2, #15, #18.

**Enables**: nothing further within this plan — genuinely the last module.

**Can be deferred**: nothing about read correctness; visual polish (a graphical diff view versus a simple side-by-side) is a pure enhancement, addable later without any data-model change.

**Files likely required**: `src/app/app/[organizationSlug]/brain/[itemId]/history/page.tsx`, `src/components/dashboard/BrainHistoryTimeline.tsx`.

**Database entities**: none new — a read-only view over #2/#15's existing tables.

**APIs required**: none new beyond a server component's direct read.

**UI required**: as above.

**Security considerations**: this view must apply the exact same permission check as reading the item itself — a history/audit view is not a side door to information the underlying Domain Grant chain wouldn't otherwise allow.

**Tests required**: integration test proving the timeline is denied identically to the item itself for an unauthorized actor; a11y tests for the timeline component.

**Acceptance criteria**: a human with read access to an item can see its full version history, every lifecycle transition, and (for Decisions) its outcome history, in one coherent, chronological view.

**Rollback strategy**: a single additive page; remove the nav link and the route with zero effect on any other module.

---

## 20. Future Embedding Integration (interface only — no embeddings implemented)

**Purpose**: defines the `Chunk` entity's structural shape (Module 3 §13, entity 10) and the extension points a future semantic-search module would plug into — explicitly **not** an embedding pipeline, vector store, or any actual semantic capability.

**Why this order**: last, deliberately — this module exists only so the schema shape is settled and stable before a future, separately-approved module builds real search on top of it, per both Module 3 §8 and Module 3.1 §13's explicit "do not design search implementation here" instruction, now extended to "do not build it here either."

**Depends on**: #1 (chunks derive from versions), #3 (a future search module will want graph-traversal alongside chunk-based retrieval, per Module 3.1 §13).

**Enables**: a future, separately-approved embedding/semantic-search module — nothing in this plan is unlocked by it, since nothing here consumes chunks yet.

**Can be deferred**: this entire module can, in fact, be deferred past all nineteen others with zero impact on any of them — it is included at position 20 only because the brief's own ordering places it last, not because anything above requires it.

**Files likely required**: `src/lib/brain/chunks.ts` (create/regenerate/delete only — no embedding logic, no vector math, no external provider call of any kind).

**Database entities**: `Chunk` (Module 3 §13, entity 10) — content reference + parent version id only; explicitly **no** embedding/vector column in this module.

**APIs required**: none — chunk generation is not triggered by anything yet, since nothing consumes chunks until a future search module exists.

**UI required**: none.

**Security considerations**: chunks must be fully disposable and regenerable (Module 3 §13's explicit requirement) — proven by a test that deletes every chunk for a version and regenerates them, asserting the result is identical, before this module is considered complete.

**Tests required**: the regeneration-is-lossless test above; a test proving a chunk cannot outlive its parent version (cascading cleanup).

**Acceptance criteria**: chunks can be produced from a version's content and safely, losslessly regenerated; no embedding, vector index, or external provider dependency exists anywhere in this module.

**Rollback strategy**: one new table with no consumers anywhere in this plan; trivially droppable at any time.

---

## Critical Risks

- **The Draft-ceiling rule (module 17) is the single point of failure for the entire safety model.** If this is ever weakened — even temporarily, even for a "trusted" internal tool — every downstream promise in Modules 3, 3.1, and 4 (agents draft, humans decide) becomes unenforceable in practice regardless of what the architecture documents say. This plan treats its regression test as permanent and non-negotiable for exactly this reason.
- **Temporary authorization stand-ins in Modules 4 and 6** (used before Module 7's real Domain Grant system exists) must be fully removed, not merely supplemented, once Module 7 ships — a stand-in left in place alongside the real check is a second, inconsistent authorization path, which is worse than either check alone. **DONE**: removed in the same pass Module 7 shipped, across Modules 1, 3, 4 (Module 6 never had its own stand-in to remove — domain metadata is read-only) — see `MODULE_5_BRAIN_MODULE_7_PERMISSIONS.md`'s migration-mapping table.
- **Cross-organization leakage** remains the highest-severity category of bug across every module that touches Relationships (#3), Retrieval (#11), or the Agent APIs (#16, #17) — each of those modules' test suites includes an explicit cross-tenant rejection test as a hard requirement, not an optional nice-to-have.

## Migration Risks

- **Module 7 (Permissions) is the one module in this plan whose rollback stops being trivial the moment Module 8 ships.** Every module from 8 onward assumes Domain Grants are real and enforced; reverting Module 7 after that point would silently disable authorization everywhere above it, not just remove a feature. Treat any future *change* to Module 7 (not a rollback, a genuine future modification) with the "coexist, verify, cut over" discipline already established elsewhere in this platform's own migration precedent, never a direct in-place alteration.
- **Seeded domain data (Module 1) becoming stale.** The 8 domains are seeded once, at Module 1's migration time; if LYNQ's own department structure changes before Module 6 (real domain management) ships, the seed data itself would need a manual data migration, not just a schema one — flagged here so it isn't discovered as a surprise mid-build.
- **`audit_logs`' existing free-text `event_type` column already accommodates every new Brain event type this plan introduces without a schema change** — the risk is entirely one of *discipline* (a future module inventing a slightly different event-type naming convention than an earlier one), not of the schema itself; a single naming-convention document for Brain event types is worth producing before Module 15 ships, to avoid drift.

## Scaling Risks

- **Chunk volume (Module 20, and whatever future module consumes it)** — flagged already in Module 3.1 §14 as the single fastest-growing table candidate in the whole system; this plan defers it entirely rather than building it prematurely, but a future search module's implementation plan should budget for this from its very first line.
- **`AccessLogEntry` volume (Module 15)**, especially once real agent traffic exists (Module 4, built separately) — full-fidelity logging is correct and required for agent reads (AGENT_FRAMEWORK §11) but the retention/pruning policy for this specific table needs its own decision before real agent volume arrives, not after.
- **Version-history growth on high-churn items** — nothing in this plan deletes old versions (by design), so an item that changes very frequently (an Operational-tier fact revised daily) will accumulate versions indefinitely; this is correct per Module 3's principles but is a real future storage-planning input, not a defect to fix now.

## Testing Strategy

- **Every module ships with integration tests against the real Neon database** (`vitest.integration.config.mts`), following this platform's own established discipline — no module is considered complete on unit tests alone, since almost everything here is fundamentally about authorization and data integrity, which unit tests with mocked data cannot meaningfully prove.
- **Every module that touches authorization (1, 3, 4, 6, 7, 8, 9, 10, 11, 16, 17) includes an explicit "wrong actor is correctly denied" test**, not just a "right actor is correctly allowed" test — this platform's own prior modules (2, 5A–5C) already establish this as the expected default, not an extra.
- **Module 7's own test suite is run again, unmodified, against every earlier module (1, 4, 6) once their temporary stand-in checks are replaced** — proving the swap didn't silently change behavior for any already-tested case.
- **UI modules (18, 19) include accessibility tests** (`jest-axe`, via `vitest.a11y.config.mts`) for every new form/dialog/component, matching this platform's established standard.
- **A full-suite regression run (`npm run test`, `npm run test:integration`, `npm run test:a11y`, plus `typecheck`/`lint`/`build`) is required at the end of every single module**, not just at the end of the whole plan — this platform's own established per-step discipline, carried forward unchanged.

## Performance Considerations

- **Retrieval (#11)'s graph-traversal depth bound** is the one place in this plan most likely to need real tuning against real data volume — ships conservative, tightened or loosened only once real usage patterns exist to inform the decision (Module 3.1 §15.4's open question, inherited here rather than re-solved).
- **Live permission re-checking on every gated action** (the deliberate choice throughout, especially #16/#17's agent APIs) has a real per-call cost that this plan accepts deliberately, exactly as Module 4 §12 already reasoned through for the runtime layer — the alternative (a stale cached grant) is a security gap, not a performance optimization worth making.
- **Keyword search (#10)** should be indexed from day one (a `tsvector` index, not a sequential scan) even though this plan doesn't build ranking sophistication yet — the index is cheap to add now and expensive to retrofit onto a large table later.

## Long-Term Evolution

- **This plan is designed to be extended, not replaced, when a future search module adds real semantic capability** (Module 20's deferred territory) — the `Chunk` entity's shape is settled now specifically so that future work is additive.
- **Module 4's agent runtime, when it is itself implemented (separately, later, under its own approval),** will call directly into Modules 16 and 17's APIs as designed — no interface change to those two modules should be anticipated as a prerequisite for the runtime's own build, which is precisely why this plan treats them as stable, tested contracts rather than provisional stubs.
- **Every open question deferred by Modules 3, 3.1, and 4** (domain configurability per organization, HR's department-mapping gap, confidence-band taxonomy, delegation depth limits, and the rest) remains open here too — this plan does not silently resolve any of them; it only sequences the engineering work in a way that keeps every one of them cheaply revisitable, never load-bearing on an early module's schema in a way that would make a later decision expensive to change.

---

*This document is an engineering roadmap. No implementation code, migration, schema change, or package has been created as a result of it, and Modules 2, 3, 3.1, and 4 have not been modified. Implementation begins only after explicit approval, module by module, in the order above.*
