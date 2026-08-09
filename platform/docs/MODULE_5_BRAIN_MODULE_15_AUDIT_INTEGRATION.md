# Brain Module 15 — Audit Integration

Implements Module 15. Two deliverables: (1) a completeness sweep proving Modules 1–14's mutations all produce their audit event, (2) the separate `AccessLogEntry` read log `MODULE_3_BRAIN_ARCHITECTURE.md` §11 describes. `audit_logs` itself is untouched (already free-text `event_type`, per Module 2's own design).

## Schema
`drizzle/0015_slim_dexter_bennett.sql` — new `access_actor_type` enum (`human`/`agent`) + `access_log_entries` table (org/actor/domain/workspace/target, `createdAt` only — write-only, no `updatedAt`, a structural immutability signal like `knowledge_item_sources`). Applied and verified live.

## `src/lib/brain/access-log.ts`

`recordAccessLogEntry` + policy gate `shouldLogAccess` — §15.6's interim resolution (deliberately left open by the architecture): agent reads always logged at full fidelity (AGENT_FRAMEWORK §11's non-negotiable rule); human reads deferred entirely, not sampled at an arbitrary unjustified rate. No agent identity exists yet (Modules 16/17), so this table receives no real traffic today — it exists as the one call site Module 16's agent read API needs, not a table designed under time pressure later. Write-only: no update/delete function anywhere in the module (proven directly by a structural test).

## Completeness sweep

`audit-completeness.integration.test.ts` — one connected walkthrough (not per-module spot checks) exercising every mutating operation across Modules 1, 2, 3, 4, 7, 8/9, 13, 14 in sequence (bootstrap → grant → update-grant → revoke; item create/update/version-restore; relationship create/archive; trust/source/evidence; full lifecycle walk including the review↔draft loop; decision supersession + outcome), then asserts all 21 expected success event types appear in `audit_logs` for that run. Denial/conflict events (`knowledge_access_denied`, `brain_permission_denied`, `*_conflict`) are already covered by each module's own dedicated tests and intentionally out of this sweep's scope (which is specifically mutation-success completeness, per the plan's own wording).

## Tests
`access-log.integration.test.ts` (4 tests): policy gate correctness, agent-read row written, human-read no-op, no update/delete path. `audit-completeness.integration.test.ts` (1 test, 21-event sweep).

## Verification
Full suite: unit 188/188, integration 583/583 (60 files), a11y 52/52, typecheck/lint/build/db:check clean, DB empty after tests.
