# Brain Module 16 — Agent Read API

Lets a registered agent (Agent Registry) read Brain knowledge through the identical tenant/workspace/domain/lifecycle/permission boundaries a human uses — never broader. Deterministic retrieval only: no ranking, no synthesis, no generated reasoning.

## Schema (`drizzle/0017_flippant_sauron.sql` + `0018_red_proudstar.sql`)

`brain_permission_grants` widened from a NOT-NULL human-only grantee to a closed `(human | agent) ` union: `granteeUserId` now nullable, new `granteeAgentId`/`granteeType` columns, `brain_permission_grants_exactly_one_grantee_check` CHECK, and — after a bug caught by this module's own duplicate-grant tests — **four** partial unique indexes (not two), split by both workspace-scope AND grantee-type, since a single index across two independently-nullable columns silently stopped catching duplicate human grants (Postgres treats every NULL as distinct). New composite FK `brain_permission_grants_grantee_agent_org_fk → agents(id, organization_id)`, reusing a new `agents_id_org_unique` constraint. `agents` was relocated to before every Brain table in `schema.ts` (a forward-reference requirement); `access_actor_type` was relocated to the very top of the file for the same reason.

## `src/lib/brain/authz.ts`

`resolveEffectiveBrainCapabilitiesForGrantee` — the one shared query core both `resolveEffectiveBrainCapabilities` (human, signature unchanged, zero regression risk) and the new `resolveEffectiveBrainCapabilitiesForAgent` call, parameterized only by which grantee column to filter on. `requireAgentBrainReadAccess`/`requireAgentBrainCreateAccess` are the agent gates — deliberately NOT a rerun of gates 2–3 (org/workspace membership, human-only concepts); an agent's tenant+eligibility check happens once, upstream, at authentication.

## `src/lib/agents/`

- **`authentication.ts`** — `authenticateAgentFromHeader`: resolves `Authorization: Bearer <secret>` → `verifyAgentCredentialDetailed` → `resolveAgentById` (no human-authority gate) → `AgentPrincipal`. Every failure (missing header, unknown secret, revoked credential, retired agent) returns the identical `UnauthenticatedError` (401); only the audit trail (`agent_brain_credential_invalid`/`agent_brain_credential_revoked`) distinguishes why.
- **`brain-reads.ts`** — `listKnowledgeItemsForAgent`, `getKnowledgeItemForAgent`, `listKnowledgeItemVersionsForAgent`, `listRelationshipsForAgent`, `getKnowledgeContextForAgent` (the citation-ready bundle). Reuses `composedItemSelection`/`scopeKey` from `knowledge-items.ts` directly. One deliberate narrowing vs. the human path: omitting `workspaceId` on a list call returns organization-scoped items only — agents have no workspace-membership concept to expand into, so the default is narrower, never broader.
- **`rate-limits.ts`** — reuses the existing provider-agnostic `PostgresRateLimiter`, keyed by `(agentId, organizationId, endpointClass)`, never a raw credential.
- **`route-helpers.ts`** — `authenticateAgentForRoute`: authenticate → rate-limit, the one entry point every route below calls.

## Routes

6 routes under `/api/agent/brain/knowledge/...`: list/create, get, versions, relationships, citation-ready context. Session-independent — agent identity comes only from the credential, never a path parameter.

## Audit

6 new event types: `agent_brain_read` (one per API call, never per returned record — the required bounded strategy), `agent_brain_read_denied`, `agent_brain_write_denied`, `agent_brain_credential_invalid`, `agent_brain_credential_revoked`, `agent_brain_rate_limited`. `audit_logs`/`recordAuditEvent` widened with `actorAgentId`/`actorType`, mutually exclusive with `actorUserId` via `audit_logs_at_most_one_actor_check`.

## Bugs found and fixed during this module

1. The four-vs-two partial unique index bug above (caught by existing duplicate-grant tests before it ever shipped).
2. `verifyAgentCredentialDetailed`'s "revoked" branch initially wrote its audit event with no `organizationId`/`actorAgentId`, making it unqueryable per-organization — caught by this module's own test, fixed by threading the resolved agent id through.
3. `KnowledgeItem`/`composedItemSelection`/`search.ts`/`retrieval.ts` never got widened for the new author columns in the first pass — caught by `tsc`, fixed, and `retrieval.ts`'s manually-duplicated column list was replaced with a reuse of `composedItemSelection` to prevent the same drift recurring.

## Tests

24 new integration tests across `attribution-constraints`, `authentication`, `brain-reads`, and route-level suites (this module's share of Module 17's combined 37). See Module 17's doc for the full list of scenarios covered.

## Update (Agent Runtime Core, Module 7, now complete)

This is now the real consumer `MODULE_4_AGENT_RUNTIME_ARCHITECTURE.md` §3/§12 anticipated: every gated action inside an execution (`src/lib/agent-runtime/`) resolves Brain capabilities through this module's own `requireAgentBrainReadAccess`/`resolveEffectiveBrainCapabilitiesForAgent`, called fresh on every call, never through the Execution Context's own snapshot. See `MODULE_7_AGENT_RUNTIME_CORE.md`.

## Update (Tool Runtime Foundation, Module 8, now complete)

This module never built a search endpoint — only list/get/versions/relationships/context. Module 8's `brain.search` tool needed one, and the gap was closed by extending `src/lib/brain/search.ts` with a new `searchKnowledgeItemsForAgent`, following this module's own grantee-polymorphic precedent rather than inventing a parallel implementation. `getReadableBrainScopesForAgent` — originally private inside this module's own `brain-reads.ts` — was relocated to `brain/knowledge-items.ts` mid-build once it became a dependency of `brain/search.ts`, which must never import from `agents/`; it is exported from there now, alongside its human-grantee sibling `getReadableBrainScopes`. `getKnowledgeContextForAgent` (this module's own function) is called directly, unmodified, by the `brain.get_context` tool. See `MODULE_8_TOOL_RUNTIME_FOUNDATION.md`.

## Verification

Full suite: unit 189/189, integration 644/644 (69 files), a11y 52/52, typecheck/lint/build/db:check clean, DB empty after tests.

## Update (LYNQ CRM Core, Module 12, now complete)

CRM Core deliberately does **not** reuse this module's `brainPermissionGrants`/`AgentPrincipal` capability model for CRM data access — a new, structurally separate `crm_agent_permission_grants` table with its own closed 6-value permission enum (`crm_contact_read`/`crm_company_read`/`crm_lead_read`/`crm_opportunity_read`/`crm_activity_read`/`crm_note_read`) governs CRM reads, default-deny, checked independently of any Brain grant. This module's own `AgentPrincipal` (`authenticateAgentFromHeader`) is still the identity primitive every CRM agent route authenticates through, unmodified — only the *authorization* question ("what may this agent read") is answered by a wholly separate table. Verified directly: an agent holding a Brain `identity` read grant still cannot read any CRM data without an explicit CRM grant. See `MODULE_12_CRM_AUTHORIZATION_AND_PRIVACY.md`.
