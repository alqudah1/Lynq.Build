# Module 14 — CRM/Sales Lead Qualification Authorization Hardening

Companion to `MODULE_13_SALES_AUTHORIZATION.md` and `MODULE_12_CRM_AUTHORIZATION_AND_PRIVACY.md`. Full detail on the narrow, dual-gated authority path that lets an eligible Sales rep or manager qualify/disqualify a CRM lead — without broadening general CRM manage authority, and without duplicating `qualifyLead`/`disqualifyLead`'s logic in Sales OS.

## The problem

`crm_leads` carries no `workspaceId` — leads are always org-wide by CRM Core's own Module 12 design, so `requireCrmManageAuthority` for a lead can only ever be satisfied by an org owner/admin; there is no workspace-manager escape hatch for leads specifically (documented and proven in `MODULE_13_SALES_AUTHORIZATION.md`). Before Module 14, `qualifyLeadViaRun`/`disqualifyLeadViaRun` called CRM's `qualifyLead`/`disqualifyLead` directly, which meant an ordinary sales rep — assigned to the lead, having just completed its qualification checklist — could never actually qualify it. Only an org admin could complete the exact workflow the whole qualification-run feature exists to support.

## The fix, in one sentence

One private CRM Core transition primitive (`applyLeadQualificationTransition`, `crm/leads.ts`), two pairs of authorized entry points: `qualifyLead`/`disqualifyLead` (unchanged, full manage authority) and `qualifyLeadFromSales`/`disqualifyLeadFromSales` (new, narrow authority) — never a second, duplicated qualify/disqualify implementation in Sales OS.

## The dual gate

**Gate 1 — Sales OS, `requireSalesLeadQualificationAuthority` (`sales-os/authz.ts`).** Passes for exactly one of:

- `sales_admin` capability (org-admin bootstrap, or an explicit `sales_admin` role) — org-wide.
- `sales_work_leads` capability **and** the lead is assigned to the caller.
- `sales_assign_leads` capability (manager-tier) **and** the lead has an assigned owner **and** that owner is on a real Sales team the caller manages (`isTeamManagerOfRep`, `sales-os/teams.ts` — `salesTeamMembers` rows where the caller holds `teamRole: "manager"` on a team the lead's owner is also an active member of).

This is deliberately **narrower** than the pre-existing `requireSalesLeadWorkAuthority` (which lets any `sales_assign_leads` holder — any manager/admin — work ANY lead org-wide, no team-scope check at all). Ordinary lead-working actions (checklist item updates, notes) still use the broader existing rule; only the final qualify/disqualify decision uses this new, team-scoped one — the module's own explicit instruction was to change only this one authority, not redesign Sales OS authorization broadly.

An **unassigned lead** (`ownerUserId === null`) can never pass the manager-tier branch — there is no rep to check team membership against. This is deliberate, not an oversight: an unassigned lead's qualification requires an explicit `sales_admin`/org-admin decision, never an assumed manager grant.

**Gate 2 — CRM Core, `requireCrmLeadQualificationAuthority` (`crm/authz.ts`).** Passes for:

- Org owner/admin (the same floor `requireCrmManageAuthority` already used).
- The lead's own recorded `ownerUserId` matching the caller — independently verifiable by CRM using its own data, no Sales OS knowledge required.
- `preAuthorizedBySalesOs: true` — set only by `qualifyLeadFromSales`/`disqualifyLeadFromSales`, only reachable after Gate 1 has already run. This fills the one gap CRM cannot verify on its own (Sales team membership is not a CRM concept), without CRM independently re-deriving Sales-specific logic. `qualifyLeadFromSales`/`disqualifyLeadFromSales` are not part of any public/user-facing API — their only caller is `sales-os/qualification.ts`.

Neither gate alone is sufficient; both are ordinary function calls on the direct call path (`qualifyLeadViaRun` → `requireQualificationOutcomeAuthority` (Gate 1) → `qualifyLeadFromSales` → `requireCrmLeadQualificationAuthority` (Gate 2)) — there is no way to reach the CRM transition through this path without both having run.

## Actor attribution

`applyLeadQualificationTransition`'s audit event carries bounded metadata only: `sourceSubsystem: "sales_os"`, `qualificationRunId`, `playbookVersionId` — never PII, free-text notes, checklist answers, or reasoning. The event type itself distinguishes the path taken: `crm_lead_qualified_via_sales`/`crm_lead_disqualified_via_sales` (Sales path) vs. `crm_lead_qualified`/`crm_lead_disqualified` (direct/admin path) — exactly one fires per transition, never both, so the CRM audit trail remains authoritative and never duplicated. Sales OS additionally records its own operational events referencing the same qualification run: `sales_qualification_completed` (unchanged, backward-compatible) and the new `sales_qualification_outcome_applied` (adds `playbookVersionId` and an explicit `outcome` code). A denial at either gate records `sales_qualification_permission_denied` (actor, lead id, run id) in addition to whichever gate's own generic denial event fired (`sales_permission_denied` or `crm_permission_denied`).

## Checklist completeness

`qualifyLeadViaRun` now requires `run.missingInformation.length === 0` before calling `qualifyLeadFromSales` — throws `QualificationChecklistIncompleteError` (`sales-os/errors.ts`) otherwise. This did not previously exist: a run with incomplete required checklist items could be qualified anyway. **Disqualification has no such gate** — a lead can be recognized as unqualified and disqualified at any point in the run, deliberately.

## Qualification-run integrity and concurrency

- A run must belong to the lead being acted on (`resolveQualificationRunById` is tenant- and id-scoped).
- The playbook version must have been published (`startQualificationRun` already required this; unchanged).
- A stale qualification-run revision fails via the run's own `expectedRevision`-guarded `UPDATE`.
- **Two racing outcomes on one run resolve deterministically at the CRM lead's own revision guard, not the run's.** Both a qualify and a disqualify call read the same starting `lead.revision`; CRM Core's `applyLeadQualificationTransition` performs one `UPDATE crm_leads ... WHERE revision = expected AND status = existing.status`, so only one of the two concurrent calls can ever succeed — the other receives `StaleCrmUpdateError` before it ever reaches the qualification run's own update. This is intentional: the canonical lead is the single source of truth, and the run row is documentation of that outcome, not a second authority over it. Verified directly in `module14-qualification-authorization.integration.test.ts`.
- If CRM's transition succeeds but the subsequent qualification-run `UPDATE` fails its own revision guard (a genuinely stale run row, independent of the lead race above), `qualifyLeadViaRun`/`disqualifyLeadViaRun` throw `StaleSalesUpdateError` — the CRM lead has already durably transitioned by this point (correct, since CRM Core is the source of truth), and the caller sees a clear "reload and retry" error rather than an ambiguous partial-success state. There is no multi-statement transaction wrapping the two updates (the Neon HTTP driver used throughout this codebase does not support interactive transactions) — the CRM write is the durable, authoritative step; the run row is a best-effort trail that a subsequent read (`resolveQualificationRunById`) always reflects correctly relative to the canonical lead regardless of whether its own update raced.

## The rep self-service boundary

This module changes **only** final lead qualification/disqualification authority. A rep still cannot, via this path or any other: edit a contact/company, change pipeline configuration, modify a lead not assigned to them (outside qualify/disqualify — `requireSalesLeadWorkAuthority`'s existing, broader-for-managers rule still governs ordinary lead-working actions), bypass assignment, reopen a closed opportunity, or manage custom fields/CRM permissions/agent grants/source definitions. None of those authority checks were touched.

## UI

`src/app/app/[organizationSlug]/sales/leads/[leadId]/page.tsx` now computes, server-side, whether the current viewer is actually authorized (`requireSalesLeadQualificationAuthority`, non-throwing check) and whether the checklist is complete, and renders accordingly: the real Qualify/Disqualify buttons when both hold, the actual blocking reason (not authorized, or which condition is unmet) when they don't. The underlying server actions still independently re-run both gates on submit — the page's own check only decides what is *shown*, never what is *allowed*; server-side authority remains the only source of truth.
