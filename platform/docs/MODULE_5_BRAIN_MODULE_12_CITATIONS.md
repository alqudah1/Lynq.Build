# Brain Module 12 — Citation Generation

Implements Module 12. Mechanically builds `{node, version, evidence, source, assumptions, gaps}` from a real Module 11 retrieval trace — `MODULE_3_BRAIN_GRAPH_AND_REASONING.md` §11. No new table (citations are a property of one answer, not persisted knowledge).

## `src/lib/brain/citations.ts`

`buildCitations(db, {organizationId, trace: RetrieveRelevantKnowledgeResult, assumptions?, actorUserId})`.

**Anti-fabrication enforced by the signature itself** (§9): the only input naming which items to cite is `trace` — Module 11's own real output. There is no `itemIds: string[]` parameter anywhere in the file, so a caller structurally cannot request a citation for a node retrieval never returned (not a runtime check — the code path doesn't exist).

Per node: `getTrustAssessmentForVersion` + `listEvidenceForVersion` (Module 4, already tenant/permission-checked internally — retrieval already filtered visibility, so this is a cheap second confirmation, not a new authorization surface) + `getSourceDefinition(...).rank` (Module 5) when a source exists.

**Gaps are explicit, never silent** (§9/§11): unknown trust tier and missing source each produce a `gaps` entry alongside a still-present citation (never a dropped row) — `trustTier: "unknown"`/`source: null` shows up in the citation itself too.

**Assumptions pass through unchanged**, never merged into `evidence` — a separate caller-supplied list; this module only shapes and forwards it.

## Tests
`citations.integration.test.ts` (5 tests): citation set exactly matches trace node set (empty trace too); explicit gap recording for unknown trust + missing source; real evidence/rank once assessed with zero gaps; assumptions passed through and never appearing in any evidence entry.

## Verification
Full suite: unit 188/188, integration 563/563 (56 files), a11y 52/52, typecheck/lint/build/db:check clean, DB empty after tests.
