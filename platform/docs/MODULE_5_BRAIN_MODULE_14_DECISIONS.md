# Brain Module 14 — Decision Tracking

Implements Module 14. `MODULE_3_BRAIN_GRAPH_AND_REASONING.md` §5's structured Decision fields. Decision is `classification: "decision"` (no dedicated table, same precedent as Module 13's Observation). Who/why/evidence/alternatives/risks are already expressible with existing primitives (Source, `changeReason`, `created_from`/`references`/`related_to` edges) — this module adds the two operations §5 names that nothing else covers: Outcome and supersession.

## Schema
One additive column: `drizzle/0014_magenta_toad_men.sql` — `decision_outcome` enum (`pending`/`succeeded`/`failed`/`mixed`) + `knowledge_items.outcome` (default `pending`), item-level and directly queryable (mirrors `approvedAt`'s precedent), even though every *change* to it is recorded as a new version. Applied and verified live.

## `src/lib/brain/decisions.ts`

- **`recordDecisionOutcome`** — creates a new version (content unchanged, fresh `changeReason`) via `createNextKnowledgeItemVersion` directly (bypassing `updateKnowledgeItem`'s Module 8/9 "draft only" restriction — outcomes are normally only knowable after a Decision is Approved/Published) and updates the `outcome` column alongside it. Requires ordinary edit authority (`edit_any_draft`/`edit_own_draft`).
- **`supersedeDecision`** — creates a `supersedes` edge (new → old) and steps the old decision's current-version trust to `deprecated`, in one `rawSql.transaction` (mirrors `createKnowledgeItem`'s own atomic-multi-statement pattern) — never a window where one applies without the other. Uses a direct raw trust-upsert, not `attachTrustMetadata` (which mandates a `sourceType` — a side-effect trust step must never fabricate or silently touch a Source record).

**Resolved ambiguity**: §5 requires "the same or higher approval authority as the original approval" to overturn a Decision. This codebase's capability model is flat (one `approve` grant per exact scope, no seniority tiers) — resolved identically to Module 9's own restore-authority precedent: the actor must hold `approve` at the old decision's exact scope. Documented, not silently adopted.

**Known limitation**: the trust-step's `WHERE revision = <observed>` guard is evaluated inside the batched transaction without per-statement inspection — a concurrent trust reassessment landing in the exact race window between read and write would leave the relationship created but the trust step a no-op. Accepted as a narrow, low-probability gap rather than building full transactional rollback for it; flagged here rather than silently ignored.

## Tests
`decisions.integration.test.ts` (9 tests): outcome recording (new version + column update, works on approved/non-draft items, non-decision rejection, stale-version rejection); supersession (edge + atomic trust step, self-supersede rejection, non-decision rejection, lower-authority rejection, duplicate-edge rejection).

## Verification
Full suite: unit 188/188, integration 578/578 (58 files), a11y 52/52, typecheck/lint/build/db:check clean, DB empty after tests.
