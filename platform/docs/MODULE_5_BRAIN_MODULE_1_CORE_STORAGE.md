# Brain Module 1 — Core Knowledge Storage

> **Superseded in part by Brain Module 2 (Version History)** — see `platform/docs/MODULE_5_BRAIN_MODULE_2_VERSION_HISTORY.md`. `title`, `content`, `classification`, and the `revision` concurrency counter no longer live on `knowledge_items` — they moved to the new `knowledge_item_versions` table, resolved through `current_version_id`/`expectedVersionNumber`. This document is kept as-is for historical accuracy (it describes what Module 1 actually shipped and why), but its **Schema**, **Classifications**, **Concurrency**, and **APIs** sections below describe the pre-Module-2 shape — read Module 2's document for the current one. Everything else in this document (authorization matrix, lifecycle, archived-item semantics, audit-event redaction philosophy) is unchanged and still governs.

Implements Module 1 of `platform/docs/MODULE_5_BRAIN_IMPLEMENTATION_PLAN.md`, grounded in `platform/docs/MODULE_3_BRAIN_ARCHITECTURE.md`. The smallest durable Brain foundation capable of storing real knowledge inside an organization and optional workspace, usable end-to-end without any AI involvement. **Not the full Brain** — no version history, relationships, trust scoring, source hierarchy, domain/category management, real permissions, search, retrieval, citations, observations, decisions, or agent APIs exist yet. Those are later modules, unstarted.

---

## Deviations from the Module 3 / Module 5 architecture — reported, not silently decided

Two real narrowings were discovered while implementing this task's own explicit, detailed scope, both resolvable without any security or architectural contradiction. Reported here per the task's own instruction, rather than silently chosen:

1. **No `KnowledgeCategory` entity in Module 1.** Both `MODULE_3_BRAIN_ARCHITECTURE.md` §13 (entity 2) and `MODULE_5_BRAIN_IMPLEMENTATION_PLAN.md`'s own Module 1 sketch included `KnowledgeCategory` as part of "Core Knowledge Storage." This task's own explicit required-columns list for `knowledge_items` has no `category_id` at all, and its "Fixed domains" section only ever discusses the 8 domains, never categories. Resolution taken: `knowledge_items` references `domain` directly; no category table or column exists yet. This is forward-compatible exactly as the task requires — Module 6 ("Domains," per the roadmap) can add a nullable `category_id` column later as a purely additive migration, without rewriting `knowledge_items`.
2. **A minimal, two-state lifecycle inside Module 1**, rather than deferring all lifecycle to Modules 8/9 as the roadmap's own Module 1 sketch implied. This task's own required scope explicitly lists "Draft lifecycle state" and "Basic archive state" as Module 1 requirements, so a `status` column (`draft` | `archived`) was added now. This is **not** Module 3 §4's full `Idea → Draft → Review → Approved → Published → Archived → Retired → Purged` state machine — no Review, Approval, Published, Deprecated, or Purged state exists anywhere in this module, and none of their transition rules are implemented. Modules 8/9 extend the same Postgres enum additively (`ALTER TYPE ... ADD VALUE`) when they ship.

A minor **naming reconciliation**, not a deviation: this task's required column is named `classification`; `MODULE_3_BRAIN_ARCHITECTURE.md` §1 calls the same concept `knowledgeType`. This document and the code use `classification` throughout (the task's own literal, repeated spec), with this note as the only place the two names are explicitly tied together.

---

## Hardening pass (post-report review)

A conditional-approval review of the initial report correctly identified a real inconsistency: the original temporary policy required explicit workspace membership to **read** workspace-scoped knowledge, but allowed an organization owner/admin to **update or archive** the same item without any workspace membership at all — an override on the write side that didn't exist on the read side. This was fixed, and three further items were hardened in the same pass:

1. **Workspace-content authorization rebuilt so organization role is never consulted for any workspace-scoped action** — not just reads. See "Temporary Authorization Policy" below for the corrected, final matrix.
2. **Archived-item behavior confirmed and explicitly tested** — no change in actual behavior was needed here (it was already correct), but every rule is now proven by a dedicated test, not just implied by the absence of a restore/delete path.
3. **Classification gained a database-level CHECK constraint** (`knowledge_items_classification_check`), closing the gap where an invalid value could previously have been stored by anything that bypassed application-layer Zod validation (a direct insert, a future bulk import, a bug).
4. **Audit-metadata and misleading-event behavior confirmed by direct tests** — denied workspace-content mutations were already excluding title/content/session data; a stale-revision failure was already not producing a false-success event. Both are now proven, not just asserted.

Migration `drizzle/0004_smart_warbird.sql` (additive: one `ALTER TABLE ... ADD CONSTRAINT`) is the only schema change in this pass — no table was added, altered in shape, or dropped.

---

## Schema

### `knowledge_domain` (Postgres enum)

```
identity | offerings | market | execution | growth | governance | capability | wisdom
```

The 8 fixed Brain domains (`MODULE_3_BRAIN_ARCHITECTURE.md` §3) — "effectively fixed... Founder's Office only, and rarely" changed. Implemented as a real Postgres enum, matching this codebase's own existing convention for `organization_role`/`workspace_role`/`invitation_status` (fixed, core, rarely-growing sets get a DB enum; sets expected to grow casually stay free text). **Strategy for Module 6 forward-compatibility**: `knowledge_items.domain` never needs to change shape when Module 6 adds real domain/category management — a future `knowledge_domain_meta`-style table (department ownership, description) would key off this same enum, entirely additive.

### `knowledge_item_status` (Postgres enum)

```
draft | archived
```

Module 1's own minimal lifecycle — not Module 3's full state machine (see "Deviations" above). A real enum specifically because Postgres supports `ALTER TYPE ... ADD VALUE` additively; Modules 8/9 extend this same enum rather than needing a new column.

### `knowledge_items` (table)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK, default random | |
| `organization_id` | `uuid`, not null, FK → `organizations.id` (cascade) | Every item belongs to exactly one organization |
| `workspace_id` | `uuid`, nullable | No inline FK — the real constraint is the composite FK below |
| `domain` | `knowledge_domain`, not null | |
| `classification` | `text`, not null, CHECK-constrained | Deliberately **not** an enum — see "Classifications" below |
| `title` | `text`, not null | Max 200 chars, application-validated |
| `content` | `text`, not null | Max 20,000 chars, application-validated |
| `status` | `knowledge_item_status`, not null, default `draft` | |
| `author_user_id` | `uuid`, nullable, FK → `users.id` (`set null`) | Always populated at creation time by application code — nullable only so a removed user row doesn't break this table, matching `invitations.invited_by_user_id`'s exact precedent |
| `revision` | `integer`, not null, default 1 | Optimistic-concurrency counter — see "Concurrency" |
| `created_at` / `updated_at` | `timestamp with time zone`, not null, default now() | |
| `archived_at` | `timestamp with time zone`, nullable | Set only on archive |

**Constraints:**
- `knowledge_items_workspace_org_fk` — composite foreign key `(workspace_id, organization_id) → workspaces(id, organization_id)`, `ON DELETE CASCADE`. The exact pattern `invitations` already uses. The database itself physically cannot store an item whose workspace belongs to a different organization than the item's own `organization_id`.
- `knowledge_items_classification_check` — `CHECK (classification IN ('fact', 'instruction', 'policy', 'procedure', 'decision', 'observation', 'note', 'summary', 'template', 'prompt', 'reference'))`, added in the hardening pass. See "Classifications" below for the full justification.

**Indexes:**
- `knowledge_items_org_status_idx` on `(organization_id, status)` — the default active-listing query.
- `knowledge_items_org_workspace_idx` on `(organization_id, workspace_id)` — workspace-scoped listing and the unfiltered-list workspace-visibility computation.
- `knowledge_items_org_domain_idx` on `(organization_id, domain)` — domain-filtered listing.
- `knowledge_items_org_created_idx` on `(organization_id, created_at)` — cursor-pagination ordering.

**Expected query patterns**: (1) list an organization's draft items, optionally filtered by workspace/domain/classification, cursor-paginated by `(created_at, id)` descending; (2) fetch one item by id, scoped to an organization, with a follow-up workspace-membership check when workspace-scoped; (3) update/archive by id + `revision`, one atomic `UPDATE ... WHERE id = ? AND revision = ?`.

**Delete behavior**: `organization_id` cascades (deleting an organization removes its items — matches every other tenant-scoped table in this schema); `workspace_id` cascades via the composite FK (deleting a workspace removes its scoped items — but note organizations/workspaces in this codebase are soft-deleted via `deleted_at` in normal operation, so this cascade is a defense-in-depth backstop for the rare real-delete case, not the everyday path). `author_user_id` sets null. **No hard-delete path exists for `knowledge_items` themselves** — no `DELETE` route, no `deleteKnowledgeItem`/`hardDeleteKnowledgeItem` function anywhere in this module (verified by an explicit test).

**Scalability implications**: row-per-item, unbounded content up to 20,000 chars — a real durable format, not a placeholder. No chunking/embedding table exists yet (explicitly deferred to a later, separately-approved module per the roadmap's own Module 20). Index selection above was chosen for Module 1's actual query patterns, not speculatively — expected to be revisited once real usage volume exists, exactly as `MODULE_5_BRAIN_IMPLEMENTATION_PLAN.md`'s own "Performance Considerations" section anticipates for every early module.

---

## Fixed Domains

The 8 values above, seeded implicitly by the enum type itself (no seed data table — the enum *is* the fixed set). No domain CRUD, no organization-customizable domains, no category management exists in this module.

## Classifications

`fact | instruction | policy | procedure | decision | observation | note | summary | template | prompt | reference` — this task's own full worked-example list, adopted directly as the Module 1 seed set rather than an arbitrarily trimmed subset.

**Storage type and enforcement, exactly, after the hardening pass**: a plain `text` column, enforced at **two** layers — an application-level Zod allow-list (`KNOWLEDGE_CLASSIFICATIONS` / `knowledgeClassificationSchema`, `src/lib/brain/validation.ts`) for normal API traffic, **and** a database-level `CHECK` constraint (`knowledge_items_classification_check`) as a defense-in-depth backstop for anything that bypasses application validation entirely — a direct insert, a future bulk-import job, or a bug in a later module. Proven directly by a test that performs a raw `db.insert()` with an invalid classification string, bypassing every application-layer check, and asserts the database itself rejects it.

**Why a CHECK constraint, not a Postgres enum, and not a seeded reference table** (the three options considered):
- **Enum — rejected.** `MODULE_3_BRAIN_ARCHITECTURE.md` §3 explicitly describes this classification (`knowledgeType`) as "a separate, extensible classification" that should be addable without adopting a new fundamental type — unlike `domain`, which the same document calls "effectively fixed" and which correctly *is* a real enum. Converting `classification` to an enum would mean every future value needs `ALTER TYPE ... ADD VALUE`, with that statement's own historical restrictions (not always usable inside a transaction, depending on Postgres version) — a heavier, more type-committing operation than this field's own architecture calls for.
- **Seeded immutable reference table — rejected.** A `knowledge_classifications` table with one row per value would work, but risks exactly the trap this task warns against: it would start to look and behave like an early, informal version of `KnowledgeCategory` (Module 6) — a named, listable, potentially-extensible entity — inviting future confusion between "what kind of content is this" (classification) and "which department's finer-grained bucket does this belong to" (category). A CHECK constraint is structurally nothing like a table; there is no risk of it being mistaken for, or organically growing into, category management.
- **CHECK constraint — chosen.** Keeps the column's storage type as plain `text` (matching the "constrained but extensible" framing Module 3 asks for) while still giving the database a real, un-bypassable enforcement backstop today. Widening the allowed set later is a normal, single-statement additive migration (`ALTER TABLE knowledge_items DROP CONSTRAINT knowledge_items_classification_check, ADD CONSTRAINT ... CHECK (...)`) — no enum-type semantics, no version-dependent `ALTER TYPE` restrictions, and it says nothing whatsoever about, and never needs to change for, a future `category_id` column.

The application-layer allow-list and the database CHECK constraint's value list must be kept in exact sync by hand — both are documented, side by side, with a cross-reference comment in each file (`src/db/schema.ts` and `src/lib/brain/validation.ts`).

---

## Temporary Authorization Policy — SUPERSEDED by Module 7

**This entire section describes the temporary organization/workspace-role-based stand-in that shipped with Module 1. It has been replaced.** `platform/docs/MODULE_5_BRAIN_MODULE_7_PERMISSIONS.md` implements the real, explicit Brain-domain permission system (`brain_permission_grants`) the paragraph below originally anticipated — every function in `src/lib/brain/authz.ts` now resolves an actor's capability from a real grant row, never from organization or workspace role. The role-based rules described in this section (below this note) are historical context for how Module 1 originally worked, not the current behavior; see Module 7's own doc for the current authorization model and its migration-mapping table.

**Current rules (post-Module 7)**: every action below is now gated by an explicit Brain-domain capability grant (`read`/`draft_write`/`edit_own_draft`/`edit_any_draft`/`archive`), never by organization or workspace role — see `MODULE_5_BRAIN_MODULE_7_PERMISSIONS.md`'s own migration-mapping table for the exact old-role → new-capability translation for every operation named below. The role-based tables and reasoning that follow are preserved as historical context for how Module 1 originally shipped, not the current behavior.

<details>
<summary>Original text (superseded)</summary>

**Module 7 will introduce full Brain-domain permissions (`DomainGrant`/`AccessOverride`). Until then, `src/lib/brain/authz.ts` is an explicitly temporary stand-in** — marked with a `TODO(Brain Module 7)` in its own module-level comment, isolated in its own file (never merged into `src/lib/authz/helpers.ts`), and never presented as the Brain's real permission model. **This is the exact point Module 7 must replace**: every exported function in `src/lib/brain/authz.ts` (`requireBrainReadAccess`, `requireBrainCreateAccess`, `requireBrainMutateAccess`) needs a real `DomainGrant`/`AccessOverride`-backed equivalent; nothing calling into this file today should be assumed permanent.

**The initial report's policy had a real inconsistency, now fixed**: organization owner/admin was originally allowed to update/archive a workspace-scoped item without holding any workspace membership at all, while reading the same item correctly required it. The fix was not a narrow patch to update/archive alone — it makes organization role **entirely irrelevant to every workspace-scoped action**, full stop, so create/read/update/archive all follow one single, consistent rule for workspace content: only the actor's own explicit workspace role is ever consulted.

### Organization-scoped knowledge

| Action | Rule |
|---|---|
| **Create** | Organization role owner, admin, or member (**never** viewer) |
| **Read** | Any organization member (owner/admin/member/viewer) |
| **Update** | The item's own author (while the item is still `draft`), **or** an organization owner/admin |
| **Archive** | Organization owner/admin **only** — a plain member does not gain archive rights merely by being the author |

### Workspace-scoped knowledge — organization role is NEVER consulted for any of these

| Action | Rule |
|---|---|
| **Create** | Explicit workspace membership as manager or member (**never** workspace viewer) — organization role plays no part |
| **Read** | Explicit workspace membership, **any** role (manager/member/viewer) |
| **Update** | A workspace manager (any item in that workspace), **or** the item's own author — only while the item is still `draft` **and** the author currently holds explicit workspace membership as manager or member (never viewer) |
| **Archive** | A workspace manager **only** — never the plain author, and never an organization owner/admin who lacks workspace membership |

**No organization-administration override may expose or mutate workspace content, anywhere, for any action.** An organization owner/admin with no explicit workspace membership of their own has exactly the same access to that workspace's knowledge as a complete stranger — none — for reading, creating, updating, *and* archiving alike. This mirrors an existing, already-established precedent in this exact codebase (`getWorkspaceBySlugForUser`, Step 5A): workspace **content** access has no organization-admin override, unlike workspace **administration** (settings/membership pages). Knowledge items are content, so the same "no override" rule now applies consistently to every action, not only reads — confirmed directly by dedicated tests (`src/lib/brain/module1-hardening.integration.test.ts`) covering read, update, *and* archive for an org owner with no workspace membership.

A workspace **viewer** is read-only unconditionally, with **no exception for an item they themselves authored** before being demoted to viewer — proven directly by a test that creates an item as a workspace member, demotes that same user to viewer, and confirms they can still read but can no longer update it.

Every rule above still preserves, unconditionally: organization membership, explicit workspace membership, tenant isolation, server-side-only authorization, and zero trust of any client-supplied role or user identity — every check re-resolves the actor's real membership from the database on every call, exactly like every other domain service in this codebase. Proven directly by a route-level test that submits an extraneous `role` field in a create request body and confirms it is rejected outright by the strict Zod schema, never silently accepted or consulted.

</details>

---

## Lifecycle

Two states only: `draft` (the only state an item can be created in) and `archived` (terminal for Module 1). Archiving now requires a **higher** authority than updating (organization owner/admin, or workspace manager — never a plain author, at either scope; see "Temporary Authorization Policy" above for the full split).

## Archived-Item Behavior

Every rule below is now proven by a dedicated test, not just implied by the absence of other endpoints:

- **Archived items remain readable to authorized users when explicitly requested** — `getKnowledgeItemForUser` never filters by status; fetching an archived item by id succeeds identically to fetching a draft one, subject to the same read-access rules.
- **Archived items are excluded from default active listings** — `listKnowledgeItemsForUser`'s default `status` filter is `draft`; an archived item never appears unless `status: "archived"` is explicitly requested.
- **Archived items remain retrievable via an explicit `status=archived` list filter** — the same list function, filtered explicitly, does surface them.
- **Archived items cannot be edited** — `updateKnowledgeItem` throws `KnowledgeItemArchivedViolationError` (409 `item_archived`) unconditionally once `status === "archived"`, regardless of who's asking.
- **Archived items cannot be archived again as a new mutation** — `archiveKnowledgeItem` throws `KnowledgeItemAlreadyArchivedError` (409 `already_archived`) on a second attempt.
- **There is no restore operation in Module 1** — no `restoreKnowledgeItem`/`unarchiveKnowledgeItem` function exists anywhere in `src/lib/brain/knowledge-items.ts`, verified by an explicit test that imports the module and asserts both names are `undefined`. The approved architecture defines no restoration path for this stage, so none was invented.
- **There is no hard-delete operation** — no `DELETE` route, no `deleteKnowledgeItem`/`hardDeleteKnowledgeItem` function, verified the same way.

---

## Services (`src/lib/brain/knowledge-items.ts`)

- **`createKnowledgeItem`** — creates a Draft item; records `knowledge_item_created`.
- **`getKnowledgeItemForUser`** — resolves one item, enforcing organization membership + (if workspace-scoped) explicit workspace membership; a cross-tenant id and a missing workspace membership are both the identical `TenantResourceNotFoundError`.
- **`listKnowledgeItemsForUser`** — bounded, cursor-paginated (default limit 20, hard max 100), filterable by workspace/domain/classification/status (default `draft`). When unfiltered, never surfaces a workspace-scoped item the actor isn't an explicit member of — computed as "org-scoped items, plus items in any workspace this actor explicitly belongs to."
- **`updateKnowledgeItem`** — organization-scoped: author-or-owner/admin; workspace-scoped: workspace-manager-or-author-with-current-write-access (organization role never consulted); rejects updates to archived items; protected by optimistic concurrency (below).
- **`archiveKnowledgeItem`** — organization-scoped: organization owner/admin only; workspace-scoped: workspace manager only (never the plain author, at either scope); rejects a second archive attempt; also concurrency-protected.

No full-text or semantic search anywhere in this module.

## APIs

- `POST /api/organizations/{organizationId}/knowledge` — create (201)
- `GET /api/organizations/{organizationId}/knowledge` — list (200), query params `workspaceId?`, `domain?`, `classification?`, `status?`, `cursor?`, `limit?`
- `GET /api/organizations/{organizationId}/knowledge/{knowledgeItemId}` — fetch one (200)
- `PATCH /api/organizations/{organizationId}/knowledge/{knowledgeItemId}` — update (200), body requires `expectedRevision`
- `POST /api/organizations/{organizationId}/knowledge/{knowledgeItemId}/archive` — archive (200), body requires `expectedRevision`

Every route: reads identity only from the existing session cookie (`getAuthenticatedUser`), validates path/query/body with Zod, calls the domain service (never re-implements a rule), uses the shared `{data}`/`{error}` envelope, returns 404 for any cross-tenant or inaccessible resource, and never exposes a stack trace or SQL text (verified directly by a test asserting the response body never matches `/at Object|node_modules|SELECT |INSERT /i`).

## Pagination

Cursor-based (Module 2 §14's stated principle — "never offset-based"), keyset on `(created_at desc, id desc)`. Cursor is an opaque base64url-encoded `{createdAt, id}` pair. `limit` defaults to 20, clamps to a maximum of 100 server-side regardless of what's requested — verified directly by a test that requests `limit=1000` and confirms the returned page never exceeds 100.

## Concurrency

**Chosen strategy: an explicit integer `revision` counter, not an `updated_at` timestamp comparison.** Justification: a timestamp comparison has real precision/clock-skew edge cases (two updates landing within the same millisecond, or across a connection pool with slightly different clock views), while an integer counter is unambiguous and trivially reasoned about. Named `revision`, deliberately not `version` — this codebase's future Brain Module 2 ("Version History") will introduce a real, structurally different `KnowledgeVersion` history entity, and reusing the word "version" here would invite exactly the confusion `MODULE_3_BRAIN_ARCHITECTURE.md`'s own schema notes warn against.

Every update/archive is one atomic `UPDATE knowledge_items SET ... WHERE id = ? AND revision = expectedRevision RETURNING *`. A concurrent write that already advanced the revision causes this statement to affect zero rows; the caller receives `StaleRevisionError` (409 `stale_revision`) and must re-fetch and retry — never a silent overwrite. Proven directly by a real-database integration test: two sequential updates against the same stale `expectedRevision`, asserting the second is rejected and the stored title still reflects the first update only.

## Audit Behavior

Reuses the existing `audit_logs` table and `recordAuditEvent` helper (`src/lib/audit.ts`) — no parallel audit mechanism. Four new event types: `knowledge_item_created`, `knowledge_item_updated`, `knowledge_item_archived`, `knowledge_access_denied`. `knowledge_item_viewed` was deliberately **not** added — a routine authorized read carries no investigative signal beyond what `knowledge_access_denied` already captures for the cases that actually matter, the identical reasoning already applied to `invitation_viewed` in this same file.

Metadata is restricted to: item id, `domain`, `classification`, whether the item is workspace-scoped, and (for updates) which fields changed — **never** `title` or `content`. Verified directly by a test that creates/updates/archives an item with unique marker strings in its title and content, then asserts no audit row's metadata contains either marker.

---

## Test Coverage

- **Domain-service integration tests** (`src/lib/brain/knowledge-items.integration.test.ts`, real Neon database): 26 tests — creation authorization (owner/member/viewer/non-member, workspace manager/member/viewer), the "org membership alone never grants workspace-item access" rule (both directions), cross-tenant 404s, the application-layer and database-level workspace/organization mismatch rejections, domain/classification filtering, pagination bounds, the lost-update rejection, archive/already-archived/cannot-update-archived rules, the no-hard-delete-path structural check, audit-metadata content redaction, `knowledge_access_denied` recording, and the temporary-authz-module isolation check. Re-run in full after the hardening pass with zero changes needed — no existing test assumed the fixed override bug.
- **Hardening-pass integration tests** (`src/lib/brain/module1-hardening.integration.test.ts`, real Neon database, new): 17 tests — an org owner without workspace membership rejected on read, update, *and* archive of a workspace-scoped item; a workspace manager successfully updating and archiving another member's item; a plain workspace member correctly denied archive rights on their own item; an author demoted to workspace viewer still able to read but no longer able to update their own item; workspace-scoped creation proven to depend purely on workspace role (an organization viewer who is an explicit workspace member can still create); cross-tenant rejection reconfirmed post-hardening; the organization-scoped matrix's author-can-update-but-not-archive / owner-can-archive split; archived-item readability by direct fetch and by explicit `status=archived` filter; the no-restore-operation structural check; a direct-database insert with an invalid classification rejected by the new CHECK constraint; all 11 approved classifications accepted; a denied workspace-content mutation's audit metadata proven free of title/content/workspace-id/session-token substrings; and a stale-revision failure proven to write no additional, misleading `knowledge_item_updated` event.
- **Route integration tests** (three files alongside their routes): 17 tests — 401/403/404/400/409/201/200 status codes across create/list/get/update/archive, cross-tenant rejection, invalid domain/classification/title/content-length rejection, workspace-visibility enforcement at the HTTP layer, stack-trace/SQL-text leak checks on error responses, and (new) a client-supplied `role` field in a create request body rejected outright by the strict schema.
- **Full regression**: `npm run test` (175/175, unaffected), `npm run test:integration` (336/336, all passing — 318 prior + 18 new), `npm run test:a11y` (52/52, unaffected — no UI was introduced).
- **`npm run typecheck`, `npm run lint`, `npm run build`, `npm run db:check`**: all clean, both before and after the hardening pass's migration.
- **Manual verification** (initial Module 1 pass, prior to hardening): a real seeded organization (owner/member/viewer), workspace, and three real database-backed sessions were exercised against a live dev server — unauthenticated create (401), viewer create (403), owner create/list/get/update/stale-update(409)/archive/post-archive-listing round trip, workspace-scoped creation by an explicit workspace member, and confirmation that the organization owner (with no explicit workspace membership) receives 404 for that same workspace-scoped item both by direct id and in the unfiltered list. The hardening pass itself was verified entirely through the automated suite above (60 Brain-specific tests, all real-database integration tests, no mocks on the authorization path) rather than a second manual pass, since every scenario the hardening pass needed to prove was already expressible as a precise, repeatable assertion.

---

## Explicitly Deferred Capabilities

Nothing below exists in this module, by design, matching the roadmap's own module boundaries:

- ~~Version history, rollback, diffs (Brain Module 2)~~ — now implemented; see `MODULE_5_BRAIN_MODULE_2_VERSION_HISTORY.md`.
- Relationships / typed edges (Brain Module 3)
- Trust scoring, Evidence (Brain Module 4)
- Source Hierarchy / `KnowledgeSource` (Brain Module 5)
- Domain/category management UI, department ownership (Brain Module 6)
- Real Domain Grant / Access Override permissions (Brain Module 7)
- Review/Approval/Published/Deprecated/Retired/Purged lifecycle states (Brain Modules 8–9)
- Keyword search, retrieval composition, citation generation (Brain Modules 10–12)
- Observation/Decision-specific workflows beyond `classification` values (Brain Modules 13–14)
- Agent read/draft APIs (Brain Modules 16–17)
- Any dashboard UI (Brain Module 18) — none was built; none was requested
- Chunks, embeddings, vector storage, semantic indexing, attachment processing, rich collaborative editing (explicitly out of scope per this task, and per Brain Module 20)
