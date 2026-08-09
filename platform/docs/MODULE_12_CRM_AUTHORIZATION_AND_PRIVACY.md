# Module 12 — CRM Authorization and Privacy

Companion to `MODULE_12_CRM_CORE.md`, detailing exactly who — and which agent — may do what to CRM data, and how PII is protected throughout. All enforcement is server-side, in `src/lib/crm/authz.ts`, `src/lib/crm/agent-permissions.ts`, `src/lib/crm/agent-reads.ts`, and the individual service functions that call them.

## Human authorization

No generic department/CRM-manager role model exists yet in this codebase, and the module spec is explicit: do not invent a global role without review. The smallest safe interim authority is a two-tier model, identical in shape to Workflow Engine authorization (Module 11):

| Floor | Grants |
|---|---|
| **VIEW** (`requireCrmViewAuthority`) | Org owner/admin; any workspace member for a workspace-scoped record; any organization member for an org-wide record |
| **MANAGE** (`requireCrmManageAuthority`) | Org owner/admin, or this workspace's own manager for a workspace-scoped record — create/update/archive a contact/company/lead/opportunity/pipeline/stage/activity/note/follow-up/tag/tag-assignment/project-link |
| **ADMIN** (`requireCrmAdminAuthority`) | Org owner/admin only, no workspace-manager override — the one floor for cross-cutting, org-wide configuration: custom field definitions and agent permission grants (neither is workspace-scoped in this phase) |

Ordinary members get read access and nothing else this phase — granular per-record sales-rep permissions ("a rep may edit their own leads but not others'") are explicitly deferred to Sales OS. **Record ownership is a label only** — `ownerUserId` never overrides these boundaries, verified directly by a test where an ordinary member who owns nothing still cannot create a contact, and creating a contact owned by a non-elevated user still requires manage authority from the *creator*, not the owner.

Contacts, companies, and opportunities carry their own `workspaceId` directly. Leads, activities, notes, and follow-ups do not — their authorization scope is resolved live from whichever linked contact/company/opportunity governs them (`resolveCrmEntityWorkspaceId`), never denormalized onto the child record itself.

## Cross-tenant behavior

Every read/write path resolves the target record by `(id, organizationId)` together before any role check runs (`resolveContactById`, `resolveCompanyById`, `resolveLeadById`, `resolveOpportunityById`, `resolvePipelineById`, all wrapped in `requireTenantScopedResource`). A record belonging to a different organization is `TenantResourceNotFoundError` (HTTP 404) — structurally indistinguishable from a record that never existed, verified directly for contacts.

## Denial auditing

Every authorization failure in `src/lib/crm/authz.ts` calls `denyAndAudit` before throwing `InsufficientRoleError` — a `crm_permission_denied` audit event is recorded with the organization, the acting user, the target type, and a short `detail` string. **A real bug was found and fixed here during this module's own testing**: `audit_logs.target_id` is a genuine `uuid` column, but several authority checks (creating a new record, listing) have no existing entity id to point at — the original code passed placeholder strings like `"new"`/`"list"` directly as `targetId`, which crashed the audit INSERT with a Postgres type error and masked the intended `InsufficientRoleError` behind a raw database exception instead. `denyAndAudit` now validates the shape of `targetId` before writing it: a genuine UUID is passed through as `targetId`; anything else is kept as `metadata.attemptedTarget` instead and `targetId` is written as `NULL` (the column is nullable). The identical fix was applied to `agent-reads.ts`'s own denial path, which had the same bug (passing the permission name itself, e.g. `"crm_contact_read"`, as `targetId`).

## Agent CRM permission model

Structurally separate from Brain permission grants (Module 3/16) — `crm_agent_permission_grants` is its own table with its own 6-value closed permission enum, checked independently everywhere in this module:

```
crm_contact_read, crm_company_read, crm_lead_read, crm_opportunity_read, crm_activity_read, crm_note_read
```

**Default deny, verified directly**: an agent with zero rows in `crm_agent_permission_grants` can read no CRM data at all, regardless of its Brain grants, department, or Agent Runtime permission level — a test grants an agent Brain `identity` read access and confirms every CRM read still throws `InsufficientRoleError`. Each of the 6 agent-read functions in `agent-reads.ts` (`listContactsForAgent`, `getContactForAgent`, `listCompaniesForAgent`, `getCompanyForAgent`, `listLeadsForAgent`, `getLeadForAgent`, `listOpportunitiesForAgent`, `getOpportunityForAgent`, `listActivitiesForAgent`, `listNotesForAgent`) checks its own exact corresponding permission before touching the database — an agent holding only `crm_contact_read` cannot read companies, leads, opportunities, activities, or notes, verified directly.

Grants are org-scoped only in this phase (the smallest safe interim authority, matching the spec's own instruction) — no workspace-scoped agent grant exists yet. Revocation is soft (`revokedAt`/`revokedByUserId`), never a row delete, so the grant history stays auditable; access is re-checked live on every single read (`agentHasCrmPermission`), never cached — revoking a grant takes effect on the very next call, verified directly. Granting the same permission to the same agent twice while an active grant already exists is rejected by `crm_agent_permission_grants_active_unique` (`DuplicateAgentGrantError`).

Only org owner/admin may grant or revoke a CRM agent permission (`requireCrmAdminAuthority`) — never a workspace manager, and never the agent itself. No agent-callable write path exists anywhere in this module (agents may only read); CRM writes always require a real human session.

## PII and privacy

Data minimization is enforced structurally, not just by convention:

- **Audit metadata never contains PII** — verified directly by a test that creates a contact with a real email/phone and a note with real content, then asserts the org's *entire* audit log (every row, not just the ones for that record) never contains the email, phone digits, or note text as a substring. Every audit call in this module passes only ids, enum values, and field-name lists as metadata — never field *values*.
- **Notes are internal-only** — no route, agent-read function, or public API path in this module ever returns note content to an unauthenticated caller; the one authenticated path that can read notes at all is gated by `crm_note_read` for agents and ordinary CRM view authority for humans.
- **Custom field values are validated, never executable** — `validationRules` is bounded metadata only (min/max/length/pattern); no field type in the closed `fieldType` enum can hold code, SQL, or a formula.
- **Brain search never surfaces CRM PII** — this module writes nothing to `knowledge_items`, and no CRM table is ever indexed or read by Brain's own search machinery; the two systems have no code-level connection at all.
- **API responses expose only fields the caller is authorized to read** — the same authorization gate that decides *whether* a record is returned decides the entire response; there is no separate field-redaction layer, because an unauthorized caller never reaches the point of receiving a response body at all (an authorization failure throws before any query result is serialized).

## Verified by tests

- Cross-tenant contact access resolves to 404 at the service layer.
- CRM authorization is independent from Brain grants — a Brain-only grant confers zero CRM access.
- Default-deny CRM agent access — a zero-grant agent cannot read any CRM data.
- An explicit `crm_contact_read` grant allows contact reads but not company/lead/opportunity/note reads.
- Revoking a grant immediately removes access on the next read.
- Duplicate agent permission grants are rejected.
- No email, phone, or note content ever appears in audit metadata.
- Search never leaks data across tenants.
- An ordinary org member can view but not create CRM records; record ownership does not grant write access.

## Update (CRM/Sales Lead Qualification Authorization Hardening, Module 14, now complete)

A narrow, operation-scoped exception to this doc's authorization model, for lead qualification/disqualification only: `requireCrmLeadQualificationAuthority` (`crm/authz.ts`) additionally passes for a lead's own recorded assigned owner, or for a caller Sales OS has already authorized through its own team-scoped authority gate (`preAuthorizedBySalesOs`, set only by the narrow `qualifyLeadFromSales`/`disqualifyLeadFromSales` entry points, never part of any public API). This does **not** broaden `requireCrmManageAuthority` itself, and does not give leads a workspace-manager escape hatch — every other CRM write on a lead (updating fields, converting it) still requires the same org-owner/admin-only floor this doc already documents. `qualifyLead`/`disqualifyLead` are unchanged. See `MODULE_14_CRM_SALES_QUALIFICATION_AUTHORIZATION.md` for the full dual-gate design, actor attribution, and concurrency behavior.
