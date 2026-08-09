# Module 8, Part 1 — Tool Runtime Foundation

Gives Agent Runtime Core (Module 7) a provider-neutral, typed, permission-aware way for an agent to actually *do* something during `executing`. Foundation only: 3 internal tools, no external integrations, no workflow engine. Builds directly on Module 7's execution/plan/checkpoint model and Brain Module 16/17's read/write gates — no new execution, permission, or attribution system.

## Tool Model — two layers, deliberately separate

- **`tool_definitions` (database) = versioned POLICY.** Risk level, side-effect class, required capabilities, permission floor, approval requirement, enabled state. Always inserted as a new version (`registerTool` → v1, `updateToolConfiguration` → v(N+1)); a version already referenced by a `tool_invocations` row is never edited in place.
- **Code registry (`src/lib/tools/implementations/registry.ts`) = typed BEHAVIOR.** A Zod input schema + an `execute(ctx, input)` function, keyed `${toolKey}@${version}`.

The DB is the authority on "may this run"; code is the authority on "what actually happens." A `tool_definitions` row with no matching code implementation is an internal-consistency failure (`ToolRuntimeError`), never a silent no-op.

**Structural high-risk rule**, enforced twice: `registerTool`/`updateToolConfiguration` force `approvalRequired: true` for `destructive`/`financial`/`permission_changing` regardless of caller input, and the database itself carries a CHECK constraint (`tool_definitions_high_risk_requires_approval_check`) as the non-bypassable backstop — verified directly by a test that inserts a raw high-risk row with `approvalRequired: false` and confirms Postgres itself refuses it.

## Tool Registry

`src/lib/tools/definitions.ts`: `registerTool`, `getCurrentToolVersion`, `getToolVersion`, `listTools({ onlyEnabled? })` (dedupes to current version per key), `updateToolConfiguration`, `enableTool`/`disableTool` (toggle the current version in place), `resolveToolForExecution` (the one gate every call passes through — not-found → `ToolNotFoundError`, disabled → `ToolDisabledError`). No tool-management UI in this phase.

## Tool permissions — one function, ten checks, all against existing gates

`src/lib/tools/invocation.ts`'s `invokeTool` is the single entry point every tool call goes through, in this order: assigned agent + live eligibility (Module 7's own `requireAssignedAgent`/`revalidateAgentEligibility`) → execution is `executing` → tool exists/enabled → rate limit → permission-level floor (live, never the Execution Context snapshot) → implementation resolved → input validated against the tool's own `.strict()` Zod schema → live Brain capability check per domain the call actually touches (`resolveEffectiveBrainCapabilitiesForAgent`, Brain Module 16 — the identical function, not a parallel one) → approval gate → idempotency-guarded durable insert → execute → record outcome.

Delegation does not transfer tool permission — a delegated child re-validates its own grants on every call, exactly like Module 7's own delegation tests already prove for Brain reads.

## Invocation lifecycle

`requested → (validating/waiting_for_approval) → running → succeeded | failed | cancelled | timed_out`, `toolInvocations.status` (9-value enum). The durable row is written **before** `execute()` runs — the identical "checkpoint before side effect" principle Module 7 §8 established for executions, applied here to tool calls. Every meaningful transition is durable; there is no field anywhere for a tool to hand back an arbitrary string the Runtime has to interpret — outcomes are one of 12 fixed `ToolErrorClass` values.

## Idempotency strategy

`tool_invocations_idempotency_unique`: a **partial** unique index on `(organizationId, executionId, toolKey, idempotencyKey) WHERE status <> 'failed'`. Effects:
- A succeeded (or in-flight) row makes a duplicate insert fail with Postgres `23505` — translated into either a replay of the cached `resultRef` (attempt arrives after the original succeeded) or `ToolIdempotencyConflictError` (attempt arrives while the original is still running — a genuine concurrent duplicate, proven by a `Promise.all` test that fires two identical calls and confirms the underlying side effect ran exactly once).
- A **failed** row falls outside the index, freeing the exact same key for a fresh retry row — proven by a test that fails on attempt 1 (simulated transient error) and succeeds on attempt 2 under the same idempotency key, with `attemptNumber` correctly incrementing (counted from every prior row under that key, including the failed one — a real gap caught and fixed during this module: the first draft of `invokeTool` never computed `attemptNumber` at all).
- `artifact.create_report`'s own `execute()` adds one more layer specific to internal-write tools: before creating anything, it checks whether an earlier attempt under the same idempotency key already produced an artifact (crash between artifact-creation and the invocation row being marked `succeeded`) and reuses it — never a second artifact for one logical action.

## Initial internal tools (exactly 3, nothing else)

| Tool | Category | Risk | Side effect | Approval | Capabilities |
|---|---|---|---|---|---|
| `brain.search` | brain | low | read_only | no | `read` |
| `brain.get_context` | brain | low | read_only | no | `read` |
| `artifact.create_report` | artifact | low | internal_write | no | none |

`brain.search` required a real design decision: Brain Module 10's `searchKnowledgeItems` was human-only, and Module 16 (Agent Read API) never built a search endpoint. Resolved by extending `src/lib/brain/search.ts` with the same grantee-polymorphic shared-core pattern already used three times in this codebase (Brain Module 7's grant resolution, Module 16's overall design) — a private `runSearch(db, input, workspaceVisibilityIds, readableScopes)` core, with a new public `searchKnowledgeItemsForAgent` wrapper resolving `readableScopes` via a new `getReadableBrainScopesForAgent` (relocated from `agents/brain-reads.ts` into `brain/knowledge-items.ts` mid-build, once it became clear `brain/` code needed to call it and `brain/` must never import from `agents/` — a real layering violation caught and fixed, not designed in from the start). Never a second search implementation.

`brain.get_context` calls Module 16's existing `getKnowledgeContextForAgent` directly — no new retrieval code. `artifact.create_report` calls Module 7's existing `createArtifact` directly — no new artifact table, and it never promotes anything into the Brain.

## Rate limiting

`src/lib/tools/rate-limits.ts`, wired into `invokeTool` via the existing provider-agnostic `RateLimiter` interface (`PostgresRateLimiter`, the same backend Brain Module 16 uses for agent reads). Keyed by `(organization, agent, tool)` — never a raw credential. Read-only tools get 120/60s; anything that writes gets 30/60s, mirroring Module 16's own read/write budget split.

## Audit

13 new event types (`tool_registered`, `tool_enabled`, `tool_disabled`, `tool_invocation_requested/started/succeeded/failed/rate_limited/permission_denied/approval_required`, `knowledge_analyst_task_started/report_created/task_completed`). Bounded metadata only — tool keys, versions, invocation ids, error classes; never full report content, credentials, tokens, or hidden reasoning.

## APIs

- `GET /api/organizations/{organizationId}/tools` — global catalog (`onlyEnabled` filter), gated on organization membership only (tools aren't org-scoped resources; the path is nested purely for auth-convention consistency).
- `GET /api/organizations/{organizationId}/tools/{toolKey}` — current version.
- `GET /api/organizations/{organizationId}/agent-executions/{executionId}/tool-invocations` — an execution's full tool-call history, gated by the same `requireExecutionVisibility` every other execution-scoped human read uses.

(The Knowledge Analyst's own two routes are documented in `MODULE_8_FIRST_WORKING_AGENT.md`.)

## Bugs found and fixed during this module

1. **`attemptNumber` never computed.** The first draft of `invokeTool`'s durable insert always left `attemptNumber` at its schema default (1), forever, even on a genuine retry — caught while writing the "retry after transient failure" test, fixed by counting prior rows under the same idempotency key before each insert.
2. **Layering violation.** `getReadableBrainScopesForAgent` was defined privately inside `src/lib/agents/brain-reads.ts` (a Module 16 artifact), but `brain.search`'s implementation needed it reachable from `brain/search.ts`, which must never import from `agents/`. Fixed by relocating the function into `brain/knowledge-items.ts`, matching the precedent that `resolveEffectiveBrainCapabilitiesForAgent` already lives in `brain/authz.ts`, not `agents/`.
3. **Test-fixture tool definitions leaking into permanent seed data.** The approval-gate and retry tests needed synthetic tool rows (`test.destructive_action`, `test.flaky_action`, `test.write_action`); an early draft left them registered forever, indistinguishable from the 3 real permanent tools in `listTools()`. Fixed with an `afterAll` that deletes them — only `brain.search`, `brain.get_context`, and `artifact.create_report` survive test cleanup, by design.

## Tests

31 new integration tests across 3 files: `definitions.integration.test.ts` (12 — registry CRUD, version traceability, the DB CHECK constraint verified directly), `invocation.integration.test.ts` (19 — every gate in `invokeTool`'s order, idempotency, concurrency, the approval gate via a synthetic high-risk fixture, retry-after-failure), plus the route-level and end-to-end coverage described in `MODULE_8_FIRST_WORKING_AGENT.md`.

## Verification

Unit 189/189 (unchanged — no new unit-tier logic), integration 78 files / 728 tests (685 prior + 43 new), a11y 52/52 (unchanged, no UI), typecheck/lint/production build/`drizzle-kit check` all clean, direct Postgres CHECK-constraint verification passed, real concurrency test passed (two racing identical invocations → exactly one side effect), DB confirmed empty of all org-scoped data after the full suite via direct row-count queries, with only the 3 permanent tool definitions remaining.

## Update (Runtime Recovery and Workers, Module 9, now complete)

The gap flagged at the end of this module's own final report — no reconciliation pass for a tool invocation stuck mid-execution — is closed (`src/lib/runtime/reconciliation-tool-invocations.ts`), using exactly this module's own idempotency model and artifact-existence checks, never a second correctness mechanism. `invokeTool` itself is unchanged; Module 9 only adds a queue and worker that call it. See `MODULE_9_RUNTIME_RECOVERY_AND_WORKERS.md`.

## Update (LYNQ Workflow Engine Core, Module 11, now complete)

`tool_invocation` workflow nodes call this module's own, completely unmodified `invokeTool` exactly once per node execution — the same 9-step gate, the same idempotency model, no workflow-specific bypass or shortcut. The workflow node execution records the resulting `toolInvocationId` as a pointer only; tool eligibility/permission checks are re-evaluated live by `invokeTool` itself on every call, never cached or pre-approved by the workflow layer. See `MODULE_11_WORKFLOW_ENGINE_CORE.md`.

## Update (LYNQ Communications & Integrations Core, Module 16, now complete)

Four new tool implementations (`communications.create_draft`, `communications.send`, `communications.get_status`, `communications.list_conversation`) register through this module's exact `registerTool`/`registerToolImplementation` mechanism — the `"communication"` value already existed in this module's own `tool_category` enum from day one, unused until now. `communications.send` is the first tool in this codebase to deliberately set `approvalRequired: false` on an `external_write`-class tool — not an oversight: the underlying Communications OS domain function it calls already refuses to run against an unapproved message, so enabling this module's own approval gate on top would create a second, redundant approval system for the identical action. `invokeTool` itself is completely unchanged. See `MODULE_16_INTEGRATION_ADAPTERS.md`.
