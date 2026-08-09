# Module 8, Part 3 — First Working Agent: Company Knowledge Analyst

The first agent that actually runs, end to end, through the real Runtime and real tools built in Part 1. One task type. Deterministic. Evidence-bounded.

## Agent definition

`src/lib/agents/knowledge-analyst.ts`, `seedKnowledgeAnalystAgent`. Registered via the existing Agent Registry (`registerAgent`) — not a new agent-creation path. Department `research_and_strategy`, permission level `assistant` (the minimum `artifact.create_report` requires). Advanced through every §2 lifecycle stage to `deployment` (5 sequential `advanceAgentLifecycleStage` calls — `approval` structurally forces the permission level down to `observer` first, per the framework's own rule), then raised back to `assistant` as its own separate, explicit `changeAgentPermissionLevel` call — never implied by deployment itself. Idempotent: a second call resolves the existing agent by name rather than re-registering.

Grants: narrow, per-domain `read` Brain grants only, one per requested domain, resolved live on every call (never a snapshot). **No** approve/archive/purge/permission-management capability. **No** external tools — its only capabilities are the 3 tools from Part 1, gated the same way any other agent's tool access is gated.

## Task: create a company knowledge report

`runKnowledgeAnalystTask` drives one execution through the real Runtime, with no direct service-call shortcuts anywhere in the path:

```
createExecution → assignExecution → startExecution
  → advanceExecution(planning) → createPlan (6 steps)
  → advanceExecution(reasoning) → [validate accessible domains] → completePlanStep(1)
  → advanceExecution(executing)
    → invokeTool(brain.search) per accessible domain          → completePlanStep(2)
    → invokeTool(brain.get_context) per result                → completePlanStep(3)
    → [assemble citations/findings/missing-info, no LLM]      → completePlanStep(4)
    → invokeTool(artifact.create_report)                      → completePlanStep(5)
  → advanceExecution(verifying) → [verify artifact exists]    → completePlanStep(6)
  → completeExecution   ← the real evidence gate, never bypassed
```

**Why 6 plan steps, not the suggested 7.** The task's own suggested step list ends in "complete execution." Modeling that as a 7th plan step would be circular: `completeExecution`'s evidence gate requires every plan step to be `completed`/`skipped` *before* it will run, so a step literally named "complete execution" would have to be marked done before the call whose entire job is deciding whether completion is allowed. The 7th step **is** the `completeExecution` call itself — "verify completion evidence" (step 6, confirming the report artifact actually exists) is the last step that can honestly be marked complete beforehand.

**Domain isolation.** The task's `allowedDomains` input is narrowed, live, to `accessibleDomains` (whatever the agent currently holds `read` for) before any search happens — a domain the caller requested but the agent was never granted read on is silently excluded from search, never silently searched anyway. If *none* of the requested domains are accessible, the task refuses outright (`NoAccessibleDomainsError`) rather than producing an empty-but-superficially-successful report. Verified directly: a test that requests two domains, grants the agent read on only one, seeds matching knowledge in both, and confirms every citation in the resulting report belongs to the granted domain.

**Deterministic, honestly documented.** Report assembly (title, summary, key findings, citations) is plain formatting over actual tool results — no LLM call anywhere in this path. `contradictions` is always present in the output shape but always empty: detecting a real contradiction requires semantic comparison this deterministic executor does not attempt, and the task's own instruction was explicit that this must never be faked. `missingInformation` is populated for any accessible, requested domain that returned zero results.

**Citations are mechanically derived, never invented.** Every entry in `supportingReferences` is built directly from a `brain.get_context` tool result recorded on that same execution — `knowledgeItemId`, `versionNumber`, `title`, `domain`, `sourceType`, `trustTier`, `retrievedAt` are all read off the tool's actual return value, never re-typed or guessed. Verified directly: a test creates one real knowledge item, runs the task, and asserts every citation's `knowledgeItemId`/`versionNumber` match that item's actual identity exactly.

## Completion evidence

Nothing here marks an execution `completed` directly. The only exit path is `completeExecution` (Module 7), gated on all 6 of the Knowledge Analyst's own plan steps being resolved. Verified directly with a test that builds the identical plan by hand, deliberately leaves steps 2–6 unresolved, and confirms `completeExecution` throws `InsufficientCompletionEvidenceError` — the agent cannot self-declare completion by any path.

## APIs

- `POST /api/organizations/{organizationId}/knowledge-analyst/tasks` — `{ workspaceId?, topic, allowedDomains, maxResults?, reportFormat? }` (only `"structured"` is implemented; anything else is a 400, never silently substituted). Resolves the org's already-seeded analyst by name (routes never auto-seed on request) and runs the task synchronously to completion — there is no queue or background worker in this phase, so the response only returns once the execution has actually finished or thrown.
- `GET /api/organizations/{organizationId}/knowledge-analyst/tasks/{executionId}/report` — the parsed report, gated by the same human-visibility check every other execution-scoped read uses.

## End-to-end verification

A full route-level test (`module-8-tool-routes.integration.test.ts`) exercises the real HTTP handlers: seed → `POST` a task → the execution completes → `GET` its tool invocations (both `brain.search` and `artifact.create_report` present, all `succeeded`) → `GET` its report (citations present, `executionStatus: "completed"`). A separate cross-tenant test confirms an execution from organization A is invisible (404) from organization B via the tool-invocations route.

## Bugs found and fixed during this module

See `MODULE_8_TOOL_RUNTIME_FOUNDATION.md` — the `attemptNumber` and layering fixes were caught while building the tools this agent's task calls, before this agent existed. No defects were found specific to the orchestration function itself; its main design risk (the plan-step circularity around "complete execution") was resolved during design rather than caught by a failing test.

## Verification

7 new integration tests for the agent/orchestration itself (`knowledge-analyst.integration.test.ts`) plus 5 route-level tests, all included in the 78-file / 728-test full integration run reported in `MODULE_8_TOOL_RUNTIME_FOUNDATION.md`. Manual end-to-end execution confirmed via the route-level test using real seeded Brain knowledge (not mocked) — the full path from HTTP request through `invokeTool` through Brain search/retrieval through artifact creation through the Runtime's own completion gate, with no step skipped or stubbed.

## Update (Runtime Recovery and Workers, Module 9, now complete)

`runKnowledgeAnalystTask` (the synchronous, single-call path documented above) still exists unchanged, for tests and local development. Production task submission now goes through a split: `createKnowledgeAnalystTask` (execution + plan + enqueue, fast, no Brain/tool access) followed by a background worker calling the new `continueKnowledgeAnalystExecution` — the exact same search/retrieve/assemble/report logic this document describes, just resumable across process restarts instead of running to completion inside one HTTP request. No citation, plan-step, or report-shape logic changed. See `MODULE_9_RUNTIME_RECOVERY_AND_WORKERS.md`.
