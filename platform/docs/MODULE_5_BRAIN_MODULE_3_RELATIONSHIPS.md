# Brain Module 3 — Relationships

Implements Module 3 of `platform/docs/MODULE_5_BRAIN_IMPLEMENTATION_PLAN.md`, on top of the approved Brain Modules 1 and 2 (`MODULE_5_BRAIN_MODULE_1_CORE_STORAGE.md`, `MODULE_5_BRAIN_MODULE_2_VERSION_HISTORY.md`). Adds typed, directed edges between stable Knowledge Items. **Storage and retrieval only** — no graph traversal, no multi-hop cycle detection, no relationship-based ranking or retrieval composition. Those are later modules (`#11` Retrieval, `#13`/`#14` Observation/Decision, Module 3.1's reasoning layer).

---

## Architecture

Every relationship is a row referencing exactly two **stable Knowledge Items** — never versions (`MODULE_3_BRAIN_ARCHITECTURE.md` §7 is explicit: relationships connect Items, not Versions). This means a relationship survives every future content edit to either endpoint without needing to move or be recreated — an item's identity, not any particular version of it, is what participates in the graph.

A relationship has no owning endpoint: `source` and `target` are two independent references, and neither item "owns" the edge more the way, say, a version belongs to its item. This shaped two real decisions:

- **Storage**: `knowledge_relationships` is its own table, not a column on either endpoint item.
- **API surface**: relationships get their own flat, top-level collection (`/api/organizations/{organizationId}/knowledge-relationships`), the same shape `invitations` already uses for an entity that references two other entities without being subordinate to either — while *listing* is naturally item-scoped (`GET .../knowledge/{knowledgeItemId}/relationships`), matching the task's own `listRelationshipsForItem` service name.

---

## Schema

### `relationship_type` (Postgres enum)

```
supports | contradicts | depends_on | supersedes | related_to | created_from | references | used_by | required_for
```

The fixed nine-type taxonomy from `MODULE_3_BRAIN_ARCHITECTURE.md` §7 — a real enum for the identical reason `knowledge_domain` is one (Module 1's own precedent): a closed, semantically fixed set with named side effects per type (`supersedes` carries a trust side-effect; each type has a specific directional meaning documented in §7's table), not an extensible allow-list the way `classification` is. A bypass attempt (a raw insert with an invalid type string) is rejected by Postgres's own enum type-cast — proven directly by a test.

### `knowledge_relationships` (table)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK, default random | |
| `organization_id` | `uuid`, not null, FK → `organizations.id` (cascade) | Duplicated from the endpoints (not derived transitively) specifically to anchor both composite tenant-safety FKs below — the same tradeoff `invitations.organization_id` already makes |
| `source_item_id` | `uuid`, not null | No inline `.references()` — the real constraint is the composite FK below |
| `target_item_id` | `uuid`, not null | Same |
| `relationship_type` | `relationship_type`, not null | |
| `creator_user_id` | `uuid`, nullable, FK → `users.id` (`set null`) | Provenance only — **never consulted for authorization** (see "Authorization" below) |
| `explanation` | `text`, nullable | Max 1000 chars, application-validated; optional — a `references` edge is often self-evident |
| `created_at` / `updated_at` | `timestamp with time zone`, not null, default now() | |
| `archived_at` | `timestamp with time zone`, nullable | Set only on archive |

**Constraints:**
- `knowledge_relationships_source_org_fk` / `knowledge_relationships_target_org_fk` — composite FKs `(source_item_id, organization_id) → knowledge_items(id, organization_id)` and the same for target. The database physically cannot store a relationship whose either endpoint belongs to a different organization than the relationship's own `organization_id`.
- `knowledge_relationships_no_self_link` — `CHECK (source_item_id <> target_item_id)`.
- `knowledge_relationships_active_edge_unique` — partial unique index on `(source_item_id, target_item_id, relationship_type) WHERE archived_at IS NULL`, the identical pattern `invitations_org_email_pending_unique` already establishes for "unique while active, re-creatable after archive."

**Indexes**: `knowledge_relationships_org_source_idx` / `knowledge_relationships_org_target_idx` on `(organization_id, source_item_id)` / `(organization_id, target_item_id)` — `listRelationshipsForItem` queries both sides via an OR, so both matter independently.

**Deliberately no `workspace_id` column.** A relationship's visibility is governed entirely by whether the actor can independently read *both* endpoint items (enforced in application code, not a column) — the two endpoints may legitimately belong to different workspaces within the same organization (e.g. a workspace-scoped item `depends_on` an org-wide policy item), which is not an error condition.

---

## Deviation: an additive change to `knowledge_items` (Module 1)

Adding the composite tenant-safety FKs above required a unique constraint on `knowledge_items(id, organization_id)` — Postgres requires a composite FK's target to be backed by an explicit unique constraint or index on exactly those columns, and no such constraint existed (only the single-column primary key on `id`). Added `knowledge_items_id_org_unique` — `UNIQUE (id, organization_id)` — to `knowledge_items`.

This is purely additive and behavior-preserving: `id` is already globally unique via the primary key, so `(id, organization_id)` is trivially unique too; the new constraint adds no real-world restriction, requires no data migration or backfill, and no existing Module 1/2 code path changes behavior. Per this task's "never modify completed modules unless a real correctness issue requires it, document it completely" instruction: this is that documented, justified exception, required by the composite-FK tenant-safety pattern Module 1 (`workspaces_id_org_unique`) and Module 2 (`knowledge_item_versions_id_item_unique`) already established for exactly this purpose.

---

## Deviation: a real bug found and fixed in Module 2's `isPostgresUniqueViolation`

While implementing `createRelationship`'s duplicate-edge rejection, a genuine latent bug surfaced in the `isPostgresUniqueViolation` helper `knowledge-items.ts` (Module 2) already used for its own concurrency guard (`createNextKnowledgeItemVersion`'s unique-violation catch): the check only inspected `err.code` directly, which is correct for errors thrown by the raw `@neondatabase/serverless` tagged-template client (`rawSql\`...\``, e.g. `organizations.ts`'s `createOrganization`), but Drizzle's query-builder methods (`db.insert(...)`, `db.execute(...)`) wrap the real Postgres error inside a `DrizzleQueryError`, with the actual `code` nested at `err.cause.code` instead. The old check silently never matched that shape.

This had not surfaced in Module 2's own tests because `updateKnowledgeItem`'s application-level `expectedVersionNumber` check almost always wins first in practice — the unique-constraint catch is only reached on a genuine, tightly-timed race, which Module 2's concurrency test happened not to hit. `createRelationship` has **no** application-level pre-check before its insert (an active-duplicate rejection is the *normal*, expected path for a repeat create, not a rare race), so every duplicate-creation attempt reliably exercised this exact gap, and the integration test failed with an unhandled `DrizzleQueryError` instead of `DuplicateRelationshipError`.

**Fixed** by extracting a single, shared, correctly-robust `isPostgresUniqueViolation` into a new file, `src/lib/brain/db-errors.ts`, which checks both `err.code` and `err.cause?.code` — used by both `knowledge-items.ts` (replacing its old, narrower local copy) and `relationships.ts`. This is a real correctness fix to a completed module, not a stylistic change: without it, Module 2's own "database constraints as the final concurrency guard" requirement was not reliably true under a genuine simultaneous race, only under the common non-racing case its application-level check already handled. Verified: Module 2's full test suite (integration + the two-writer concurrency test) still passes unchanged after the fix, and Module 3's duplicate-edge and concurrent-create tests now pass against the corrected helper.

---

## Deviation: a migration-tooling ordering bug, caught before it reached any real environment

The generated migration (`drizzle/0007_nappy_silvermane.sql`) originally placed `ALTER TABLE knowledge_items ADD CONSTRAINT knowledge_items_id_org_unique UNIQUE(...)` as its *last* statement, after the two composite FKs on `knowledge_relationships` that reference it — backwards; Postgres requires the referenced unique constraint to exist before a composite FK can target it. `drizzle-kit generate`'s own statement ordering got this cross-table dependency wrong. Caught during verification (statement-by-statement application failed with "there is no unique constraint matching given keys"), fixed by moving that one `ALTER TABLE` statement to immediately after the enum creation, before any `knowledge_relationships` DDL. The corrected file was verified by applying every statement, in order, against the real database and confirming the table, both composite FKs, the partial unique index, and the new `knowledge_items` constraint all exist. This migration was never applied anywhere before the fix (caught during this module's own verification pass, on the development database only), so no down-migration or repair path for a "live" broken deployment was needed.

---

## Migration

`drizzle/0007_nappy_silvermane.sql` — purely additive: one new enum type, one new table with all its constraints/indexes, and the one additive `knowledge_items` constraint above. No existing column, table, or row is altered or removed; no backfill is required (a fresh table with no prior data). Rollback is a clean `DROP TABLE knowledge_relationships`, `DROP TYPE relationship_type`, and `ALTER TABLE knowledge_items DROP CONSTRAINT knowledge_items_id_org_unique` — no other module depends on real data in this table yet.

---

## Authorization

Reuses `src/lib/brain/authz.ts` (`requireBrainReadAccess`, `requireBrainMutateAccess`) **unmodified** — no relationship-specific authorization concept exists beyond composing the existing item-level checks twice, once per endpoint.

- **Create** — MODULE_3_BRAIN_ARCHITECTURE.md §7's structural rule: "a relationship can only ever be created between two items the creating actor can currently see." Both `sourceItemId` and `targetItemId` are independently resolved via `getKnowledgeItemForUser` (the identical cross-tenant/workspace-membership gate every other Brain read uses) and then independently re-checked via `requireBrainReadAccess` — an item in a workspace the actor doesn't belong to fails here even if the *other* endpoint is perfectly visible. There is no single "can create a relationship" permission that covers both ends at once.
- **Archive** — `MODULE_3_BRAIN_ARCHITECTURE.md` §13 entity 8's exact rule: "removable by the same authority that could edit either endpoint item, subject to the same permission chain on *both* ends." Implemented as `requireBrainMutateAccess(..., "update")`, independently, on both endpoints — a workspace manager of the source's workspace who is only a plain member (and not the author) of the target's workspace is rejected, proven directly by a test.
- **The relationship's own `creator_user_id` is never consulted for authorization**, on either create or archive. Archive authority comes entirely from each endpoint's own item-level edit authority — not from "am I the person who created this specific edge." Proven directly by a test: the relationship's creator, once no longer the endpoint items' author-or-owner/admin, cannot archive their own created relationship.

A denied create or archive reuses the existing `knowledge_access_denied` audit event (targeting whichever endpoint item failed the check) — no new relationship-specific denial event exists, since the denial happens inside the exact same `getKnowledgeItemForUser`/`requireBrainMutateAccess` calls every other Brain mutation already uses.

---

## Visibility — "a relationship never grants visibility into the item on its other end"

§7's named risk, enforced structurally, not by convention, in every read path:

- **`getRelationshipForUser`** resolves the relationship, then independently calls `getKnowledgeItemForUser` for *both* endpoints — if either fails (cross-tenant, or workspace membership missing), the relationship itself is a 404, identical to a nonexistent one.
- **`listRelationshipsForItem`** resolves the anchor item first (proving the actor can see *that* one), then — for the returned page — determines each row's *other* endpoint and filters out any row whose other endpoint the actor cannot independently read. This is a **batched** check (one bulk query for all candidate other-item workspace scopes, one bulk query for the actor's own workspace memberships, then an in-memory filter), not an N+1 per-row `getKnowledgeItemForUser` call — proven directly by a test where an organization owner (no workspace membership) lists a visible org-scoped item's relationships and a workspace-scoped edge to content they cannot see is silently absent, while an explicit workspace member sees it.

**A filtered-out edge is never returned in a redacted form and never produces a 403** — it is simply absent, identical in spirit to how a workspace-scoped item the actor can't see is already absent from `listKnowledgeItemsForUser`'s results.

**Pagination tradeoff, explicitly reasoned about**: because the visibility filter runs *after* a bounded page is fetched from the database, a returned page may legitimately contain fewer than `limit` rows even when more candidates exist. The alternative — looping to backfill a full page after filtering — would require an unbounded number of extra queries whenever many edges point at content the actor can't see. `nextCursor` is computed from the last *fetched* row (not the last *visible* one), so pagination still continues correctly past filtered rows; a caller simply sees an occasionally shorter page, never a wrong one.

---

## Validation

Every rejection this task requires, and how each is enforced:

| Rule | Enforcement |
|---|---|
| Self-links | `SelfRelationshipViolationError` (409 `self_relationship`) at the service layer, plus `knowledge_relationships_no_self_link` CHECK constraint as defense-in-depth (proven by a direct-insert bypass test) |
| Duplicate active relationships | `knowledge_relationships_active_edge_unique` partial unique index is the real, final guard; the service attempts the insert directly (no separate pre-check `SELECT`, which would itself race) and translates a `23505` violation into `DuplicateRelationshipError` (409 `duplicate_relationship`) |
| Invalid relationship types | The `relationship_type` Postgres enum itself — a bypass insert with an invalid string fails Postgres's own type-cast (proven by a direct-insert bypass test) |
| Cross-organization relationships | Both composite FKs, database-level (proven by a direct-insert bypass test), plus `getKnowledgeItemForUser`'s existing cross-tenant `TenantResourceNotFoundError` at the application layer for the normal service-call path |
| Invalid workspace combinations | Not a separate rule or column — it reduces entirely to "the actor must independently pass the read-access check on both endpoints" (see "Authorization" above), which correctly handles every combination (org/org, org/workspace, workspace/workspace-same, workspace/workspace-different) without inventing a new concept |
| Archived-item mutations | Creating an edge touching an archived item reuses the existing `KnowledgeItemArchivedViolationError` (409 `item_archived`) — deliberately not a new error class, since it is the identical "archived items cannot be mutated" rule Module 1 already established, just triggered from a new call site |

### Cycle detection — deliberately not implemented here

`MODULE_5_BRAIN_IMPLEMENTATION_PLAN.md`'s own Module 3 section names "a cycle-detection test... per the exact policy chosen" as a required test, but `MODULE_3_BRAIN_GRAPH_AND_REASONING.md` (Module 3.1) §15 explicitly marks the cycle-handling *policy itself* as an **open, unresolved question** ("whether a detected cycle should also pause reasoning entirely versus just excluding the cyclic nodes is not [decided]"), and frames cycle detection as a **traversal-time** concern (§9/§13: "graph traversal... maintains a visited-node set and hard-stops on a repeat"). This task's own scope is explicit: "Do not implement graph traversal yet. This module only stores and retrieves edges." Any N-hop cycle check (A→B→C→A) unavoidably requires walking the graph, which this module is barred from doing.

Module 3 therefore enforces only the two invalidity rules above that require **zero traversal** (self-links, duplicate active edges) and does not attempt to detect or block cycles of any length, including a direct two-node mutual edge (e.g. A `supersedes` B and B `supersedes` A simultaneously active) — even though that specific case is arguably a logical self-contradiction for `supersedes` specifically. Inventing a bespoke rule for that one type would mean silently resolving an open architectural question the approved documents explicitly leave to Module 3.1's reasoning layer. Full cycle detection is deferred there, where the actual policy (block vs. flag, traversal depth bound) will be decided once, not piecemeal.

---

## Concurrency

**Duplicate-creation race**: no application-level "current state" token is needed (unlike Module 2's `expectedVersionNumber`) — the partial unique index is the complete guard for the one real race here ("did someone else just create the identical edge"). The service attempts the insert directly; on a genuine simultaneous race, exactly one of two concurrent inserts succeeds and the loser's `23505` is translated into `DuplicateRelationshipError`. Proven directly by a `Promise.allSettled` two-writer test.

**Double-archive race**: a single atomic `UPDATE knowledge_relationships SET archived_at = now() WHERE id = ? AND archived_at IS NULL` is the complete guard. Unlike an item or version, a relationship has no other mutable field to protect against a lost update — there is no `PATCH` route for relationships at all — so the binary "not yet archived" WHERE condition is itself sufficient; **no client-supplied concurrency token is requested or needed for archive**, a deliberate, reasoned departure from Module 1/2's `expectedRevision`/`expectedVersionNumber` pattern, justified by relationships having exactly one mutable dimension. Two concurrent archive attempts can only ever result in one success; the loser's `UPDATE` affects zero rows and receives the identical `RelationshipAlreadyArchivedError` a plain pre-check would produce. Proven directly by a `Promise.allSettled` two-writer test.

---

## Relationship Operations (`src/lib/brain/relationships.ts`)

- **`createRelationship`** — see "Validation" and "Authorization" above.
- **`listRelationshipsForItem`** — direct edges only (outgoing/incoming/both), bounded, cursor-paginated, other-endpoint-visibility-filtered. No graph traversal.
- **`getRelationshipForUser`** — one relationship by id, both-endpoints-visibility-checked.
- **`archiveRelationship`** — see "Authorization" and "Concurrency" above. Never a hard delete: no `DELETE` route and no `deleteRelationship`/`hardDeleteRelationship` function exist anywhere in this module, matching every other Brain entity's "archive, never erase" convention (verified by a structural test).
- **`restoreRelationship` — not implemented.** `MODULE_3_BRAIN_ARCHITECTURE.md` §13 entity 8 describes a relationship's lifecycle only as "can be removed... a correction, not a history-erasing act" — it never describes or requires restoring a removed edge, unlike, say, Module 2's version restore, which the architecture explicitly designs for. Per this task's own "restoreRelationship only if the architecture requires it" instruction, and matching Module 1's original "no restore for items either until an explicit later module adds one" precedent, this module ships without it. Re-creating an identical edge after archiving one is already fully supported (the partial unique index only blocks *active* duplicates), so the practical need this would serve is already met.

**Also factored out (Module 1 refactor, not new behavior)**: `getMemberWorkspaceIds(db, organizationId, actorUserId)`, extracted from `listKnowledgeItemsForUser`'s previously-inline "workspace ids this actor explicitly belongs to" query so `listRelationshipsForItem`'s other-endpoint visibility filter could reuse the identical logic rather than duplicating it — directly serving this task's "no duplicated business rules" requirement. Purely mechanical: the extracted function's body is byte-for-byte the same query `listKnowledgeItemsForUser` already ran inline; its own behavior and tests are unaffected.

---

## Audit events

Two new event types (`src/lib/audit.ts`): `knowledge_relationship_created`, `knowledge_relationship_archived`. No `knowledge_relationship_restored` (restore isn't implemented). No `knowledge_relationship_viewed`, for the identical "no security signal beyond what denial events already capture" reasoning applied to every other `_viewed` candidate in this codebase. No new relationship-specific denial event — a denied create/archive reuses the existing `knowledge_access_denied` event, targeting whichever endpoint item failed the check (see "Authorization" above).

Metadata may include the relationship id, both endpoint item ids, relationship type, and each endpoint's workspace-scoped-or-not — **never** `explanation` (free text, the identical redaction rule already applied to `title`/`content`/`change_reason` elsewhere in this file). Proven directly by a test that creates and archives a relationship with a unique marker string in `explanation` and asserts no audit row's metadata contains it.

---

## API routes

- `POST /api/organizations/{organizationId}/knowledge-relationships` — create (201). Body: `{ sourceItemId, targetItemId, relationshipType, explanation? }`.
- `GET /api/organizations/{organizationId}/knowledge/{knowledgeItemId}/relationships` — list for one item (200). Query: `direction?` (`outgoing`/`incoming`/`both`, default `both`), `relationshipType?`, `status?` (`active`/`archived`, default `active`), `cursor?`, `limit?`.
- `GET /api/organizations/{organizationId}/knowledge-relationships/{relationshipId}` — fetch one (200).
- `POST /api/organizations/{organizationId}/knowledge-relationships/{relationshipId}/archive` — archive (200). No request body.

Every route follows the exact established shape: identity only from the session cookie, Zod validation of path/query/body, delegates entirely to the domain service, the shared `{data}`/`{error}` envelope, 404 for any cross-tenant or invisible-endpoint relationship, no stack trace or SQL text ever in a response (verified by a test).

---

## Test coverage

- **`src/lib/brain/relationships.integration.test.ts`** (real Neon database, 27 tests): every one of the nine relationship types creatable; self-link rejection (service + database-level bypass); invalid-type rejection (database-level bypass, real enum); duplicate-active rejection, including the two-writer concurrency race; re-creation after archive; cross-organization rejection (service + database-level bypass); workspace-visibility rejection on create (including the "org owner without workspace membership" case); success across two different workspaces the actor belongs to both; archived-endpoint rejection; list direction filtering, archived/active status filtering, other-endpoint-visibility filtering, pagination bounds; cross-tenant and other-endpoint-invisible 404s for `getRelationshipForUser`; archive success, already-archived rejection, the two-writer archive-race, the both-endpoints-required-authority test, and the creator-is-not-sufficient-authority test; audit-metadata redaction; the no-hard-delete/no-restore structural check.
- **`src/app/api/.../knowledge-relationships/route.integration.test.ts`** (real Neon database, 9 tests): 401/400/201/409 (`self_relationship`, `duplicate_relationship`) on create; item-scoped list 200 with stack-trace/SQL-text leak check; 404 on a nonexistent relationship id; archive 200 and 409 `relationship_already_archived`.
- **Full regression**: `npm run test` (175/175, unaffected), `npm run test:integration` (398/398, run twice consecutively to rule out flakiness — both clean), `npm run test:a11y` (52/52, unaffected — no UI was introduced).
- **`npm run typecheck`, `npm run lint`, `npm run build`, `npm run db:check`**: all clean.
- **Migration verification**: every statement in the corrected `drizzle/0007_nappy_silvermane.sql` applied in order against the real database and confirmed present (table, both composite FKs, the partial unique index, the new `knowledge_items` constraint) — see "Deviations" above for the ordering bug this caught.
- **Database state after testing**: confirmed empty (`knowledge_items`, `knowledge_item_versions`, `knowledge_relationships`) after the full suite.

---

## Rollback

`knowledge_relationships` and `relationship_type` can be dropped cleanly (no other module has shipped a real consumer of this data yet); `knowledge_items_id_org_unique` can be dropped independently, though nothing forces its removal — it is harmless to leave in place even if `knowledge_relationships` itself were rolled back, since it merely restates an already-true fact about `id`'s uniqueness.

---

## Acceptance criteria

- All nine approved relationship types can be created and queried in both directions. ✅
- No cycle-storage-time invalidity that requires zero traversal (self-link, duplicate active edge) can ever be persisted. ✅ (Full cycle detection is explicitly, and for now permanently for this module, deferred to Module 3.1 — see "Cycle detection" above.)
- No cross-tenant edge can ever be persisted, at either the application or database level. ✅
- A relationship never grants visibility into an item the actor could not already read independently. ✅
- Archiving a relationship never mutates either endpoint item, and never rewrites relationship history — it can only ever move `archived_at` from `NULL` to a timestamp, once. ✅

---

## Explicitly deferred capabilities

Graph traversal of any kind (multi-hop walks, `depends_on`/`supports`/`related_to` expansion for retrieval — Module `#11`); cycle detection and its still-open policy (Module 3.1); relationship-based ranking or weighting; a UI for browsing or authoring the relationship graph (not required until Modules `#18`/`#19`); `restoreRelationship` (see "Relationship Operations" above); any notion of relationship *strength*, confidence, or provenance beyond the plain `explanation` text field (not part of the approved §7/§13 schema for this entity).
