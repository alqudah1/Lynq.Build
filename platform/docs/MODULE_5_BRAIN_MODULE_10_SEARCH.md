# Brain Module 10 — Search Interface (keyword only)

Implements Module 10. Keyword-only Postgres full-text search over each item's CURRENT version (`to_tsvector`/`plainto_tsquery`/`ts_rank`) — explicitly not semantic/hybrid (Module 3.1 §13). Internal function only, per the plan — no public route until Module 11 composes it.

## Schema
One additive GIN expression index, no new table/column: `drizzle/0013_marvelous_speed_demon.sql` — `knowledge_item_versions_fts_idx` on `to_tsvector('english', title || ' ' || content)`. Applied and verified live.

## `src/lib/brain/search.ts`
`searchKnowledgeItems(db, {organizationId, query, domain?, workspaceId?, actorUserId, cursor?, limit?})`. Reuses `getMemberWorkspaceIds`/`getReadableBrainScopes`/`scopeKey` (now exported from `knowledge-items.ts` rather than duplicated) for the identical workspace + Brain-capability permission filtering `listKnowledgeItemsForUser` already established — §8's "search is not a side-door around Domain Grants" rule. Excludes `archived`/`retired`/`purged` unconditionally (§4's own "excluded from normal retrieval by default" for Retired). Cursor-paginated on `(rank DESC, id ASC)`, the same non-offset principle as every other list function, adapted to a ranked result set.

**Gotcha hit and fixed**: `drizzle-orm`'s raw-SQL array parameter (`${jsArray}`) expands to a parenthesized scalar list (`($1,$2,...)`), not a Postgres array literal — pairing it with `= ANY(...)` throws `op ANY/ALL (array) requires array on right side` (and, for an empty array, a syntax error). Fixed by using `IN ${array}` instead of `= ANY(${array})` throughout.

## Tests
`search.integration.test.ts` (9 tests): term matching, relevance ranking, workspace-membership filtering, Brain-capability filtering, archived/retired exclusion, domain/workspaceId filters, pagination bounds, no-match empty result, non-member rejection.

## Verification
Full suite: unit 188/188, integration 552/552, a11y 52/52, typecheck/lint/build/db:check clean, DB empty after tests.
