# Module 15 — Marketing OS Authorization & Privacy

Companion to `MODULE_15_MARKETING_OS.md`. Full detail on the permission model, its independence from CRM/Brain/Sales OS/Workflow/Projects, agent access, and the privacy rules governing Marketing OS's read of CRM data.

## The capability model

`src/lib/marketing-os/authz.ts`. Four roles (`src/lib/marketing-os/validation.ts`'s role set):

| Role | Capabilities |
|---|---|
| `marketing_admin` | all nine |
| `marketing_manager` | `marketing_view`, `marketing_create_campaigns`, `marketing_manage_campaigns`, `marketing_manage_content`, `marketing_manage_audiences`, `marketing_manage_budget`, `marketing_approve_content` |
| `marketing_contributor` | `marketing_view`, `marketing_create_campaigns`, `marketing_manage_content` |
| `viewer` | `marketing_view` |

Capabilities are a closed nine-value set: `marketing_view`, `marketing_create_campaigns`, `marketing_manage_campaigns`, `marketing_manage_content`, `marketing_manage_audiences`, `marketing_manage_budget`, `marketing_approve_content`, `marketing_manage_playbooks`, `marketing_admin`. The role → capabilities mapping lives in exactly one place, `ROLE_CAPABILITIES` in `authz.ts`; every `requireMarketingXAuthority` function calls the shared `hasMarketingCapability`/`requireMarketingCapability` pair, never a raw `role === "..."` comparison elsewhere in the module.

Storage: `marketing_role_assignments` — `organizationId`, `userId`, `role`, `grantedByUserId`, `revokedByUserId`, `revokedAt`, `revision`. One **active** role per user per organization, enforced by a partial unique index (`WHERE revoked_at IS NULL`). Revocation is soft — the grant history stays auditable, matching every other soft-revoke table in this codebase (`sales_role_assignments`, `crm_agent_permission_grants`, `brain_permission_grants`).

## Organization owner/admin bootstrap

`resolveMarketingAuthContext` returns `{organizationId, actorUserId, orgRole, marketingRole}`. `hasMarketingCapability` returns `true` unconditionally for `orgRole ∈ {owner, admin}`, before even checking `marketingRole` — an org admin can create the first team, grant the first Marketing OS role, and configure Marketing OS with zero setup, identical to Sales OS's own bootstrap. It is not a stored role — recomputed from `organizationMemberships` on every call, so a demoted admin loses it on their very next request.

## Independence from CRM, Brain, and Sales OS — and why "both gates" is automatic

Marketing OS never calls `resolveCrmAuthContext`/`requireCrmManageAuthority`/`requireCrmViewAuthority` "to double-check" a CRM permission as a manual second step. Instead, every Marketing OS function that needs to read or write CRM data either calls the **real CRM Core function** directly (`createLead` in `handoff.ts` — inherits `createLead`'s own internal CRM gate) or explicitly composes both gates in sequence where CRM Core has no single function to delegate to (`evaluateAudience` in `audiences.ts` calls `requireMarketingViewAuthority` first, then CRM Core's own `requireCrmViewAuthority` — both must independently pass; Marketing OS capability alone is never sufficient to read live CRM records, and CRM view authority alone is never sufficient without Marketing OS's own gate first).

Brain grants (`brain_permission_grants`) are never read or written by any Marketing OS authorization path — a Brain domain grant confers no Marketing OS capability, and a Marketing OS role confers no Brain access. Similarly, CRM permissions and Sales OS roles are never substituted for a Marketing OS capability check: a user with full `sales_admin` capability but no Marketing OS role assignment cannot create a campaign, and a `marketing_admin` with no CRM role cannot read a CRM contact except through the narrow, explicit paths this doc describes below.

This has a concrete, testable consequence proven in `functional.integration.test.ts`: granting a user `marketing_admin` alone does not grant them CRM manage authority, and vice versa — the two role systems are provably orthogonal, not layered defaults of one another.

## Marketing OS membership does not imply agent access

A user's Marketing OS role — even `marketing_admin` — grants **zero** agent execution authority by itself. Launching a Marketing agent task (`launchCampaignBriefAction`, etc.) still goes through the real Agent Runtime's own `createExecution`/`assignExecution`/`startExecution` lifecycle, which enforces its own independent checks; nothing in Marketing OS's authorization layer short-circuits or substitutes for that. Verified directly: an unseeded organization (no Marketing agents registered) rejects every agent-launch action regardless of the caller's Marketing OS role — default deny, not "any Marketing admin can invoke any agent."

## Agent CRM access — reused, not reinvented

None of the three Marketing agents (Campaign Brief Assistant, Content Draft Assistant, Campaign Summary Assistant) read CRM PII directly. The Campaign Brief Assistant reads campaign fields and audience **metadata** (count, filter definition, entity type — never member-level detail); the Campaign Summary Assistant aggregates real operational Marketing OS data (campaign status, content counts, run/approval state, budget) plus CRM-derived counts already computed through `analytics.ts`'s own dual-gated functions — never a raw CRM record read. Where a future Marketing agent genuinely needs individual CRM record access, it would use Module 12's existing `crm_agent_permission_grants` mechanism exactly as Sales OS's two agents already do — no new grants table exists or is needed for this module's three agents, since none of them require it.

## Per-action authorization summary

| Action | Marketing gate | Additional gate |
|---|---|---|
| Create/update/transition campaign | `marketing_create_campaigns` / `marketing_manage_campaigns` | — |
| Create/update audience | `marketing_manage_audiences` | — |
| **Evaluate** audience (query live CRM) | `marketing_view` | CRM `requireCrmViewAuthority` |
| Create/update content | `marketing_manage_content` | — |
| Approve/reject content | `marketing_approve_content` | Runtime's own human-actor-only `approveRequest`/`rejectRequest` |
| Manage playbooks | `marketing_manage_playbooks` | — |
| Manage budget | `marketing_manage_budget` | — |
| Sales handoff (create CRM lead) | `marketing_manage_campaigns` (campaign-scoped) | CRM Core's own `createLead` gate |
| Analytics (CRM-derived figures) | `marketing_view` | CRM `requireCrmViewAuthority` |
| Launch a Marketing agent task | Marketing capability appropriate to the task | Agent Runtime's own execution lifecycle checks |
| Any Marketing OS administration | `marketing_admin` | — |

## Denial and audit

`requireMarketingCapability`'s failure path (`denyAndAudit`) records a `marketing_permission_denied` audit event before throwing the shared `InsufficientRoleError` — identical shape to CRM's `crm_permission_denied`, Sales OS's `sales_permission_denied`, and Projects' `project_permission_denied`. Metadata carries only the capability name and a UUID-shaped target id (non-UUID placeholders are kept out of the `targetId` column, matching the established guard elsewhere in this codebase).

## Reused error classes

`TenantResourceNotFoundError` and `InsufficientRoleError` (`src/lib/authz/errors.ts`) are reused directly, never redefined. Marketing-OS-specific business-rule errors (`StaleMarketingUpdateError`, `InvalidMarketingTransitionError`, `MarketingKeyAlreadyTakenError`, `PlaybookNotPublishedError`, `PlaybookVersionImmutableError`, `DuplicateActiveRunError`, `MarketingRoleAlreadyGrantedError`, `MarketingAgentNotSeededError`, `MarketingWorkflowTemplateNotSeededError`, `InvalidAudienceFilterError`, `ContentNotApprovableError`, `AgentCannotApproveOwnContentError`, `CampaignRequirementsIncompleteError`) live in `src/lib/marketing-os/errors.ts` as `DomainRuleViolationError` subclasses, the same base class every other module's domain errors extend.

## The safe audience filter registry — why it's safe

`audience-filters.ts`'s `REGISTRY` is a fixed, in-code `Record<EntityType, Record<FieldName, {column, valueType}>>` — the only fields ever compilable into a filter are ones an engineer explicitly added to this map (e.g. contact: `lifecycleStage`/`status`/`sourceId`/`ownerUserId`; lead: adds `companyId`/`contactId`). `compileAudienceFilter` never accepts a raw SQL fragment, never performs string interpolation into a query, and never resolves a field name dynamically via `require`/`import` — it is a pure lookup-then-compile function returning real drizzle `and(eq/ne/inArray/isNull/isNotNull)` expressions. An unrecognized field name or a value shape that doesn't match the field's declared `valueType` throws `InvalidAudienceFilterError` before any query runs. This mirrors the "no dynamic require/import" discipline Module 14's task handler registry already established for a different kind of open-ended input (agent task types).

## Cross-tenant audience evaluation safety

Every `compileAudienceFilter` result is combined with an explicit `eq(table.organizationId, organizationId)` condition before the query runs — verified directly in `functional.integration.test.ts` that evaluating an audience scoped to one organization can never return record ids belonging to another organization's CRM data, even when the filter definition itself contains no tenant-scoping field.

## PII handling

Continues Module 12/13's privacy model exactly. Marketing OS tables never store a copied contact/lead email, phone, address, note content, or CRM activity summary — every reference is a bare uuid pointer resolved back through CRM's own services when actually displayed. Every `recordAuditEvent` call in `src/lib/marketing-os/*.ts` passes only ids, enum values, counts, and field-name lists — never a field's value. Verified directly: `functional.integration.test.ts`'s Sales-handoff test creates a lead with a real, distinctive email through `createLeadFromCampaign`, then asserts the email substring appears in zero rows of that organization's `audit_logs.metadata`, and separately that it appears in zero columns of the resulting `marketing_attribution_records` row.

Content **bodies** (the actual draft/brief text an agent or human writes) live exclusively in Runtime `agent_artifacts` rows, access-controlled the same way any other artifact already is — never duplicated into a `marketing_content_items` column, an audit event, a next-best-action `sourceSignals` payload, or workflow node configuration. Those three surfaces are held to the stricter ids-and-enums-only rule throughout, identical to Sales OS's own artifact-content exception documented in `MODULE_13_SALES_AUTHORIZATION.md`.

Audience privacy is additionally bounded at the query layer itself (not just at the display layer): `evaluateAudience` never selects or returns full CRM rows — only `id` columns and a plain count, so there is no code path where a broader CRM record accidentally flows into a Marketing OS response even before any display-layer filtering would apply.
