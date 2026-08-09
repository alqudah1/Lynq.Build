# Brain Module 17 — Agent Attribution

Makes every Brain mutation an agent can actually perform today attributable to a real, registered agent identity, without ambiguity — and implements the one bounded write path (Draft creation) needed to prove it end to end.

## Scope decision

The task's own "smallest robust model" instruction, applied concretely: the dual `actor_type`/`*_user_id`/`*_agent_id` attribution pattern was added ONLY to the tables an agent can actually write under the current ceiling — `knowledge_items`, `knowledge_item_versions`, `audit_logs`, and `brain_permission_grants` (grantee, not actor). `knowledge_relationships`/`knowledge_item_sources`/`knowledge_item_trust`/`knowledge_item_evidence` were deliberately left untouched — no agent code path creates any of them, so adding `*_agent_id` columns there now would be permanently-null schema, the exact premature-abstraction this task's own engineering discipline warns against. Revisit if/when an agent is ever granted `approve` or evidence/trust-adjacent capabilities.

## Schema

Two shapes, chosen per column's existing `ON DELETE` behavior (verified before writing the migration, not assumed):

- **`brain_permission_grants` (grantee)**: `granteeUserId`/`granteeAgentId` are both `ON DELETE CASCADE` — a grant never legitimately survives its own grantee's removal — so the CHECK is **exactly one**.
- **`knowledge_items`/`knowledge_item_versions` (author/creator)**: the existing `*_user_id` columns are `ON DELETE SET NULL` (a deleted user's authorship tombstones to null, by long-standing design) — so the new `*_agent_id` siblings use the same `SET NULL` behavior, and the CHECK is **at most one**, not exactly one, deliberately preserving the pre-existing "both null" tombstone state rather than making it newly illegal.

`audit_logs` gained `actorAgentId`/`actorType`, mutually exclusive with `actorUserId`, no tenant-composite FK (an audit row must outlive both an organization and an agent, matching `organizationId`'s own precedent).

Existing human history required zero rewriting — every new author/creator/actor column is purely additive and nullable; a pre-migration row is a valid post-migration row unchanged.

## `src/lib/agents/drafts.ts`

`createDraftKnowledgeItemAsAgent` — Brain Module 17's only write function. Mirrors `createKnowledgeItem`'s exact atomic 3-statement transaction shape but targets the agent columns; deliberately NOT a call to `createKnowledgeItem` itself (an agent id would violate the `at_most_one_author` CHECK if written into a `*_user_id` column, correctly). Returns the created item constructed directly — NOT re-fetched via the read-gated `getKnowledgeItemForAgent`, since `draft_write` and `read` are independently-grantable capabilities; an agent holding only `draft_write` must still see what it just created, exactly as a human with only `draft_write` already does.

**The ceiling is structural, not a runtime check**: this file exports exactly one function. There is no `updateDraftKnowledgeItemAsAgent`, no agent-facing approve/publish/archive/purge path, anywhere in `src/lib/agents/`. An agent cannot call `createBrainPermissionGrant` as itself — an agent id fails at that function's very first gate (organization-membership resolution), a structural impossibility, not a permission check that could be misconfigured.

## Audit

Reuses the existing `knowledge_item_created` event type (an agent-authored draft is still, semantically, an item creation) — `actorAgentId` set, `actorUserId` null, distinguishes it, rather than inventing a parallel `knowledge_item_created_by_agent` event for the same underlying action.

## Tests (24 new, shared with Module 16's 13 — 37 total)

- `attribution-constraints.integration.test.ts` (9) — direct Postgres INSERT attempts against all four new CHECK constraints and the cross-tenant composite FK, both the rejected and accepted shapes.
- `authentication.integration.test.ts` (6) — valid credential → correct principal; missing header; unknown secret; revoked credential (immediate, correctly audited with org/agent context); retired agent (immediate); no secret ever leaks into an audit record.
- `brain-reads.integration.test.ts` (11) — no grant → denied; exact grant → allowed; org grant doesn't leak into workspace content; workspace grant doesn't leak outside its workspace; permission level alone grants nothing; department alone grants nothing; cross-tenant → 404; citation-ready response contains only the approved field set; list never expands beyond org-scoped items; full lifecycle advancement to `deployment` still doesn't substitute for a grant.
- `drafts.integration.test.ts` (6) — no `draft_write` → denied; success → real agent attribution on both the returned object and the actual row, plus the audit event; high permission level alone still denied; the draft module's only export is the one create function; an agent id fails `createBrainPermissionGrant`'s own actor-resolution gate; human attribution (`createKnowledgeItem`) unchanged after the migration.
- `agent-brain-routes.integration.test.ts` (5) — full HTTP round-trip (register → grant → create via route → list/get/versions/relationships/context via route); 401 unauthenticated on every route; 403 (not 401/404) for a valid credential missing `draft_write`; 401 for a bogus token; 429 when the read budget is exceeded, correctly audited.

## Update (Agent Runtime Core, Module 7, now complete)

`src/lib/agent-runtime/plans.ts`/`artifacts.ts` reuse this module's exact `createdByUserId`/`createdByAgentId`/`createdByType` attribution shape for `agent_plans` and `agent_artifacts` — no new attribution model invented for the runtime layer. `createDraftKnowledgeItemAsAgent` (this module's own bounded write path) remains the only way an execution's agent can touch the Brain directly; the runtime's own `agent_artifacts` stay structurally separate from `knowledge_items`, per §13's "never automatic" promotion rule. See `MODULE_7_AGENT_RUNTIME_CORE.md`.

## Update (Tool Runtime Foundation, Module 8, now complete)

`tool_definitions` reuses this module's `ownerUserId` attribution pattern; `tool_invocations` records `agentId` + `agentVersionNumber` on every row, the identical "snapshot the version at the moment of action" discipline this module established for plans/artifacts. `artifact.create_report`'s output is still bound by this module's own rule: the report artifact it creates is never auto-promoted into `knowledge_items` — verified directly by a Module 8 test. See `MODULE_8_TOOL_RUNTIME_FOUNDATION.md`.

## Verification

Full suite: unit 189/189 (was 188 — one new `recordAuditEvent` test added for the `actorAgentId` path, plus 2 existing unit-test assertions updated for the now-always-present `actorAgentId`/`actorType` fields), integration 644/644 (69 files, was 607/64), a11y 52/52, typecheck/lint/build/db:check clean, DB empty after tests (confirmed by direct row-count query, not just the test runner's own cleanup claim).
