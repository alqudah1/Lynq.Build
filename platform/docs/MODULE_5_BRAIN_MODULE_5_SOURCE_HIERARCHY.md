# Brain Module 5 — Source Hierarchy

Implements this session's "Brain Module 5," on top of the approved Brain Modules 1–4. Defines how the nine Source types (already stored by Module 4) are ranked and compared, providing the deterministic ordering primitive later reasoning modules will consume during conflict resolution. **Comparison only** — no conflict resolution, no reasoning, no trust scoring.

---

## A numbering note, resolved before implementation began

`MODULE_5_BRAIN_IMPLEMENTATION_PLAN.md`'s own numbered "5. Sources" section describes `KnowledgeSource` *storage* (source type, immutable-per-version) — and that work was **already completed** as part of Brain Module 4, because Source and Trust are tightly coupled (§13's ER diagram ties both to one version) and are submitted together through Module 4's `attachTrustMetadata` operation.

This session, also called "Brain Module 5," asked for something different: deterministic **rank-comparison** operations over the already-stored source types — a capability the original 20-module plan never assigned its own number to (the closest related concept, cross-tier conflict resolution using source rank, is explicitly Module 3.1's — the reasoning layer, a separate, later initiative).

Per this task's own instruction not to silently reinterpret prior decisions, this mismatch was raised and resolved with the user before any code was written: build the comparison utility now, under this session's "Module 5" label, while documenting plainly (here, and in `MODULE_5_BRAIN_IMPLEMENTATION_PLAN.md`) that the implementation plan's own numbered "5. Sources" section was already finished under Module 4.

---

## Architecture

Five operations, all read-only, over the fixed nine-tier hierarchy `MODULE_3_BRAIN_ARCHITECTURE.md` §7 and `marketing/LYNQ_BRAIN.md` §7 already define and Brain Module 4's `source_type` Postgres enum already stores:

- `listSourceHierarchy` — every tier, in rank order.
- `getSourceDefinition` — one tier's rank, label, and description.
- `compareSourceRanks` — given two source types, which outranks the other.
- `resolveSourceOrdering` — the higher-ranked of two source types, resolved deterministically.
- `validateSourceAssignment` — confirms a specific, already-recorded version's Source (Module 4) maps to a genuine hierarchy entry, and reports its rank.

The first four are pure functions over static data — no database access, no tenant context, nothing to authorize beyond being a logged-in user. Only `validateSourceAssignment` touches the database, because it resolves one specific organization's specific version.

---

## Hierarchy definition

Preserved exactly as approved — labels and descriptions quoted directly from `marketing/LYNQ_BRAIN.md` §7, not paraphrased or invented:

| Rank | `source_type` | Label |
|---|---|---|
| 1 | `founder_decision` | Founder decisions |
| 2 | `official_documentation` | Official company documentation |
| 3 | `client_approved` | Client-approved information |
| 4 | `internal_documentation` | Internal documentation and SOPs |
| 5 | `meeting_notes` | Meeting notes and informal records |
| 6 | `ai_generated_draft` | AI-generated drafts |
| 7 | `external_research` | External research |
| 8 | `open_internet_search` | Open internet search |
| 9 | `unverified` | Unverified information |

Rank 1 is the highest authority; rank 9 the lowest — matching §7's own stated order exactly, not inverted or re-derived.

---

## Ordering rules

Rank is a **strict total order** over the nine fixed types: every type has a unique integer rank, so `compareSourceRanks` returns `"equal"` **only** when comparing a type to itself — two distinct source types can never tie. This is deliberate, not an oversight, and it is the reason this module can honestly claim to do zero conflict resolution:

`MODULE_3_BRAIN_ARCHITECTURE.md` §5's "a same-tier conflict... is never resolved by trust math or by an agent picking one — it is escalated to the human" rule is about two items sharing the same **Trust tier** (Brain Module 4's six-value axis) — a genuinely different concept from Source rank. Because Source rank has no ties between distinct types, there is no "which one wins when they're equal" question for this module to answer, and therefore nothing resembling the escalation logic that concept requires. `resolveSourceOrdering` always returns a real winner for two distinct types — a plain, deterministic lookup, never a judgment call.

This module does **not** compose Source rank with Trust tier, Evidence, freshness, or anything else situational — that composition (§10's confidence gates) is Module 3.1's reasoning layer, explicitly out of scope here.

---

## Storage

**No new database table.** The hierarchy is fixed, company-wide policy — `marketing/LYNQ_BRAIN.md` §7 presents it as settled ranking, never as something organizations configure — with zero per-tenant variation and no write path, ever, after initial definition. A lookup table holding nine rows that can never change would offer no real benefit over an in-code constant and is exactly the kind of low-value, speculative table this task's own "Database: create only the schema required, no speculative tables" instruction warns against.

The nine-value `source_type` Postgres enum (Brain Module 4) already **is** the database-level representation of the valid set. `src/lib/brain/source-hierarchy.ts` adds the rank/label/description dimension on top of it as a plain, exported, `as const` TypeScript array (`SOURCE_HIERARCHY`) — the identical treatment already given to `KNOWLEDGE_CLASSIFICATIONS`/`RELATIONSHIP_TYPES`/`TRUST_TIERS`/`SOURCE_TYPES` in `src/lib/brain/validation.ts`.

No migration file was generated for this module — a deliberate, verified outcome, not an oversight (confirmed: `drizzle/0008_shiny_wonder_man.sql`, from Module 4, remains the latest migration; `drizzle-kit check` passes unchanged).

---

## Authorization

**Read-only throughout** — the task's own "if hierarchy is immutable, expose read-only operations" instruction, followed exactly: there is no `updateSourceHierarchy`/`createSourceHierarchyEntry`/any mutation function anywhere in this module, matching Module 4's identical "no `updateSource`" precedent for the immutable Source record itself.

- **`listSourceHierarchy`, `getSourceDefinition`, `compareSourceRanks`, `resolveSourceOrdering`** require only authentication — no organization-membership check at all. This is a deliberate departure from every other Brain route's `/api/organizations/{organizationId}/...` nesting: the data has zero tenant sensitivity (the same nine tiers, in the same order, for every organization), so gating it behind organization membership would add a check that protects nothing. These four routes live under a new, non-organization-scoped path: `/api/brain/source-hierarchy`.
- **`validateSourceAssignment`** reuses `resolveKnowledgeItemVersionForUser` (Module 2/4) unmodified, inheriting the identical cross-tenant/workspace-membership gate every other Brain read uses. It stays nested under the existing `/api/organizations/{organizationId}/knowledge/{knowledgeItemId}/versions/{versionNumber}/...` path.

---

## Schema

No schema changes. This module adds zero columns, zero tables, zero enums, zero constraints. It reads the existing `source_type` enum and `knowledge_item_sources` table (both Brain Module 4) without modification.

---

## Validation

| Rule | Enforcement |
|---|---|
| Invalid source types | The `SourceType` TypeScript union (compile-time) plus the reused `sourceTypeSchema` Zod validator (Module 4) at every route boundary — a request naming an unapproved type never reaches the service layer at all |
| Duplicate rankings | **Structurally impossible**, not runtime-checked — `SOURCE_HIERARCHY` is a single, code-reviewed, deploy-time constant with no write path a request could use to introduce a duplicate. Verified by a unit test asserting all nine ranks are unique, run on every build, not as a per-request guard |
| Cycles | **Not a meaningful failure mode for a strict integer total order** — a cycle would require a comparison relation that isn't transitive; unit tests prove antisymmetry (`a` higher than `b` implies `b` lower than `a`) and totality (every pair resolves) across all 81 ordered pairs of the nine types |
| Impossible ordering | Same reasoning — `resolveSourceOrdering` is proven, by exhaustive unit test over all 81 pairs, to always return a real winner |
| Tenant violations | Applicable only to `validateSourceAssignment` — enforced by reusing `resolveKnowledgeItemVersionForUser`'s existing tenant-scoped resolution unmodified; a cross-tenant version is a 404, identical to every other Brain read |

The "duplicate rankings / cycles / impossible ordering" rules are honestly reported here as **structurally prevented**, not **actively rejected at runtime** — there is no code path through which a caller could ever attempt to create a duplicate ranking or a cyclic comparison, since the hierarchy is immutable and defined once, in code. This is the same honest-scoping approach Brain Module 4 used for "verification stage": naming a validation rule that genuinely doesn't apply given the module's actual design, rather than inventing a check against an input shape that can't occur.

---

## Concurrency

No mutation exists anywhere in this module — every operation is a read, either over static in-memory data or an already-existing, already-immutable Module 4 record. There is nothing to race over, and nothing new to reconcile with prior modules' concurrency patterns.

---

## Audit

**No new audit events.** All five operations are reads; none creates, modifies, or archives anything. This matches the established, repeated precedent throughout Modules 1–4: a routine authorized read carries no security signal beyond what an access-denial event already captures, and none of these five operations can even produce an access-denial in the traditional sense (the four static operations require no authorization beyond login; `validateSourceAssignment`'s only failure mode is the existing, already-audited `TenantResourceNotFoundError`/`knowledge_access_denied` path inside `resolveKnowledgeItemVersionForUser`, not a new one).

---

## API routes

- `GET /api/brain/source-hierarchy` — list all nine tiers, in rank order (200).
- `GET /api/brain/source-hierarchy/{sourceType}` — one tier's definition (200) / 400 for an unapproved type.
- `GET /api/brain/source-hierarchy/compare?a={sourceType}&b={sourceType}` — comparison + resolved winner combined into one response, since a client asking "which wins" always wants both `compareSourceRanks` and `resolveSourceOrdering`'s results together (200) / 400.
- `GET /api/organizations/{organizationId}/knowledge/{knowledgeItemId}/versions/{versionNumber}/source-assignment` — validates the version's recorded Source against the hierarchy (200, `isValid: false` — never a 404 — when nothing has been recorded yet) / 404 for a cross-tenant or invisible version.

Every route follows the exact established shape: identity only from the session cookie, Zod validation, delegates entirely to the domain service, the shared `{data}`/`{error}` envelope, no stack trace or SQL text ever in a response.

---

## Test coverage

- **`src/lib/brain/source-hierarchy.test.ts`** (unit, 13 tests, no database): nine entries covering the approved `SOURCE_TYPES` set exactly once; ranks 1–9 each used exactly once (no duplicates, no gaps); `founder_decision`/`unverified` at ranks 1/9; `listSourceHierarchy` ordering; `getSourceDefinition` correctness; `compareSourceRanks` higher/lower/equal-only-for-self, plus an exhaustive 81-pair antisymmetry check; `resolveSourceOrdering` correctness, argument-order independence, and an exhaustive 81-pair "always resolves" check.
- **`src/lib/brain/source-hierarchy.integration.test.ts`** (real Neon database, 3 tests): `isValid: false` (not a 404) when unassessed; correct rank once a source is recorded (via Module 4's `attachTrustMetadata`); cross-tenant 404.
- **Route-level tests** (2 files, 7 tests): 401/400/200 across list/get/compare; 401/200/404 for the tenant-scoped source-assignment route, including the "no source yet" and "source recorded" cases.
- **Full regression**: `npm run test` (188/188 — 175 prior + 13 new unit tests), `npm run test:integration` (456/456 — 443 prior + 13 new, run twice consecutively, no flakiness), `npm run test:a11y` (52/52, unaffected).
- **`npm run typecheck`, `npm run lint`, `npm run build`**: all clean.
- **Migration verification**: N/A — no migration was generated; confirmed by checking `drizzle/` for new files (none) and re-running `npm run db:check` (still clean, unchanged from Module 4's state).
- **Database state after testing**: confirmed empty (all six Brain tables) after the full suite.

---

## Rollback

Delete `src/lib/brain/source-hierarchy.ts` and its four route files. No schema to revert, no migration to reverse, no other module's data depends on anything this module created (it created no persistent state at all).

---

## Acceptance criteria

- The nine-tier hierarchy is preserved exactly as approved, in the approved rank order, with no invented tier and no reordering. ✅
- Every one of the five requested operations (list, get, compare, validate, resolve-ordering) is implemented, and none of them perform conflict resolution, reasoning, or trust scoring. ✅
- Comparison is deterministic and total: every pair of the nine types resolves to a definite outcome, with no possibility of an unresolvable or cyclic result. ✅
- `validateSourceAssignment` preserves full tenant isolation, identical to every other Brain read. ✅
- No mutation path exists anywhere in this module. ✅

---

## Deviations

- **No new database schema** — a deliberate design choice (see "Storage" above), not an oversight; flagged explicitly since every prior Brain module added at least one migration.
- **"Duplicate rankings," "cycles," and "impossible ordering" are structurally prevented rather than runtime-rejected** — see "Validation" above for the full reasoning; there is no reachable code path for a caller to trigger any of the three, given the hierarchy's fixed, in-code definition.
- **Two of the five routes are intentionally NOT organization-scoped** (`/api/brain/source-hierarchy` and its two sub-paths) — a departure from every other Brain route's `/api/organizations/{organizationId}/...` nesting, justified by the data having no tenant dimension at all.
- **The numbering mismatch** with `MODULE_5_BRAIN_IMPLEMENTATION_PLAN.md`'s own "5. Sources" section (see "A numbering note" above) — resolved with the user before implementation began; documented in both this file and the implementation plan itself.
