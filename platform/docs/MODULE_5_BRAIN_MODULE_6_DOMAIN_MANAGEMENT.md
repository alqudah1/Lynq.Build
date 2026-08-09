# Brain Module 6 — Domain Management

Implements Brain Module 6 on top of the approved Brain Modules 1–5. Adds a management layer around the eight fixed Brain domains Module 1 seeded as a Postgres enum — description, display ordering, ownership metadata, and a retirement flag — **without changing the identity of any existing Knowledge Item** and without introducing organization-configurable domains.

---

## A scope note, established before implementation began

`MODULE_5_BRAIN_IMPLEMENTATION_PLAN.md`'s own numbered "6. Domains (Management)" section describes something broader than this module builds: it centers on **`KnowledgeCategory`** — an extensible sub-classification entity living *inside* each domain, department-owned, with create/retire operations (`MODULE_3_BRAIN_ARCHITECTURE.md` §3, §13 entity 2). This request never mentions Category at all; its entire scope is the eight domains' own **metadata** (description, ordering, ownership, retirement), matching `MODULE_3_BRAIN_ARCHITECTURE.md` §13 entity 1, not entity 2.

Unlike the Module 5 numbering mismatch, this is not a contradiction requiring a stop: Module 1's own schema comment on `knowledgeDomainEnum` already explicitly anticipated exactly this narrower scope — "Module 6... adds department ownership and category management on top of this fixed set... a future `knowledge_domain_meta`-style table would key off this same enum." This module builds the `knowledge_domain_meta`-style table and department-ownership *field* that comment names; it does not build Category CRUD. **`KnowledgeCategory` remains entirely unimplemented and is explicitly deferred** — a future module can add it as its own table (`category_id` nullable on `knowledge_items`, per Module 1's own already-documented deviation) without touching anything this module built.

---

## Architecture

Two operations only, both read-only: `listDomains`, `getDomain`. No create, no update, no activate/deactivate — see "Authorization" below for why the task's own conditional language ("only if architecture permits") resolves to read-only here.

`knowledge_domain_metadata` references the existing `knowledge_domain` Postgres enum (Module 1) directly rather than redefining the eight identifiers in a new table — the enum remains the single source of truth for "what is a valid domain," and this table can only ever attach metadata to values that enum already recognizes. `knowledge_items.domain` is never touched, referenced by, or migrated by this module; every existing Knowledge Item keeps working, unchanged, against the identical identifiers it always used.

---

## Domain definitions

The eight domains' descriptions are quoted directly from `marketing/LYNQ_BRAIN.md` §2 (Core Principles), not paraphrased or invented:

| Order | Domain | Description (verbatim) |
|---|---|---|
| 1 | `identity` | Company, Brand, Vision, Principles. The most stable domain in the Brain... |
| 2 | `offerings` | Products, Services, Pricing, Design System. What the company actually sells... |
| 3 | `market` | Clients, Leads, Partners, Competitive Intelligence, Research... |
| 4 | `execution` | Projects, Tasks, SOPs, Engineering knowledge, Documentation... |
| 5 | `growth` | Marketing, Sales, Content... |
| 6 | `governance` | Legal, Finance, HR, Security. The domain with the least room for improvisation... |
| 7 | `capability` | AI Agents, Templates... |
| 8 | `wisdom` | Lessons Learned, Experiments, Retrospective knowledge... |

Display order matches this exact listed order, which is also `knowledgeDomainEnum`'s own declaration order in `src/db/schema.ts` — no reordering, no reinterpretation.

**Icons and colors were deliberately not implemented.** The task gated them behind "if approved by architecture," and neither `MODULE_3_BRAIN_ARCHITECTURE.md` nor `marketing/LYNQ_BRAIN.md` describes any visual/presentational property for domains at all — adding them would be inventing UI-layer data with no grounding in the approved documents, exactly the kind of fabrication this task warns against. If a future module needs them, adding nullable `icon`/`color` columns is a purely additive migration.

---

## Ownership metadata

`ownerDepartment` is a real, storage-ready column (grounded in entity 1's "Ownership: ... the mapped department") but is seeded as `NULL` for all eight domains. `MODULE_3_BRAIN_ARCHITECTURE.md` §15's Open Question #2 explicitly states the domain-to-department mapping is **"not confirmed, needs an explicit Founder's Office decision"** — the document even notes its own referenced "proposed mapping... sketched in §12's table" does not actually exist in §12 (that table maps domains to *future company modules*, not to *departments*). Seeding a fabricated mapping here would misrepresent unconfirmed data as settled fact. The column exists so a future migration can populate it the moment that Founder's Office decision is actually made, without a schema change.

---

## Active/inactive (retirement) state

Entity 1's own lifecycle text — "effectively permanent; a domain is retired, never deleted, if an organization's structure genuinely changes" — is a real, approved concept, represented here as `isRetired`/`retiredAt`, seeded `false`/`NULL` for all eight (none of LYNQ's domains are retired today). **No mutation path exists for either column in this module** — see "Authorization" below for why setting them safely requires an administrative authority this codebase does not yet have. The columns are genuinely representable (satisfying the task's Storage-section request) without a genuine, safe way to mutate them yet (correctly reflecting the task's Operations-section conditional, "only if architecture permits").

---

## Schema

### `knowledge_domain_metadata`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, PK, default random | |
| `domain` | `knowledge_domain` (Module 1's existing enum), UNIQUE | Reused directly, not redefined — the database itself refuses a 9th, unsupported identifier |
| `description` | `text`, not null | Quoted verbatim from `marketing/LYNQ_BRAIN.md` §2 |
| `sort_order` | `integer`, not null, UNIQUE | Deterministic display order; no two domains may claim the same position |
| `owner_department` | `text`, nullable | Unconfirmed for all eight rows (§15 Open Question #2) |
| `is_retired` | `boolean`, not null, default `false` | Storage-ready, no mutation path yet |
| `retired_at` | `timestamp with time zone`, nullable | Same |
| `created_at` / `updated_at` | `timestamp with time zone`, not null, default now() | |

**Global, not organization-scoped** — no `organization_id` column, no composite tenant-safety FK. This is a deliberate continuation of a choice Module 1 already made, not a new decision this module is making on its own authority — see "Deviations" below.

**Constraints**: `knowledge_domain_metadata_domain_unique` (one row per domain — the final guard against "duplicate identifiers"), `knowledge_domain_metadata_sort_order_unique` (the final guard against "invalid display ordering" colliding silently).

No changes to `knowledge_items`, `knowledge_domain`, or any other existing table or enum.

---

## Migration

Two migration files:

- **`drizzle/0009_flippant_weapon_omega.sql`** — purely additive: one `CREATE TABLE`, referencing the existing `knowledge_domain` enum inline. No FK to any other table (deliberately global — see above), so there was no cross-statement ordering risk of the kind that affected Modules 3 and 4's migrations.
- **`drizzle/0010_seed_domain_metadata.sql`** — a hand-written custom migration (`drizzle-kit generate --custom`) seeding the eight rows via `INSERT ... ON CONFLICT (domain) DO NOTHING`, making it idempotent and safe to re-run. Kept as its own migration, separate from the `CREATE TABLE`, matching the established "additive schema first, then a distinct data step" pattern from Module 2's backfill.

**Applied and verified directly against the live database**, not merely `drizzle-kit check` — the same discipline established in Modules 3–5, since `db:migrate`'s CLI interaction with this sandboxed environment has not reliably completed in this session in prior modules either. Each statement was executed directly, in order, and confirmed via live queries: the table and both unique constraints exist; the seed produced exactly eight rows, one per canonical domain, in the correct order; re-running the seed file a second time produced no duplicates (proving the `ON CONFLICT DO NOTHING` idempotency directly, not just asserting it).

**Referential integrity was verified positively, not just assumed**: a real organization was created and a real Knowledge Item was successfully created against every one of the eight domains *after* this migration, proving `knowledge_items.domain` and its existing enum constraint are completely unaffected.

---

## Authorization

**Read-only.** `listDomains`/`getDomain` require only authentication — this data has no tenant dimension (identical reasoning to Brain Module 5's Source Hierarchy routes), so both routes live outside `/api/organizations/{organizationId}/...`, at `/api/brain/domains`.

**No mutation operation was implemented, and this is a deliberate, load-bearing decision, not an oversight.** The task's own instruction — "mutation only for the approved administrative role... if they remain immutable, implement read-only services only" — presupposes an "approved administrative role" capable of safely governing a **global** mutation. No such role exists anywhere in this codebase: every authorization primitive built in Modules 1–5 (`organization_role`, `workspace_role`, `requireBrainMutateAccess`, `requireBrainApproveAccess`) is scoped to *one specific organization*. Entity 1 itself names the real authority as "Founder's Office" — a concept with no equivalent anywhere in the actual, implemented system.

Borrowing an organization-scoped role (e.g., "any organization owner/admin") to gate a **global** mutation would be a genuine security/integrity defect, not a reasonable temporary stand-in: it would let any single organization's admin silently change metadata every other organization sees. Unlike Module 4's `requireBrainApproveAccess` (a sensible temporary stand-in for an *org-scoped* privileged action, because a real org-scoped role already existed to borrow), there is no equivalently safe stand-in for a *global* one — inventing one would itself be exactly the kind of fabricated, placeholder authorization this task's engineering rules prohibit.

The task's own text explicitly anticipates and sanctions this outcome ("if they remain immutable, implement read-only services only"), so this module takes that path rather than inventing an unsafe check. `updateDomainMetadata` and activate/deactivate are consequently **not implemented in this module** — see "Deviations" below.

---

## Validation

| Rule | Enforcement |
|---|---|
| Duplicate identifiers | `knowledge_domain_metadata_domain_unique`, database-level (proven by a direct-insert bypass test) |
| Invalid metadata | N/A in practice — there is no mutation path through which a caller could submit metadata at all; the only write is the one seed migration, whose content is fixed and verified by tests |
| Invalid display ordering | `knowledge_domain_metadata_sort_order_unique`, database-level (proven by a direct-update bypass test) |
| Attempts to delete mandatory domains | N/A — there is no delete function or route anywhere in this module; the eight rows are permanent |
| Attempts to create unsupported domains | The `knowledge_domain` Postgres enum itself, database-level (proven by a direct-insert bypass test with an invalid domain string) |

---

## Operations

- **`listDomains`** — all eight, in display order.
- **`getDomain`** — one domain's metadata, resolved against the fixed `KnowledgeDomain` TypeScript union (an invalid identifier is rejected by Zod at the route boundary, 400, before this function is ever called).
- **`updateDomainMetadata`, activate/deactivate** — not implemented; see "Authorization" above.

The eight canonical identifiers are never renamed or removed anywhere in this module — they are referenced, read-only, exactly as Module 1 defined them.

---

## Audit

**No new audit events.** Every operation in this module is a read; the one write this module performs (the seed migration) is a one-time, non-request-triggered, ops-level action, not something an authenticated actor invokes — there is nothing here resembling the "meaningful domain-management event" the task asks to audit, because no domain-management mutation exists yet to produce one. If `updateDomainMetadata`/retirement mutation is added by a future module once a real administrative authority exists, that is the point at which real audit events (e.g. `knowledge_domain_metadata_updated`, `knowledge_domain_retired`) become meaningful and should be added alongside it.

---

## Test coverage

- **`src/lib/brain/domains.integration.test.ts`** (real Neon database, 9 tests): all eight domains returned in order with no fabricated `ownerDepartment`; correct metadata per domain; a verbatim-description spot check; **referential integrity** — a real Knowledge Item successfully created against every one of the eight domains after this migration; database-level bypass rejections for duplicate domain, colliding sort order, and an unsupported domain string; migration idempotency (re-running the seed file produces no duplicates).
- **Route-level tests** (1 file, 4 tests): 401/200 for list; 400/200 for get-one.
- **Full regression**: `npm run test` (188/188, unaffected), `npm run test:integration` (468/468 — 456 prior + 12 new, run twice consecutively, no flakiness), `npm run test:a11y` (52/52, unaffected).
- **`npm run typecheck`, `npm run lint`, `npm run build`, `npm run db:check`**: all clean.
- **Migration verification**: both migration files applied and verified directly against the live database (see "Migration" above).
- **Database state after testing**: confirmed empty for every transient Brain table; `knowledge_domain_metadata` confirmed to hold exactly its permanent eight seed rows (never zero, never more).

---

## Rollback

`DROP TABLE knowledge_domain_metadata` — no other table references it (no FK points *at* it from anywhere), and no other module depends on it yet. `knowledge_items` and every other existing table are completely unaffected; reverting this module removes domain-metadata capability while leaving every Knowledge Item, and Module 1's original `knowledge_domain` enum, completely intact.

---

## Acceptance criteria

- The eight canonical domain identifiers are never renamed, removed, or reinterpreted. ✅
- Every existing Knowledge Item continues referencing the same identifiers, unaffected — proven positively, not assumed. ✅
- No 9th, unsupported domain can ever be represented, at the database level. ✅
- No duplicate metadata row or colliding display order can ever be persisted, at the database level. ✅
- Domains remain global, not organization-configurable — consistent with Module 1's existing implementation and the task's own "do not make organization-configurable unless the architecture explicitly requires it" instruction. ✅
- No unsafe or fabricated administrative authorization was introduced to support a mutation this codebase cannot yet safely govern. ✅

---

## Deviations

1. **`KnowledgeCategory` remains unimplemented** — the implementation plan's own "6. Domains (Management)" section's Category-CRUD scope is deferred in full; see "A scope note" above.
2. **No mutation operations** (`updateDomainMetadata`, activate/deactivate) — the task's own conditional language ("only if architecture permits") resolves to "no," because no safe, non-fabricated administrative authorization exists for a global mutation in this codebase today; see "Authorization" above.
3. **No icons or colors** — never described anywhere in the approved architecture; adding them would be fabricating presentational data with no grounding.
4. **`ownerDepartment` is null for all eight rows** — the confirmed mapping does not exist anywhere in the approved documents (§15 Open Question #2 is explicitly unresolved); the column is real and ready, the values are honestly absent rather than invented.
5. **Domains remain global, not organization-scoped**, despite entity 1's literal "instantiated per organization" text — a continuation of Module 1's own already-shipped simplification (a global enum), not a new resolution of `MODULE_3_BRAIN_ARCHITECTURE.md` §15's Open Question #1, which remains formally unresolved at the architecture level.
