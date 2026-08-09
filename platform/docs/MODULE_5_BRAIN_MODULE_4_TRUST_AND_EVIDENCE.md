# Brain Module 4 — Trust Model & Evidence

Implements Module 4 of `platform/docs/MODULE_5_BRAIN_IMPLEMENTATION_PLAN.md`, on top of the approved Brain Modules 1–3. Adds trust metadata, source attribution, and evidence to immutable Knowledge Item Versions — where knowledge came from, why the system should trust it, and what supports it. **Storage only** — no reasoning, no AI confidence computation, no same-tier-conflict resolution, no cross-tier Source Hierarchy resolution. Those are Module 3.1's reasoning layer, explicitly out of scope here.

---

## Two contradictions resolved before implementation began

Per this task's own explicit instruction to stop rather than silently reinterpret, two real conflicts between the request and the already-approved architecture were surfaced and resolved with you before any code was written:

1. **Trust/Evidence mutability.** The request's "update trust by creating a new version" and "changing evidence must create a new version" directly contradicted `MODULE_3_BRAIN_ARCHITECTURE.md` §13 entities 6–7, which explicitly call Trust "the one entity in the version's cluster that is explicitly mutable — reassessed, not re-versioned" and Evidence "append-only — superseding evidence is added, not edited over." **Resolved: follow the approved architecture.** Trust is reassessed in place on the existing version; Evidence is new rows appended to the existing version. Neither ever triggers Module 2's content-versioning machinery.
2. **"Verification stage" scope.** The request's "Represent... Verification stage" and "Reject... invalid verification states" named a term `MODULE_3_BRAIN_GRAPH_AND_REASONING.md` §9 defines as exactly Module 3 §4's full Idea→Draft→Review→Approved→Published→Archived→Retired lifecycle — explicitly deferred to "Brain Modules 8–9" per Module 1's own documented scope, and not yet reached in the roadmap. **Resolved: omitted entirely from Module 4.** No verification-stage field exists on any Module 4 table; that dimension stays deferred exactly as already planned.

---

## Architecture

Three entities, three different mutability rules, each backed by its own table (matching §13's ER diagram, which shows Source and Trust as two independent one-to-one relationships off Version, not one merged record — directly reflecting this task's own "Trust and Source remain independent dimensions" instruction):

| Entity | Cardinality per version | Mutability |
|---|---|---|
| **Source** (`knowledge_item_sources`) | Exactly one, lazily created | **Immutable once recorded** — entity 5: "correcting a misattributed source requires a new version, not an edit to the source record" |
| **Trust** (`knowledge_item_trust`) | Exactly one (conceptually — see below), lazily created | **Mutable, reassessed in place** — entity 6: "the one entity... explicitly mutable" |
| **Evidence** (`knowledge_item_evidence`) | Zero or more | **Append-only** — entity 7: "superseding evidence is added, not edited over" |

None of the three tables are created automatically when a `knowledge_item_versions` row is created — this module makes **no modification to Module 2's version-creation code path**. A version nobody has ever assessed has zero rows in any of these three tables; `getTrustAssessmentForVersion` synthesizes an `{ trustTier: "unknown", revision: 0, source: null }` view for that case rather than requiring a materialized row — `MODULE_3_BRAIN_ARCHITECTURE.md` §5's "Unknown: an explicit, tracked gap" tier is exactly the right semantics for "not yet assessed," and this keeps Module 4 purely additive.

---

## Trust Model

The six-tier taxonomy from `MODULE_3_BRAIN_ARCHITECTURE.md` §5 — `verified | approved | observed | hypothesis | unknown | deprecated` — stored as a real Postgres enum (`trust_tier`), the same treatment as `knowledge_domain`/`relationship_type`: a closed, semantically fixed set, not an extensible classification.

Reused identically for a single evidence row's own trust (`knowledge_item_evidence.evidence_trust_tier`) — `MODULE_3_BRAIN_GRAPH_AND_REASONING.md` §3: "evidence trust is reassessed the same way a version's trust is," meaning the identical vocabulary, not a parallel one.

**What this module does NOT implement**, all explicitly reasoning-layer concerns per Module 3.1: same-tier-conflict detection/escalation (§5, §6), cross-tier Source Hierarchy resolution (§7), trust-through-`supersedes` propagation (§5's "the superseded version's trust tier is simultaneously stepped to Deprecated" — Module 3's `supersedes` relationship exists, but no code anywhere touches trust as a side effect of creating one; that wiring is deferred), confidence computation of any kind (§10).

---

## Source Hierarchy

The nine tiers from `marketing/LYNQ_BRAIN.md` §7, in rank order, stored as a real Postgres enum (`source_type`):

`founder_decision | official_documentation | client_approved | internal_documentation | meeting_notes | ai_generated_draft | external_research | open_internet_search | unverified`

Rank-based cross-tier conflict resolution is explicitly a reasoning-layer concern (§7, §10) — this module only stores which tier a version's content came from, plus optional free-text detail (`sourceDetail`, ≤500 chars — which named human, registered agent, import job, or external system specifically).

---

## Evidence Model

The five storable classes from `MODULE_3_BRAIN_GRAPH_AND_REASONING.md` §3 — `primary | supporting | weak | historical | conflicting` — a real Postgres enum (`evidence_class`). **Deliberately excludes "Missing"**, which that same table defines as "the explicit absence of evidence for a claim... a first-class, valuable output," a reasoning-time query *result*, never a row that could exist in this table.

Each evidence row carries its own `description` (≤2000 chars, the citation body), an optional `externalReference` (≤500 chars, a URL/document pointer), and its own independently-reassessable `evidenceTrustTier`.

**`evidence_trust_tier` and `is_stale` are real, storage-ready columns with no mutation path in this module.** Module 3.1 §3 describes both as reassessable ("evidence trust is reassessed... it is marked stale... never removed"), but this task's own Operations list names only creation and listing for evidence, not reassessment — adding that mutation later is a pure service-layer addition (new function + new route), not a schema change, when a later module actually needs it.

---

## Schema

### Enums
`trust_tier` (6 values), `source_type` (9 values), `evidence_class` (5 values) — see above.

### `knowledge_item_sources`
`id`, `organization_id`, `knowledge_item_id`, `knowledge_item_version_id` (UNIQUE — one per version), `source_type`, `source_detail` (nullable), `recorded_by_user_id`, `created_at`. **No `updated_at`** — a deliberate, structural signal of immutability, not just documentation.

### `knowledge_item_trust`
`id`, `organization_id`, `knowledge_item_id`, `knowledge_item_version_id` (UNIQUE — one per version), `trust_tier`, `revision` (optimistic-concurrency counter, default 1), `last_assessed_by_user_id`, `created_at`, `updated_at`.

### `knowledge_item_evidence`
`id`, `organization_id`, `knowledge_item_id`, `knowledge_item_version_id` (NOT unique — many per version), `evidence_class`, `description`, `external_reference` (nullable), `evidence_trust_tier`, `is_stale` (default `false`), `created_by_user_id`, `created_at`, `updated_at`.

### Tenant-safety: a two-hop composite FK chain

`knowledge_item_versions` (Module 2) has no `organization_id` column of its own — only `knowledge_item_id`. Rather than adding one (a modification to a completed module with no correctness justification), each of the three new tables carries its own `organization_id` *and* `knowledge_item_id`, denormalized specifically to anchor two composite FKs each:

1. `(knowledge_item_version_id, knowledge_item_id) → knowledge_item_versions(id, knowledge_item_id)` — proves the version genuinely belongs to the claimed item (reusing Module 2's own `knowledge_item_versions_id_item_unique`).
2. `(knowledge_item_id, organization_id) → knowledge_items(id, organization_id)` — proves the item genuinely belongs to the claimed organization (reusing Module 3's `knowledge_items_id_org_unique`).

Together these make a cross-organization Trust/Source/Evidence row structurally impossible to persist — the identical chained-composite-FK pattern `knowledge_relationships` (Module 3) already established, extended here without needing any new supporting constraint on an existing table.

---

## Migration

`drizzle/0008_shiny_wonder_man.sql` — purely additive: three new enum types, three new tables with all their constraints/indexes. No existing column, table, or row is altered or removed. All referenced constraints (`knowledge_item_versions_id_item_unique`, `knowledge_items_id_org_unique`) already existed from Modules 2 and 3, so — unlike Module 3's own migration — there was no same-file forward-reference ordering risk here.

**Applied and verified directly against the live database**, not merely `db:check` (which only verifies schema-file/journal metadata consistency, not that DDL actually executed against the database — the exact gap that caused Module 3's migration-application incident). As with Module 3, the `drizzle-kit migrate` CLI's interaction with this sandboxed environment did not reliably complete, so the migration was applied by executing each statement from the generated SQL file directly, in order, and then confirming via a live query that all three tables, all six composite FKs, and both unique constraints actually exist — not just that the migration tool believed they did.

Rollback: `DROP TABLE knowledge_item_evidence, knowledge_item_sources, knowledge_item_trust` and `DROP TYPE evidence_class, source_type, trust_tier` — no other module depends on real data in any of them yet.

---

## Authorization

**Superseded by Module 7** (`platform/docs/MODULE_5_BRAIN_MODULE_7_PERMISSIONS.md`): at the time this was written, both bars below were temporary organization-role stand-ins marked `TODO(Brain Module 7)`. They have since been replaced by real Brain-domain capability grants — `attachTrustMetadata` now requires the explicit `approve` capability at the exact scope (never substitutable by organization role or authorship), and `createEvidence` requires `edit_any_draft`, or `edit_own_draft` while the actor is the item's own author. The relative ordering described below (approve is a strictly higher bar than ordinary edit authority) is unchanged; only the mechanism — role vs. explicit grant — changed.

Two distinct bars, deliberately different:

- **`attachTrustMetadata` (Source + Trust) requires `requireBrainApproveAccess`** — the `approve` capability at this exact scope, never substitutable by authorship or any organization/workspace role. A workspace **manager** — who can freely edit that same item's content — is *not* sufficient by role alone; approving trust is a strictly higher bar than editing content, matching how real Domain Grants (§13 entity 12) are scoped by (Organization, Domain), never by Workspace.
- **`createEvidence` requires ordinary `requireBrainMutateAccess("update")`** — `edit_any_draft`, or `edit_own_draft` while the actor is the item's own author, the same bar as editing the item's content. Entity 7's own "Ownership: whoever performed the verification" is a broader set of people than whoever holds approve-level authority over the official trust tier.

**Workspace isolation is preserved identically for both.** `requireBrainApproveAccess` checks organization/workspace membership *and* the `approve` capability together — an actor with no explicit workspace membership of their own cannot reach a workspace-scoped item's trust data at all (a 404, identical to every other Brain workspace-content check), regardless of what capability grants they hold. The approve-level check only ever adds a *stricter* requirement on top of existing visibility, never a looser one. Proven directly by a test: an actor with no workspace membership is rejected with `TenantResourceNotFoundError`, and the identical actor *with* explicit workspace membership and an explicit `approve` grant succeeds.

Archived items are immutable for both: creating or reassessing trust, and creating evidence, both reuse the existing `KnowledgeItemArchivedViolationError` — no new error class, since it is the identical "archived items cannot be mutated" rule Module 1 already established.

---

## Concurrency

**Trust reassessment reuses Module 1's plain-integer `revision` pattern, not Module 2's version-number-via-pointer mechanism.** Module 2's mechanism exists specifically to protect *content* history (a chain of immutable versions); trust reassessment deliberately creates no content history at all — it is a single mutable row, so the simpler, older pattern is the correct fit, not a step backward.

`0` is the explicit sentinel for "I believe no assessment exists yet" (the first-ever attach). The entire attach-or-reassess operation is one atomic statement:

```sql
INSERT INTO knowledge_item_trust (..., trust_tier, revision, ...)
VALUES (..., $trustTier, 1, ...)
ON CONFLICT (knowledge_item_version_id) DO UPDATE
SET trust_tier = excluded.trust_tier, revision = knowledge_item_trust.revision + 1, ...
WHERE knowledge_item_trust.revision = $expectedRevision
RETURNING ...
```

A true first insert (no existing row) always succeeds regardless of `expectedRevision` — Postgres's `ON CONFLICT` `WHERE` clause only gates the `DO UPDATE` branch, never whether a conflict occurs. This is safe: a well-behaved caller can only ever have a non-zero `expectedRevision` by having previously read a real row, meaning a conflict *will* occur, meaning the guard *does* apply. Two concurrent first-attach calls (both passing `0`) are still fully serialized: one truly inserts; the other hits `ON CONFLICT`, evaluates `WHERE revision = 0` against the now-`revision = 1` row, and gets zero rows back — `TrustAssessmentConflictError`. Two concurrent reassessments against the same `expectedRevision` resolve identically. Both races are proven directly by `Promise.allSettled` two-writer tests.

**Source has no client-supplied concurrency token at all** — it doesn't need one. The insert is attempted directly; a genuine concurrent-first-attach race is caught via `knowledge_item_sources_version_unique`'s `23505` violation, and the loser re-reads whatever the winner actually recorded: if it matches what the loser tried to write, the call succeeds as a no-op (a benign race, not an error); if it differs, `SourceImmutableViolationError`. This is the same resolution a later, *non-racing* caller restating an unchanged source gets — the race case and the ordinary case share one code path, not two.

**Evidence has no concurrency concern at all** — every create is an independent new row; there is nothing to race over.

---

## Validation

| Rule | Enforcement |
|---|---|
| Invalid trust values | The `trust_tier` Postgres enum itself (proven by a direct-insert bypass test) |
| Invalid source types | The `source_type` Postgres enum itself (proven by a direct-insert bypass test) |
| Invalid verification states | N/A — this dimension does not exist in Module 4 (see "Contradictions resolved" above) |
| Evidence attached to archived items | Reuses the existing `KnowledgeItemArchivedViolationError` |
| Evidence pointing outside tenant boundaries | The two-hop composite FK chain, database-level (proven by direct-insert bypass tests for both trust and evidence), plus `resolveKnowledgeItemVersionForUser`'s existing cross-tenant `TenantResourceNotFoundError` at the application layer |
| An evidence class not in the five storable classes | The `evidence_class` Postgres enum itself (proven by a direct-insert bypass test) |
| A `sourceType` that changes from what's already recorded | `SourceImmutableViolationError` — an explicit rejection, never a silent overwrite or a silently ignored field |

---

## Audit events

Four new event types (`src/lib/audit.ts`): `knowledge_source_recorded` (fires exactly once per version, the moment Source is first written — structurally guaranteed by `recordSourceOnce`'s return value, which is `true` only for the call that actually created the row), `knowledge_trust_assessed` (fires on every successful attach *or* reassessment), `knowledge_trust_conflict` (a stale-`expectedRevision` attempt — never paired with a misleading `knowledge_trust_assessed` for the same call, proven directly by a test), `knowledge_evidence_created`.

No `knowledge_evidence_updated`/`_restored` — there is no mutation path to produce them. No `_viewed` events for any of the four, for the identical "no security signal beyond what denial/conflict events already capture" reasoning already applied to every other `_viewed` candidate in this codebase. A denied trust/evidence mutation reuses the existing `knowledge_access_denied` event (written inside `requireBrainApproveAccess`/`requireBrainMutateAccess`, unmodified) rather than a new denial event per module — the identical "don't duplicate the same underlying check's audit trail" reasoning Module 3 already established for relationships.

Metadata for all four events may include the item id, version number, trust tier (and, for `knowledge_trust_assessed`, the new revision), source type, evidence class, and workspace scope — **never** `source_detail`, evidence `description`, or `external_reference` (free text, the identical redaction rule already applied to every other free-text field in this codebase). Proven directly by tests asserting no audit row's metadata contains marker strings planted in those three fields.

---

## API routes

- `GET /api/organizations/{organizationId}/knowledge/{knowledgeItemId}/versions/{versionNumber}/trust` — combined Trust + Source view (200). Never 404 for "not yet assessed."
- `POST /api/organizations/{organizationId}/knowledge/{knowledgeItemId}/versions/{versionNumber}/trust` — attach or reassess (200). Body: `{ trustTier, expectedRevision, sourceType, sourceDetail? }`.
- `GET /api/organizations/{organizationId}/knowledge/{knowledgeItemId}/versions/{versionNumber}/evidence` — list, bounded/cursor-paginated (200).
- `POST /api/organizations/{organizationId}/knowledge/{knowledgeItemId}/versions/{versionNumber}/evidence` — create (201).

All four nested under Module 2's existing `.../versions/{versionNumber}/...` path structure, matching the established convention that trust/evidence key off a specific *version*, not just an item. Every route follows the exact established shape: identity only from the session cookie, Zod validation of path/query/body, delegates entirely to the domain service, the shared `{data}`/`{error}` envelope, no stack trace or SQL text ever in a response (verified by a test).

---

## A necessary gap-fill, not a scope expansion

The task's own Operations list names four operations ("attach trust metadata to a new version," "retrieve trust/evidence," "update trust... in place," "list evidence for a version") but never explicitly names "create evidence" as its own bullet. The Validation section, however, requires rejecting "evidence attached to archived items" and "evidence pointing outside tenant boundaries" — rules that are meaningless without a create path to enforce them against. `createEvidence` was implemented as the structurally necessary write operation the task's own Validation section presupposes, not as scope creep — evidence storage is explicitly in scope ("Represent: ... Evidence ..."), and a store with no write path would itself be exactly the kind of "fake functionality" this task warns against.

---

## Deviations (Module 1/2/3 code touched)

Two small, additive refactors to already-completed modules, both required to avoid duplicating business logic (not correctness fixes, but genuinely necessary to build Module 4 without re-implementing existing query logic a second time):

1. **`src/lib/brain/knowledge-item-versions.ts`**: extracted `resolveKnowledgeItemVersionForUser` (returns the raw version row, including its internal `id`) as the shared engine behind the existing, unchanged-in-behavior `getKnowledgeItemVersionForUser` (which still returns the public `KnowledgeItemVersionSummary`, still never exposing the raw id over HTTP). Module 4's `trust.ts`/`evidence.ts` need the real UUID as their tables' own FK target — something `getKnowledgeItemVersionForUser`'s public return shape deliberately never provided. Purely mechanical extraction; `getKnowledgeItemVersionForUser`'s own tests are unaffected.
2. No changes to `knowledge-items.ts`, `authz.ts`'s existing functions, or any Module 1–3 schema table. `authz.ts` gained a new function (`requireBrainApproveAccess`) but no existing function's behavior changed.

---

## Test coverage

- **`src/lib/brain/trust.integration.test.ts`** (real Neon database, 20 tests): synthesized unknown/unassessed view; cross-tenant 404; first-attach success; org-admin (not just owner) success; plain-member rejection; workspace-manager-without-org-admin rejection (approve authority stricter than edit authority); org-owner-without-workspace-membership rejection (workspace isolation preserved); org-owner-with-workspace-membership success; correct-revision reassessment success; stale-revision rejection with unchanged current state; source-immutability rejection with unchanged source row; idempotent same-source restatement; archived-item rejection; concurrent first-attach race; concurrent reassess race; database-level enum/cross-org bypass rejections; audit-event-count and no-leaked-sourceDetail checks; stale-reassess-writes-conflict-not-assessed check.
- **`src/lib/brain/evidence.integration.test.ts`** (real Neon database, 14 tests): successful creation; all five evidence classes; append-only accumulation (multiple rows, none overwritten); org-viewer rejection (read-but-not-write); workspace-member success (lower bar than trust); workspace-viewer rejection; archived-item rejection; cross-tenant rejection; database-level enum/cross-org bypass rejections; pagination bounds; audit-metadata redaction; no-update/no-delete structural check.
- **Route-level tests** (2 files, 10 tests): 401/403/400/409 (`trust_conflict`, `source_immutable`) on the trust route; 200 unknown-view GET; 401/400/201 on the evidence route; stack-trace/SQL-text leak check on list.
- **Migration verification**: every statement in `drizzle/0008_shiny_wonder_man.sql` applied in order against the real database and confirmed present (three tables, six composite FKs, two unique constraints) — see "Migration" above for why this was verified directly rather than trusting `db:check` alone.
- **Full regression**: `npm run test` (175/175, unaffected), `npm run test:integration` (443/443, run twice consecutively — both clean, no flakiness), `npm run test:a11y` (52/52, unaffected — no UI was introduced).
- **`npm run typecheck`, `npm run lint`, `npm run build`, `npm run db:check`**: all clean.
- **Database state after testing**: confirmed empty (`knowledge_items`, `knowledge_item_versions`, `knowledge_relationships`, `knowledge_item_sources`, `knowledge_item_trust`, `knowledge_item_evidence`) after the full suite.

---

## Rollback

`knowledge_item_evidence`, `knowledge_item_sources`, `knowledge_item_trust`, and their three enum types can all be dropped cleanly — no other module has shipped a real consumer of this data yet, and nothing in Modules 1–3 references these tables (the FK direction points only outward, from Module 4 toward the earlier modules, never the reverse).

---

## Acceptance criteria

- Every version can have exactly one current trust assessment, synthesized as `unknown` when none has ever been recorded, materialized as a real row on first assessment. ✅
- Every version can have zero or more evidence records, each independently classed and trust-rated. ✅
- Changing a trust tier produces a permanent, auditable record of the change (`knowledge_trust_assessed`), never a silent overwrite. ✅
- No cross-tenant Trust/Source/Evidence row can ever be persisted, at either the application or database level. ✅
- Trust reassessment and evidence creation are both privileged actions distinct from ordinary read access, with trust held to a strictly higher bar than evidence, matching the approved architecture's ownership descriptions for each entity. ✅
- No race condition can produce a duplicate revision, a lost update, or a corrupted source record. ✅

---

## Explicitly deferred capabilities

Reasoning of any kind (confidence computation, band assignment, freshness decay) — Module 3.1. Same-tier-conflict detection/escalation and cross-tier Source Hierarchy resolution — Module 3.1. Trust-through-`supersedes` propagation wiring. Evidence trust/staleness reassessment (columns exist; no mutation path yet). Verification stage / full item lifecycle — Modules 8–9, per this module's first resolved contradiction. Any UI (not requested; matches every prior Brain module's "no UI" scope).
