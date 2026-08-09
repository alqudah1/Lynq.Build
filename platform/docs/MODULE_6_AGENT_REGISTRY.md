# Module 6 — Agent Registry

Implements the Agent Registry (`marketing/AGENT_FRAMEWORK.md` §2, §3, §5, §13, §14, §16, §17), the first non-human identity this codebase models. Built to unblock Brain Modules 16/17 (Agent Read API, Agent Attribution), per the user's own "skip to Agent Registry now" decision. Lives in a new `src/lib/agents/` directory, deliberately separate from `src/lib/brain/` — it is "Module 3-adjacent," not Brain itself.

## Scope decision

Does **not** touch `brain_permission_grants` (`granteeUserId` stays human-only). Widening that table's grantee to a real `user | agent` union is Brain Module 16 (Agent Read API)'s job, done against that module's actual query patterns — not schema speculation done blind here. This module only makes the agent identity itself real, manageable, and authenticatable.

**Update (Brain Module 16, now complete)**: `brain_permission_grants` has since been widened exactly as anticipated here — see `MODULE_5_BRAIN_MODULE_16_AGENT_READ_API.md`. An agent registered by this module can now be a real Brain grantee (`granteeAgentId`), and `agent_credentials`' `issueAgentCredential`/`verifyAgentCredentialDetailed` are the actual authentication path Module 16's `/api/agent/brain/...` routes use. §17's "lessons preserved in the Brain" deferral below is also now partially resolved — see that note.

## Schema (`drizzle/0016_serious_risque.sql`)

4 enums: `agent_department` (LYNQ's fixed 13-department list, `LYNQ_COMPANY_OS.md` §9-11 — a closed enum, matching the `knowledge_domain` precedent, not a mutable table), `agent_permission_level` (§5's 6 agent-assignable levels — `founder` is structurally absent, not merely rejected), `agent_lifecycle_stage` (§2's 9 stages), `agent_health_status`.

3 tables: `agents` (current anatomy + pointers — org-scoped, human-owner FK'd to `organization_memberships`), `agent_versions` (append-only anatomy snapshots, mirrors `knowledge_item_versions`), `agent_credentials` (SHA-256 secret hashes only, never plaintext; multiple simultaneously-active credentials allowed, rotation-friendly).

## `src/lib/agents/`

- **`authz.ts`** — `requireAgentRegistryManagementAuthority`: organization owner/admin, org-wide. Mirrors Brain Module 7's own already-reasoned fallback exactly (AI Systems department-lead authority isn't implementable — no department-lead table exists — so this module adopts the identical owner/admin fallback rather than re-litigating the same gap).
- **`agents.ts`** — `registerAgent` (creates at `idea` stage + v1 snapshot), `getAgent`, `listAgents`, `updateAgentAnatomy` (always a new version — §16 "improvement happens through explicit versioning, not silent tuning" — atomic `UPDATE ... WHERE current_version_number = expected` concurrency guard).
- **`lifecycle.ts`** — `advanceAgentLifecycleStage` (forward-one-step only, per §2's "no agent skips a stage"; `testing → approval` structurally forces `permissionLevel` to `observer`, per §2's explicit override, recording a new version), `changeAgentPermissionLevel` (only while `deployment`/`monitoring`/`improvement`; rejects `founder` defense-in-depth), `retireAgent` (§17, one-way, legal from any non-retired stage, mandatory reason), `recordAgentHealth` (§13, coarse status, human-recorded interim proxy for future Runtime telemetry).
- **`credentials.ts`** — `issueAgentCredential` (returns plaintext exactly once), `verifyAgentCredential`, `revokeAgentCredential`, `listAgentCredentials`.

## Routes

8 routes under `/api/organizations/{organizationId}/agents/...`: list/register, get/update, advance, permission-level, retire, health, credentials (issue/list), credentials/{id}/revoke. Same session-auth + Zod + `jsonSuccess`/`handleRouteError` convention as every existing route.

## Audit

11 new event types (`agent_registered`, `agent_anatomy_updated`, `agent_lifecycle_advanced`, `agent_approved`, `agent_retired`, `agent_permission_level_changed`, `agent_health_recorded`, `agent_credential_issued`, `agent_credential_revoked`, `agent_registry_denied`, `agent_version_conflict`, `agent_lifecycle_conflict`) — every denial and every conflict audited, matching Brain's own discipline.

## Tests

`agents.integration.test.ts` (6), `lifecycle.integration.test.ts` (8), `credentials.integration.test.ts` (5), `agent-routes.integration.test.ts` (5) — 24 new integration tests. Full suite: unit 188/188, integration 607/607 (64 files), a11y 52/52, typecheck/lint/build/db:check clean, DB empty after tests.

## Update (Agent Runtime Core, Module 7, now complete)

The Agent Registry is now a real runtime dependency, not just a standing catalog: `agent_executions.assignedAgentId`/`assignedAgentVersionNumber` reference this module's own tables directly, `revalidateAgentEligibility` (`src/lib/agent-runtime/authz.ts`) calls `resolveAgentById` fresh on every gated runtime action, and a live-`retired`-agent check blocks execution immediately — see `MODULE_7_AGENT_RUNTIME_CORE.md`.

## Deferred (honestly, not silently)

§17's "lessons preserved in the Brain's Wisdom domain before shutdown" is still not implemented. Brain Modules 16/17 now exist (an agent can read the Brain and create attributed drafts), but nothing yet AUTOMATES "write a Wisdom-domain retrospective knowledge item on retirement" — `retireAgent` still only sets `retiredAt`/`retiredReason` on the registry row itself. This remains a real, flagged gap, not silently skipped: it needs a specific product decision about what a "lesson" actually is and who (human or agent) authors it, which is out of scope for Module 17's own bounded "prove attribution works" mandate.

## Update (Tool Runtime Foundation, Module 8, now complete)

The first agent actually registered and driven through this module's own lifecycle end to end: `seedKnowledgeAnalystAgent` (`src/lib/agents/knowledge-analyst.ts`) uses `registerAgent`/`advanceAgentLifecycleStage`/`changeAgentPermissionLevel` exactly as designed — no shortcut, no new registration path. Module 8 also confirms the lifecycle's own §5 rule in practice: the agent is forced to `observer` at `approval`, then raised to `assistant` as its own separate, audited call, never implied by reaching `deployment`. See `MODULE_8_FIRST_WORKING_AGENT.md`.

## Update (Generic Agent Execution, Module 14, now complete)

No change to this module's own registry, lifecycle, or permission-level model. Module 14's agent task handler eligibility check (`AgentTaskHandler.isAgentEligible`) reads this module's own `agent.name` and `agent.lifecycleStage` fields directly (an agent must not be `retired`) — the exact same "resolve the agent, check it isn't retired" pattern the Workflow Engine's `tool_invocation`/`approval`/`artifact_transform` node executors already used before this module existed. Retiring an agent (`retireAgent`) takes effect on its very next `agent_execution` node dispatch, with no separate revocation step needed.
