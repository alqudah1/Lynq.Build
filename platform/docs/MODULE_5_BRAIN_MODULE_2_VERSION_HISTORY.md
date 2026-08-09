# Brain Module 2 — Immutable Version History

Implements Module 2 of `platform/docs/MODULE_5_BRAIN_IMPLEMENTATION_PLAN.md`, on top of the approved and hardened Brain Module 1 (`MODULE_5_BRAIN_MODULE_1_CORE_STORAGE.md`). Adds immutable version history to knowledge items: every content-changing write now creates a new version rather than overwriting one in place. **Not later Brain modules** — no relationships, trust scoring, sources, domain-management UI, real permissions, search, retrieval, citations, observations, decisions, agent APIs, embeddings, or UI exist yet.

---

## Stable item vs. immutable version — responsibilities

Two tables now share what Module 1 put entirely on `knowledge_items`:

- **`knowledge_items`** — the stable identity and tenancy record only: which organization/workspace it belongs to, its lifecycle `status`, its original author, and a pointer (`current_version_id`) to whichever version is currently current. Never holds content.
- **`knowledge_item_versions`** — the immutable content history: `title`, `content`, `classification`, who wrote that specific version, an optional change reason, and a per-item sequential `version_number`. Every content-changing write inserts a new row here; no row is ever updated or deleted by any code path in this module.

**`domain` stays on `knowledge_items`, deliberately NOT versioned** — this is a deviation from Module 1, which originally allowed changing `domain` via `updateKnowledgeItem`. `MODULE_3_BRAIN_ARCHITECTURE.md` §10 treats Domain as the Brain's permission/ownership boundary (Module 7's future `DomainGrant`s are domain-scoped), a structural fact about the item, not content the way title/content/classification are. Reclassifying an item's domain is now unsupported by any endpoint in this module — deferred to a future, more carefully-authorized operation once Module 7's real grants exist to govern it.

**`revision` (Module 1's lightweight optimistic-concurrency counter) is removed** from `knowledge_items` — `knowledge_item_versions.version_number`, resolved through `current_version_id`, is the concurrency token now. Keeping both would have been exactly the "duplicated mutable content" this design is built to avoid; there is one source of truth for title/content/classification, and it is always the current version row.

---

## Schema

### `knowledge_item_versions` (new table)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK, default random | Never exposed to clients — see "Version metadata exposed" below |
| `knowledge_item_id` | `uuid`, not null, FK → `knowledge_items.id` (cascade) | |
| `version_number` | `integer`, not null | Per-item sequence: 1, 2, 3, ... — never a global sequence |
| `title` | `text`, not null | |
| `content` | `text`, not null | |
| `classification` | `text`, not null, CHECK-constrained | Moved here from `knowledge_items` — carries the identical CHECK constraint Module 1's hardening pass added |
| `created_by_user_id` | `uuid`, nullable, FK → `users.id` (`set null`) | Who wrote *this version's* content — may differ per version from the item's stable `author_user_id` (e.g. an owner/admin correcting someone else's draft) |
| `change_reason` | `text`, nullable | Nullable at the schema level (a routine edit isn't always required to explain itself); the **service layer** makes it mandatory for restore/rollback specifically |
| `created_at` | `timestamp with time zone`, not null, default now() | |

**Constraints:**
- `knowledge_item_versions_id_item_unique` — `UNIQUE (id, knowledge_item_id)`, enabling the composite FK from `knowledge_items.current_version_id` below.
- `knowledge_item_versions_item_version_unique` — `UNIQUE (knowledge_item_id, version_number)` — the actual, final concurrency guard (see "Concurrency" below).
- `knowledge_item_versions_classification_check` — identical CHECK constraint to Module 1's, relocated here.

**Index:** `knowledge_item_versions_item_idx` on `(knowledge_item_id, version_number)` — the default history-listing query.

### `knowledge_items` (changed)

| Column | Change |
|---|---|
| `title`, `content`, `classification`, `revision` | **Removed** — moved to `knowledge_item_versions` (`classification`) or replaced by it (`title`/`content`/`revision`) |
| `current_version_id` | **New**, `uuid`, nullable. Nullable only because of insertion order (a new item is inserted first with this `NULL`, then its first version, then this pointer is set) — never null in practice once creation completes |

**New constraint:** `knowledge_items_current_version_fk` — composite FK `(current_version_id, id) → knowledge_item_versions(id, knowledge_item_id)`. This is the tenant-safe guarantee for version history, mirroring the existing `knowledge_items_workspace_org_fk` pattern exactly but in the opposite direction: the database itself physically cannot store a `current_version_id` that belongs to a *different* item's version history. A version row can only ever become "current" for the exact item it was created under — enforced at the database level, not just in application code.

Declaring `knowledge_item_versions` before `knowledge_items` in `src/db/schema.ts` was required to let the composite FK reference it directly (Drizzle's composite `foreignKey()` config is evaluated eagerly, unlike the single-column `.references(() => ...)` lazy-callback shorthand `knowledge_item_versions.knowledge_item_id` uses to point *back* at `knowledge_items` despite that table not being declared until after it). Two tables that reference each other always need exactly one direction expressed lazily; this is that arrangement.

---

## Migration and backfill

Two-stage migration, run against real (non-empty) pre-Module-2 data and verified before either stage was trusted:

1. **`drizzle/0005_perpetual_quasar.sql`** (additive only): creates `knowledge_item_versions` with all its constraints; adds the nullable `current_version_id` column and its composite FK to `knowledge_items`; relaxes `knowledge_items.classification`/`title`/`content`/`revision` to nullable (temporarily, so old rows remain valid while both shapes coexist).
2. **Backfill** (application-level, not a migration file): for every existing `knowledge_items` row with `current_version_id IS NULL`, one atomic `WITH new_version AS (INSERT INTO knowledge_item_versions (...) VALUES (...) RETURNING id) UPDATE knowledge_items SET current_version_id = (SELECT id FROM new_version) WHERE id = ...` per item — preserving that item's exact prior `title`/`content`/`classification`/`author_user_id`/`created_at`, with `change_reason` set to `'Backfilled from Module 1 during the Module 2 migration'`. Idempotent (only processes rows where the pointer is still `NULL`), so safe to re-run.
3. **`drizzle/0006_kind_edwin_jarvis.sql`** (subtractive only, run only after backfill success is confirmed): drops `knowledge_items.classification`/`title`/`content`/`revision`.

**Why two migrations, not one**: generating the full desired schema change (additive parts and column removal) in a single `drizzle-kit generate` step triggered drizzle-kit's interactive rename-detection prompt ("was column X renamed to Y?"), which requires a TTY the sandboxed tooling environment doesn't have. Splitting into purely-additive-then-purely-subtractive avoided the prompt entirely and — independently of that constraint — is also exactly the staged sequence this module's own requirements describe (create table, backfill, then remove the now-redundant columns only after backfill succeeds).

**Verified against real seeded data, not an assumed-empty database**: three rows were seeded directly in the pre-Module-2 shape (one organization-scoped item, one workspace-scoped item, one archived item) before running the migration + backfill. After both stages, all three were confirmed fully queryable and correct through the new two-table schema (join through `current_version_id`), including the archived item's `status` surviving correctly. All three rows were version-1-only, `version_number = 1`, with their original title/content/classification intact.

**Rollback SQL and limitations**: reversing migration 0006 requires re-adding the four dropped columns as nullable, then backfilling them from each item's current version (`UPDATE knowledge_items ki SET title = kiv.title, content = kiv.content, classification = kiv.classification, revision = kiv.version_number FROM knowledge_item_versions kiv WHERE kiv.id = ki.current_version_id`) — this recovers only the *current* version's content per item, never the full history (versions 2+ have no home in the old single-row shape). Reversing migration 0005 further requires dropping `current_version_id`, its FK, and the `knowledge_item_versions` table entirely, which **permanently discards all version history** — there is no way to reverse past this point without data loss once more than one version has been created for any item. This is a one-way migration in practice; the rollback path exists only for the narrow window before any post-Module-2 edit has occurred.

---

## Current-version pointer

`knowledge_items.current_version_id` always references a version belonging to that exact item (enforced by the composite FK — never another item's version, at the database level, not just in application code). It is created, and every subsequent move, atomically with the version row it points to — see "Version creation" below for the single-statement mechanism that makes this true.

---

## Version creation (the shared atomic engine)

Every content-changing write — a plain update, or a restore — goes through one shared function, `createNextKnowledgeItemVersion` (`src/lib/brain/knowledge-items.ts`), which performs all of the following as **one Postgres statement** (a CTE cascade: a guarded `SELECT`, then a data-dependent `INSERT`, then a data-dependent `UPDATE`, chained so each later step only executes rows produced by the step before it):

1. Resolve the current version (join `knowledge_items` to `knowledge_item_versions` through `current_version_id`).
2. Validate `expectedVersionNumber` against it, **and** confirm the item is not archived — both in the same guarded `SELECT`'s `WHERE` clause. If neither holds, the `SELECT` (and everything chained after it) simply produces zero rows — no version is created, no pointer is touched.
3. Create the next immutable version — `INSERT ... SELECT gen_random_uuid(), item_id, current_version_number + 1, COALESCE(new_title, current.title), COALESCE(new_content, current.content), COALESCE(new_classification, current.classification), ...` — the `COALESCE` is what makes a **partial update** safe: any field the caller didn't provide falls back to the current version's own value, so an untouched field is never silently blanked.
4. Update the knowledge item's current-version pointer to the newly created version's id.
5. (The caller writes the audit event as a separate step — see "Audit events" below.)

Because this is a single statement, there is no window where a new version exists but the pointer hasn't moved, or vice versa — Postgres executes the whole cascade as one atomic unit.

**Zero rows returned** means either the `expectedVersionNumber` was stale, or (a rarer race) the item was archived between the caller's own read and this call. `updateKnowledgeItem`/`restoreKnowledgeItemVersion` treat both identically: `KnowledgeVersionConflictError` (409 `version_conflict`), "refresh and try again."

---

## Concurrency

**Chosen strategy: `version_number`, resolved through `current_version_id` — an explicit counter, not `updated_at` comparison.** Same reasoning Module 1 already established for `revision`: a timestamp comparison has real precision/clock-skew edge cases; an integer is unambiguous.

**Application-level guard**: the `WHERE ... AND kiv.version_number = expectedVersionNumber` clause in the CTE above handles the common, non-racing case — a caller with a stale token affects zero rows and gets a clean `KnowledgeVersionConflictError`.

**Database-level guard (the final one)**: `knowledge_item_versions_item_version_unique` on `(knowledge_item_id, version_number)`. For two truly concurrent updates that both read the same current version before either commits, both attempt to `INSERT` the same `(item_id, version_number)` pair; Postgres accepts exactly one and rejects the other with a `23505` unique violation. `createNextKnowledgeItemVersion` catches that specific error code and returns the identical "no rows" signal, so the caller sees the same `KnowledgeVersionConflictError` either way — there is no user-visible distinction between "your token was already stale" and "you lost a real race," because both mean the same thing to the caller: refresh and retry.

Proven directly by a real-database integration test that fires two concurrent `updateKnowledgeItem` calls (`Promise.allSettled`) against the same item and expected version: exactly one succeeds, one is rejected with `KnowledgeVersionConflictError`, and the resulting version rows are `[1, 2]` — no duplicate version numbers, no lost update, no orphaned pointer.

**Post-approval correctness fix (during Brain Module 3)**: the `isPostgresUniqueViolation` helper this section's database-level guard depends on originally checked only `err.code` directly, which is correct for the raw `@neondatabase/serverless` client but not for errors thrown by `db.insert()`/`db.execute()` (Drizzle wraps the real Postgres error in a `DrizzleQueryError`, with the actual code nested at `err.cause.code`). This module's own concurrency test happened not to expose the gap, because `updateKnowledgeItem`'s application-level `expectedVersionNumber` check almost always wins the race in practice, masking it. Fixed by extracting a corrected, shared `isPostgresUniqueViolation` into `src/lib/brain/db-errors.ts` (checking both shapes), now used by both this module and Module 3's `relationships.ts`. Full details, including how it was discovered, in `MODULE_5_BRAIN_MODULE_3_RELATIONSHIPS.md`'s "Deviations" section. Re-verified: this module's full test suite, including the concurrency test above, still passes unchanged against the corrected helper.

---

## Version numbering

Deterministic, per-item: 1, 2, 3, ... Enforced unique via `(knowledge_item_id, version_number)`, **never** a global auto-increment — a global sequence would leak cross-item ordering information and wouldn't make sense as a user-facing "version 3 of this item" label. Proven directly by a test creating two independent items and confirming each has its own version 1, and by a test confirming a version number that belongs to one item is a 404 when requested against a different item.

---

## Immutability

No `PATCH`/`DELETE` route exists for version rows, and no `updateKnowledgeItemVersion`/`deleteKnowledgeItemVersion` function exists anywhere in `src/lib/brain/knowledge-item-versions.ts` — verified directly by a test that imports the module and the version routes and asserts those names are all `undefined`. **Enforced by application architecture** (the absence of any mutating code path), not a database trigger or a permissions rule — judged the smallest robust mechanism sufficient for this module's actual risk: there is no route, no service function, and no internal helper anywhere in this codebase that issues an `UPDATE` or `DELETE` against `knowledge_item_versions`. Correction always means a new version (a plain edit) or an explicit restore (copying an older version's content into a brand-new version) — never rewriting history.

---

## Historical reads

`src/lib/brain/knowledge-item-versions.ts`:

- **`listKnowledgeItemVersionsForUser`** — an item's complete version history, newest first, bounded and cursor-paginated (never offset-based).
- **`getKnowledgeItemVersionForUser`** — one version by its per-item `version_number`.
- **`getCurrentKnowledgeItemVersionForUser`** — convenience wrapper; the current version is just the highest-numbered one, already known once the parent item is resolved.

All three call `getKnowledgeItemForUser` first, meaning they enforce the **identical** tenant/workspace authorization as the parent item — organization membership, plus explicit workspace membership for workspace-scoped items, with no organization-role override, exactly as Module 1's hardening pass established. An inaccessible or nonexistent item is a 404 (`TenantResourceNotFoundError`) here too. A version number that doesn't exist on an otherwise-accessible item is **also** a 404, via the same `TenantResourceNotFoundError` — deliberately reused rather than a new error class, since it is the identical "don't distinguish nonexistent from inaccessible" reasoning already applied everywhere else in this codebase, now extended to version numbers: a caller can never learn how many versions an item has beyond what it can already read.

Routes:
- `GET /api/organizations/{organizationId}/knowledge/{knowledgeItemId}/versions`
- `GET /api/organizations/{organizationId}/knowledge/{knowledgeItemId}/versions/{versionNumber}`

---

## Update route behavior

`PATCH /api/organizations/{organizationId}/knowledge/{knowledgeItemId}` now creates a new version rather than overwriting the item. The request body's `expectedRevision` is renamed `expectedVersionNumber` (the client-facing concurrency token is unchanged in *kind*, only in what it's resolved through); `domain` is no longer accepted in this body at all (see "stable item vs. immutable version" above); an optional `changeReason` may be supplied for a plain edit (not mandatory — see "Immutability"/"Rollback" for where it *is* mandatory). The response is the composed current-item view, including the new `currentVersionNumber`.

---

## Rollback / restore semantics

Implemented as **creating a new version whose content copies a selected historical version** — never as moving the pointer backward. If the current version is v5 and a caller restores from v2, the result is a new v6 whose `title`/`content`/`classification` match v2 exactly, with `changeReason` recording the restoration. The original v2, v3, v4, v5 remain untouched, exactly as written — proven directly by a test asserting this.

- **Service**: `restoreKnowledgeItemVersion` (`src/lib/brain/knowledge-item-versions.ts`) — requires the same authorization as a plain update (current authority to update this item, via `requireBrainReadAccess` + `requireBrainMutateAccess`), the current concurrency token (`expectedVersionNumber`), and a mandatory, non-empty `changeReason` (validated by `changeReasonSchema`, 1–500 chars).
- **Route**: `POST /api/organizations/{organizationId}/knowledge/{knowledgeItemId}/versions/{versionNumber}/restore` — body `{ expectedVersionNumber, changeReason }`.
- **Archived items cannot be restored into** — `KnowledgeItemArchivedViolationError` (409 `item_archived`), the identical error a plain update on an archived item throws, since Module 1's approved lifecycle does not permit any content-changing write on an archived item, and a restore is a content-changing write.
- **A failed (stale) restore leaves the current version completely unchanged and creates no new version row** — proven directly by a test that attempts a restore with a stale `expectedVersionNumber` and confirms both the item's current version and the total version count are unaffected.

---

## Archive interaction

Archive remains a purely item-level lifecycle action (`archiveKnowledgeItem`, unchanged in shape from Module 1 apart from its concurrency token) — it **never creates a new content version** (there is no reason for archiving to touch content) and **never rewrites any historical version**. The current version stays current; all versions, including it, remain readable after archive, per Module 1's "archived items remain readable" rule — proven directly by a test that updates an item, archives it, and confirms its full two-version history is still listable.

---

## Version metadata exposed

The client-facing shape (`KnowledgeItemVersionSummary`): `versionNumber`, `title`, `content`, `classification`, `createdByUserId`, `changeReason`, `createdAt`, `isCurrent`. The version row's own internal `id` (its UUID primary key) is **never** exposed to any route or client component — the version number is sufficient to address it within its item (`.../versions/{versionNumber}`), matching this codebase's existing "don't expose unnecessary internal IDs where a natural key already works" instinct. `createdByUserId` is exposed as a raw UUID, not a resolved display name — consistent with every other Brain endpoint today (Module 1 exposes `authorUserId` the identical way); resolving display names is a UI-layer concern for a later module, not invented here.

---

## Authorization

`src/lib/brain/authz.ts` is **unchanged** for Module 2 — it operates purely on the composed access-check functions (organization membership + optional workspace membership + Brain-domain capability), which is identical regardless of whether the underlying content lives on one table or two. Every version-history and restore code path reuses the exact same `requireBrainReadAccess`/`requireBrainMutateAccess` functions.

**Superseded by Module 7**: at the time this was written, those functions were governed by a temporary organization/workspace-role stand-in marked `TODO(Brain Module 7)`. That stand-in has since been replaced by real Brain-domain permission grants (`platform/docs/MODULE_5_BRAIN_MODULE_7_PERMISSIONS.md`) — `restoreKnowledgeItemVersion` now requires `edit_any_draft`, or `edit_own_draft` while the actor is the item's own author, exactly like an ordinary update, never organization role.

---

## Audit events

Four new event types added to `AuditEventType` (`src/lib/audit.ts`): `knowledge_version_created`, `knowledge_version_restored`, `knowledge_version_conflict`. `knowledge_version_viewed` was considered and deliberately **not** added — identical "no security signal beyond what the denial/conflict events already capture" reasoning already applied to `knowledge_item_viewed`/`invitation_viewed` elsewhere in this file.

**Module 1's `knowledge_item_updated` is retired, not kept alongside the new events** — every content-changing update now *is* a version creation, so `knowledge_version_created` is what actually describes the write; there is no longer any code path that both changes content and is not a version creation. (`event_type` is a plain `text` column, never a database enum, so no migration was needed to make this change — historical rows using the old event name remain valid, they simply won't be produced going forward.)

Metadata for the new events may include: the item id, version number, previous version number, a bounded (≤500 char) change-reason summary, workspace scope, and domain — **never** `title` or `content`. Proven directly by a test that creates, updates, and restores an item with unique marker strings embedded in successive titles, then asserts no audit row's metadata contains any of them.

**A failed (stale) update or restore writes `knowledge_version_conflict`, never a misleading `knowledge_version_created`** — the success-audit call only happens after the atomic CTE cascade confirms a real row was returned; the conflict-audit call is a distinct branch. Proven directly by a test: one successful update followed by one deliberately stale update, asserting exactly one `knowledge_version_created` row and exactly one `knowledge_version_conflict` row exist afterward — never two success events, never zero conflict events.

---

## API routes (new)

- `GET /api/organizations/{organizationId}/knowledge/{knowledgeItemId}/versions` — list history (200), query params `cursor?`, `limit?`
- `GET /api/organizations/{organizationId}/knowledge/{knowledgeItemId}/versions/{versionNumber}` — one version (200)
- `POST /api/organizations/{organizationId}/knowledge/{knowledgeItemId}/versions/{versionNumber}/restore` — restore (200), body `{ expectedVersionNumber, changeReason }`

**Changed**:
- `PATCH /api/organizations/{organizationId}/knowledge/{knowledgeItemId}` — body now `{ expectedVersionNumber, title?, content?, classification?, changeReason? }` (was `expectedRevision`, plus `domain?`, now removed)
- `POST /api/organizations/{organizationId}/knowledge/{knowledgeItemId}/archive` — body now `{ expectedVersionNumber }` (was `expectedRevision`)

No route in this module issues a `PATCH` or `DELETE` against a version — verified directly by a structural test importing both version routes and asserting those exports are `undefined`.

---

## Test coverage

- **`src/lib/brain/knowledge-item-versions.integration.test.ts`** (new, real Neon database, 16 tests): version-1 existence and current-version resolution; sequential version creation with `COALESCE`-preserved untouched fields; the non-orphaned-pointer check (the item's `current_version_id` always resolves to a real, item-owned version row); bounded version-history pagination; the structural no-update/no-delete-path check; historical-version immutability under a later update; per-item version-number uniqueness across two independent items; cross-item version-number isolation (404); cross-tenant 404 for version history; explicit workspace-membership requirement for workspace version history; an org owner/admin without workspace membership rejected from restoring workspace content; archived-item history readability; restore-into-archived-item rejection; restore-creates-new-version (never rewinds, and the original versions stay untouched); a failed (stale) restore leaving the current version and version count unchanged; the concurrent-update race (`Promise.allSettled`, exactly one success/one conflict, no duplicate version numbers); and audit-metadata content redaction across create/update/restore.
- **`src/app/api/.../knowledge/{knowledgeItemId}/versions/route.integration.test.ts`** (new, real Neon database, 7 tests): 401 unauthenticated on list; list ordering and `isCurrent` correctness; 404 for a nonexistent version number; 200 with correct historical content and `isCurrent: false`; 400 on an empty `changeReason`; a full restore round-trip (200, correct content, `currentVersionNumber` advanced); 409 `version_conflict` on a stale restore.
- **Updated Module 1 / hardening-pass tests** (`knowledge-items.integration.test.ts`, `module1-hardening.integration.test.ts`, and the three existing knowledge-route test files) — every reference to `expectedRevision`/`revision`/`StaleRevisionError` updated to `expectedVersionNumber`/`currentVersionNumber`/`KnowledgeVersionConflictError`; the direct-database classification-bypass test moved to insert against `knowledge_item_versions` (where the column now lives); all pre-existing authorization/lifecycle/audit assertions preserved unchanged in *substance*, only in the storage shape they're asserted against.
- **Migration/backfill verification**: three rows seeded in the pre-Module-2 schema shape (org-scoped, workspace-scoped, archived), migrated through both migration files and the backfill script, verified correct via the new two-table schema, then cleaned up.
- **Full regression**: `npm run test` (175/175, unaffected), `npm run test:integration` (363/363, all passing), `npm run test:a11y` (52/52, unaffected — no UI was introduced or touched).
- **`npm run typecheck`, `npm run lint`, `npm run build`, `npm run db:check`**: all clean.
- **Database state after testing**: confirmed empty (`knowledge_items`, `knowledge_item_versions`, and all Brain-prefixed test organizations/users) after the full suite.

---

## Explicitly deferred capabilities

Unchanged from Module 1's list, apart from version history itself now being implemented: relationships/typed edges, trust scoring/evidence, source hierarchy, domain/category management UI, real Domain Grant/Access Override permissions, Review/Approval/Published/Deprecated/Retired/Purged lifecycle states, search/retrieval/citations, observation/decision-specific workflows, agent read/draft APIs, any dashboard UI, chunks/embeddings/vector storage/semantic indexing/attachment processing/rich collaborative editing.

Also explicitly out of scope for Module 2 specifically: version diffs/comparison rendering (only version *metadata* — number, author, timestamp, reason, current flag — is exposed; computing and presenting a diff between two versions is deferred), and any UI for browsing history or triggering a restore (this module is API- and service-layer only, matching Module 1's own "no UI" scope).
