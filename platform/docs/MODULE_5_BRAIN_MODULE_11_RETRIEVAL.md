# Brain Module 11 — Retrieval Layer

Implements Module 11. Composes Module 10's keyword search (seed set) with bounded, cycle-safe graph-traversal expansion over Module 3's relationships — `MODULE_3_BRAIN_GRAPH_AND_REASONING.md` §2's "relevant nodes" step. Internal function only, no public route (Modules 12/16 compose this further).

## `src/lib/brain/retrieval.ts`

`retrieveRelevantKnowledge(db, {organizationId, query, domain?, workspaceId?, actorUserId, seedLimit?, maxDepth?})` → de-duplicated `{item, source: "keyword"|"graph", rank, depth}[]`.

- **Seed set**: `searchKnowledgeItems` (Module 10) results, `depth: 0`.
- **Expansion**: breadth-first over `knowledge_relationships` (active edges only), one batched query per depth level (not per node) — `visited` set seeded with every keyword hit, so traversal never re-discovers or re-expands an already-known node.
- **Cycle safety** (§9, hard requirement): `visited` set is a permanent stop list; `maxDepth` (default 2, capped at 5) is a small fixed bound. Proven directly with a deliberately-cyclic 3-node fixture (A→B→C→A).
- **Traversal never grants visibility** (§7): every candidate node — keyword or graph — passes the identical batched permission filter `listKnowledgeItemsForUser`/`search.ts` already use (`getMemberWorkspaceIds`/`getReadableBrainScopes`/`scopeKey`, reused again, never re-derived). An invisible candidate is marked `visited` (so it's never re-checked) but never joins the next frontier — traversal cannot expand *through* a node the actor can't read to reach something beyond it. Proven directly: Owner can see a seed item and a two-hop-away item, but a workspace-scoped node in between is invisible to them, so neither the hidden node nor anything beyond it is ever surfaced; the workspace member who can see all three gets all three.
- **Liveness**: reuses `search.ts`'s exported `LIVE_STATUSES` so graph-discovered nodes are excluded from `archived`/`retired`/`purged` identically to keyword hits — one shared rule, not two.

## Tests
`retrieval.integration.test.ts` (6 tests): keyword+graph union with de-dup; cycle safety; permission-filtering (including the "never traverse through an invisible node" case); `maxDepth` bound; retired-neighbor exclusion; non-member rejection.

## Verification
Full suite: unit 188/188, integration 558/558 (55 files), a11y 52/52, typecheck/lint/build/db:check clean, DB empty after tests.
