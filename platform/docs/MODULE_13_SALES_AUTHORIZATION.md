# Module 13 — Sales OS Authorization & Privacy

Companion to `MODULE_13_SALES_OS.md`. Full detail on the permission model, its independence from CRM/Brain/Workflow/Projects, and the privacy rules governing Sales OS's read of CRM PII.

## The capability model

`src/lib/sales-os/authz.ts`. Four roles (`src/lib/sales-os/validation.ts`'s `SALES_ROLES`):

| Role | Capabilities |
|---|---|
| `sales_admin` | all nine |
| `sales_manager` | `sales_view`, `sales_work_leads`, `sales_manage_own_opportunities`, `sales_manage_team_opportunities`, `sales_assign_leads`, `sales_manage_forecasts` |
| `sales_rep` | `sales_view`, `sales_work_leads`, `sales_manage_own_opportunities` |
| `viewer` | `sales_view` |

Capabilities are a closed nine-value set (`SALES_CAPABILITIES`): `sales_view`, `sales_work_leads`, `sales_manage_own_opportunities`, `sales_manage_team_opportunities`, `sales_assign_leads`, `sales_manage_playbooks`, `sales_manage_forecasts`, `sales_manage_targets`, `sales_admin`. The mapping from role → capabilities lives in exactly one place, `ROLE_CAPABILITIES` in `authz.ts` — every `requireSalesXAuthority` function calls the shared `hasSalesCapability`/`requireSalesCapability` pair, never a raw `role === "..."` string comparison anywhere else in the module. This is what "map capabilities rather than relying only on role labels" means in this implementation: the storage model is the smallest safe one (a single role column per user per org), but no calling code is ever coupled to a specific role name.

Storage: `sales_role_assignments` — `organizationId`, `userId`, `role`, `grantedByUserId`, `revokedByUserId`, `revokedAt`, `revision`. One **active** role per user per organization, enforced by a partial unique index (`WHERE revoked_at IS NULL`). Revocation is soft (`revokedAt` set, row never deleted) — the grant history stays auditable, matching every other soft-revoke table in this codebase (`crm_agent_permission_grants`, `brain_permission_grants`).

## Organization owner/admin bootstrap

`resolveSalesAuthContext` returns `{ organizationId, actorUserId, orgRole, salesRole }`. `hasSalesCapability` returns `true` unconditionally for `orgRole ∈ {owner, admin}`, before even checking `salesRole` — this is the literal implementation of "Organization owner/admin may bootstrap/manage Sales OS configuration": an org admin can create the first team, grant the first Sales OS role, and configure Sales OS with zero setup, exactly as an ordinary CRM/Workflow org-admin override already works elsewhere in this codebase. It is not a stored role — an org owner/admin who is demoted immediately loses this bootstrap capability on their very next request, since it is recomputed from `organizationMemberships` on every call.

## Independence from CRM — and why "both gates" is automatic, not a manual double-check

Sales OS never calls `resolveCrmAuthContext`/`requireCrmManageAuthority` directly to "double-check" a CRM permission. Instead, every Sales OS service function that needs to mutate a CRM record calls the **real CRM Core function** — `updateLead`, `qualifyLead`, `disqualifyLead` — and that function's own internal `requireCrmManageAuthority` call is what enforces the CRM-side gate. The composition is structural: `assignLead` calls `requireSalesAssignLeadsAuthority` (Sales gate) and then `updateLead` (which itself calls `requireCrmManageAuthority` — CRM gate). Neither gate can be bypassed by satisfying only the other, and neither implies the other.

This has a concrete, testable consequence proven in `authz.integration.test.ts`: because `crm_leads` carries no `workspaceId` (leads are always org-wide per CRM Core's own design), `requireCrmManageAuthority` for a lead can only ever be satisfied by an org owner/admin — there is no workspace-manager escape hatch for leads. So a user granted full `sales_admin` capability who is only an ordinary org member (not owner/admin) can complete every Sales-OS-side check for `assignLead` and still fail at the CRM layer with `InsufficientRoleError` — proving the CRM gate is real, independently enforced, and not merely implied by Sales OS's own admin role.

## Per-record authority: own vs. team

Two composite guards layer capability-checking with record ownership, since "manage own opportunities" and "manage team opportunities" are inherently per-record:

- `requireSalesOpportunityWorkAuthority(ctx, opportunity)` — passes if the actor holds `sales_manage_team_opportunities` (broad), or holds `sales_manage_own_opportunities` **and** `opportunity.ownerUserId === actorUserId`.
- `requireSalesLeadWorkAuthority(ctx, lead)` — passes if the actor holds `sales_assign_leads` (broad — assignment/reassignment authority implies working any lead), or holds `sales_work_leads` **and** `lead.ownerUserId === actorUserId`.

Ownership is read directly from the CRM record (`crm_leads.owner_user_id`/`crm_opportunities.owner_user_id`) on every call — never cached, never denormalized into a Sales OS table.

## Denial and audit

`requireSalesCapability`'s failure path (`denyAndAudit`) records a `sales_permission_denied` audit event before throwing the shared `InsufficientRoleError` — identical shape to CRM's own `crm_permission_denied` and Projects' `project_permission_denied`. `metadata` carries only the capability name and a UUID-shaped target id (a non-UUID placeholder like `"new"`/`"list"` is kept out of the `targetId` column and moved into `metadata.attemptedTarget` instead, matching CRM authz's own guard against writing a non-UUID value into a `uuid` column).

## Reused error classes

`TenantResourceNotFoundError` and `InsufficientRoleError` (`src/lib/authz/errors.ts`) are reused directly, never redefined. Sales-OS-specific business-rule errors (`StaleSalesUpdateError`, `IneligibleAssigneeError`, `DuplicateActiveRunError`, `DuplicateActiveEnrollmentError`, `PlaybookVersionImmutableError`, `SalesRoleAlreadyGrantedError`, etc.) live in `src/lib/sales-os/errors.ts` as `DomainRuleViolationError` subclasses, the same base class every other module's domain errors extend.

## Agent CRM access — reused, not reinvented

The two Sales agents (Lead Research Assistant, Opportunity Summary Assistant) read CRM data exclusively through Module 12's existing `crm_agent_permission_grants` table and `agent-reads.ts` functions (`getContactForAgent`, `getCompanyForAgent`, `listActivitiesForAgent`, `listNotesForAgent`). Both are granted a narrow, explicit set of the six existing `CrmAgentPermission` values at seed time (`grantCrmAgentPermission`) — never a new grants table, never routed through Tool Runtime's `invokeTool` (Module 8's tool registry deliberately has no `crm.*` tool). Revoking a grant (`revokeCrmAgentPermission`) takes effect on the agent's very next read, verified directly in `concurrency.integration.test.ts`. Neither agent ever calls a CRM write function — `createLeadResearchTask`/`createOpportunitySummaryTask` import only read functions (`getLeadForUser`/`getOpportunityForUser` for the human-authorized fetch, `agent-reads.ts` for the agent-scoped fetch) plus `createArtifact`/`createExecution`/lifecycle functions from Agent Runtime.

## PII handling

Continues Module 12's privacy model exactly. Sales OS tables never store a copied contact email, phone, address, note content, or CRM activity summary — every reference is a bare uuid pointer (`leadId`, `opportunityId`, `evidenceActivityId`) resolved back through CRM's own services when actually displayed. Every `recordAuditEvent` call in `src/lib/sales-os/*.ts` passes only ids, enum values, and field-name lists — never a field's value — mirroring the exact rule CRM's own `crm_contact_updated` event metadata follows. Verified directly: `deterministic-outputs.integration.test.ts`'s PII test creates a contact with a real, distinctive email, runs it through assign → qualify, then asserts the email substring appears in zero rows of that organization's `audit_logs.metadata`.

Agent artifact **content** (the Lead Research Assistant's/Opportunity Summary Assistant's generated report) is the one place real CRM field values legitimately appear — a contact's name, email, and job title are genuinely useful in an internal research report, exactly as Knowledge Analyst's own cited-knowledge reports contain real knowledge-item content. This is not a PII leak: artifact content is access-controlled the same way the underlying agent execution is (via `getExecutionForUser`'s own authorization), and it is never written into audit metadata, workflow configuration, or next-best-action `sourceSignals` — those three surfaces are held to the stricter ids-and-enums-only rule throughout.

## Update (CRM/Sales Lead Qualification Authorization Hardening, Module 14, now complete)

A new, narrower sibling to `requireSalesLeadWorkAuthority` for exactly one action: `requireSalesLeadQualificationAuthority` scopes manager-tier (`sales_assign_leads`) authority to a lead whose assigned rep is on a real Sales team (`salesTeamMembers`) the manager actually manages — never "any manager, any lead org-wide" the way `requireSalesLeadWorkAuthority` still allows for ordinary lead-working actions. Reaching CRM Core through this new gate additionally requires CRM's own narrow `requireCrmLeadQualificationAuthority` to pass — the two-gate composition this doc already describes for `assignLead`/`updateLead`/`qualifyLead` continues to hold, just with a narrower Sales-side rule and a narrower CRM-side rule for this one pair of actions. See `MODULE_14_CRM_SALES_QUALIFICATION_AUTHORIZATION.md` for the full model, including actor attribution and concurrency behavior.
