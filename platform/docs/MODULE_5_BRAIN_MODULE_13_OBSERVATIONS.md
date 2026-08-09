# Brain Module 13 — Observation Generation

Implements Module 13. `MODULE_3_BRAIN_GRAPH_AND_REASONING.md` §4's worked example: several lower-level Facts becoming one Observation. No new table — Observation is `classification: "observation"` on the existing `knowledge_items` (already one of the 11 approved values), per Module 3 §1's decision against a table per content shape.

## `src/lib/brain/observations.ts`

`createObservation(db, rawSql, {organizationId, domain, title, content, sourceItemIds, relationshipType?, actorUserId})` — a thin wrapper: `createKnowledgeItem` (classification forced to `"observation"`) + one `createRelationship` (`created_from` by default, per §7's "A created_from B = A derived from B" direction — the new item is the source endpoint, each cited item the target) per `sourceItemIds` entry. Rejects zero sources before any row is written (`ObservationRequiresSourceError`). No new capability — reuses Module 1/3's existing authorization unchanged. Not wrapped in one transaction (matches how a human would create the item then cite sources one at a time); a mid-list relationship failure leaves the item and already-created citations in place, not rolled back.

## Trust ceiling (`trust.ts`)

One added guard in `attachTrustMetadata`: `classification === "observation" && trustTier === "verified"` → `ObservationTrustCeilingError` (409) — an Observation is, by definition, a pattern noticed across other items, never a directly verified fact. Approved (and below) still allowed; non-observation items unaffected.

## Tests
`observations.integration.test.ts` (6 tests): creation with correct edge direction/type; zero-source rejection (no row written); `supports` as an alternate relationship type; verified-tier rejection on an Observation; approved-tier success; non-observation items still allow verified (regression guard).

## Verification
Full suite: unit 188/188, integration 569/569 (57 files), a11y 52/52, typecheck/lint/build/db:check clean, DB empty after tests.
