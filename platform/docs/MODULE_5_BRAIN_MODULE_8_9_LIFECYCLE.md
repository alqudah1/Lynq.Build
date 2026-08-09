# Brain Modules 8 & 9 — Draft Workflow & Review/Approval

Implements Modules 8–9 of `MODULE_5_BRAIN_IMPLEMENTATION_PLAN.md`, on top of Modules 1–7. Built together (one state machine, one file) since the plan itself sequences them as directly-extending steps. `MODULE_3_BRAIN_ARCHITECTURE.md` §4's full lifecycle:

```
Idea → Draft → Review → Approved → Published
                 ↑↓         ↓          ↓
               (back)    Archived ← Archived
                            ↓↑
                         Retired   (any non-terminal state → Retired)
```

## Schema decision: extended the existing enum, not a new column

`knowledgeItemStatusEnum`'s own original comment (written during Module 2) already anticipated this: `ALTER TYPE ... ADD VALUE` in place, never a second `lifecycleState` column — a second column would have been the exact "duplicated mutable state" this schema avoids everywhere else (see `knowledgeItems`' own comment on why `revision` was removed rather than kept alongside `versionNumber`). `drizzle/0012_quick_rumiko_fujikawa.sql` adds `idea, review, approved, published, retired, purged` (order: `idea, draft, review, approved, published, archived, retired, purged`) plus `approved_by_user_id/at`, `published_by_user_id/at`, `retired_by_user_id/at`, `retired_reason` on `knowledge_items` — applied and verified live (the established statement-by-statement workaround for `drizzle-kit migrate`'s unreliability here).

`idea` and `purged` are real, storage-ready values with **no code path that produces them** — `createKnowledgeItem` still lands directly on `draft` (Module 1, unchanged), and `purge` requires "Founder's Office and Security & Trust jointly," an organizational-role concept this codebase has no model for at all (Module 6 never resolved department ownership either). Building a fake role mapping for an irreversible-deletion path would have been a real data-loss risk — deferred, not silently approximated. See "Deferred" below.

## New service: `src/lib/brain/lifecycle.ts`

Six transitions, each: resolve item (gates 1–4) → capability check → verify current status is a legal source (`InvalidLifecycleTransitionError` if not, 409) → atomic `UPDATE ... WHERE status = <expected-from>` (the same "WHERE clause is the complete concurrency guard" precedent `archiveRelationship` established — no version-number token needed, status has no other mutable field to protect) → on 0-row race loss, `knowledge_lifecycle_conflict` audit + reject.

| Function | Transition | Capability |
|---|---|---|
| `submitKnowledgeItemForReview` | Draft → Review | ordinary edit (`edit_own_draft`/`edit_any_draft`) |
| `sendKnowledgeItemBackToDraft` | Review → Draft | ordinary edit |
| `approveKnowledgeItem` | Review → Approved | `approve` + human-only (see below) |
| `publishKnowledgeItem` | Approved → Published | `approve` (shares grant level — §15.5's deferred decision) |
| `restoreKnowledgeItem` | Archived → Approved | `approve` + human-only — "a re-approval, not a technicality" |
| `retireKnowledgeItem` | any non-terminal → Retired | `archive` (closest existing capability; no department model to key off) |

`archiveKnowledgeItem` (Module 1, `knowledge-items.ts`) was **extended, not duplicated**: now legal from `approved`/`published` too (§4's explicit diagram edges), still legal from `idea`/`draft`/`review` (Module 1's original shipped behavior, preserved), newly rejected from `retired`/`purged`.

**Human-only approval** (§9's single hardest-enforced rule): `assertHumanActor()` is a structural no-op today — no agent identity exists anywhere in this codebase yet (Modules 16/17, deliberately later). It's the one designated call site so wiring "agents can never approve" later is a single-function change, not an audit of every call site.

**Content edits blocked outside Draft**: `updateKnowledgeItem` now throws the new `KnowledgeItemNotEditableError` for any non-`draft` status (previously only checked `archived`) — editing an Approved/Published item's content directly would leave an unreviewed version sitting as "current" under an Approved label, silently invalidating the approval signal. Sending an item back to Draft (a separate, explicit call) is the only path back to editability.

## Errors, audit, validation

`InvalidLifecycleTransitionError` (409, `invalid_lifecycle_transition`), `KnowledgeItemNotEditableError` (409, `item_not_editable`). Seven new audit events (`knowledge_item_submitted_for_review/sent_back_to_draft/approved/published/restored/retired`, `knowledge_lifecycle_conflict`); `knowledge_item_archived` reused unchanged. `retireReasonSchema`/`KNOWLEDGE_ITEM_STATUSES` added to `validation.ts`; `knowledgeItemStatusSchema` (the existing list-filter export) widened in place to the full 8-value set — no new endpoint accepts a client-supplied target status directly, so illegal transitions stay structurally unrepresentable, not just rejected after validation.

## API routes

`POST .../knowledge/{id}/submit-for-review`, `.../send-back-to-draft`, `.../approve`, `.../publish`, `.../restore`, `.../retire` (body: `{ reason }`). `.../archive` (Module 1) unchanged, now reachable from more states.

## Files
**Created**: `src/lib/brain/lifecycle.ts`, `lifecycle.integration.test.ts`, 6 route files + 1 route test file, `drizzle/0012_quick_rumiko_fujikawa.sql`, this doc.
**Modified**: `schema.ts` (enum + columns), `errors.ts`, `validation.ts`, `audit.ts`, `knowledge-items.ts` (type widened, two new guards, archive JSDoc).

## Tests / verification
16 lifecycle integration tests + 3 route tests (full happy-path walk through every route, illegal-transition rejections including the mandatory "Draft → Approved never legal" regression guard, capability-gating, concurrent-approve race, content-edit-blocked, archive-from-new-states, cross-tenant). Full regression: `npm run test` 188/188, `npm run test:integration` 540/540 (52 files), `npm run test:a11y` 52/52, `typecheck`/`lint`/`build`/`db:check` all clean. DB confirmed empty after tests.

## Deferred (documented, not silently dropped)
- **`Purged`**: no organizational-role model exists for "Founder's Office + Security & Trust" — a real gap, not implemented, rather than risk a fake mapping on an irreversible-deletion path.
- **Separate `publish` grant** (§15.5): shares `approve` for now, per the plan's own explicit deferral.
- **Reviewer assignment / Decision tracking**: not in Modules 8–9's stated scope (Module 14).
