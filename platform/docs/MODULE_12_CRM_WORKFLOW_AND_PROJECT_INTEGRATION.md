# Module 12 — CRM Workflow and Project Integration

Companion to `MODULE_12_CRM_CORE.md`, detailing how CRM records connect to Projects Core (Module 10) and the Workflow Engine (Module 11) — always as typed pointers to the real records those modules already own, never a duplicate of their data or a parallel mechanism.

## Projects integration

`crm_project_links` (`src/lib/crm/project-links.ts`) is a typed pointer table — `organizationId, projectId, crmEntityType (contact | company | opportunity), crmEntityId, linkedByUserId?, createdAt` — mirroring `project_artifact_links`'s own typed-pointer pattern from Module 10 exactly. `createProjectLink` resolves the target project through Projects Core's own, completely unmodified `resolveProjectById` before creating the link, so a link can never point at a nonexistent or cross-tenant project.

**Never duplicates project data inside CRM** — verified directly by a test asserting a link's own serialized JSON never contains the linked project's name or any other project field, only ids. Duplicate links (same project + same CRM entity) are rejected by `crm_project_links_unique`, verified directly including under a genuine concurrent race (`Promise.allSettled`, exactly one of three simultaneous link-creation calls succeeds).

**No automation exists in this module.** The spec's own example — "a won opportunity may later create a project through a Workflow" — is explicitly *not* implemented here; there is no code path anywhere in this module that creates a project, links one automatically on any CRM state change, or reacts to an opportunity being won. That automation, if it's ever built, belongs to a future Workflow definition using the Workflow Engine's own existing trigger/execution machinery — never hardcoded into CRM's own service layer.

The CRM detail pages (contact, company, opportunity) render linked projects read-only, following the pointer to Projects Core's own real pages (`/app/{organizationSlug}/projects/{projectId}`) rather than re-rendering any project data inline.

## Workflow integration

`startWorkflowWithCrmContext` (`src/lib/crm/workflow-integration.ts`) is a thin wrapper around the Workflow Engine's own, completely unmodified `startWorkflowExecution` (Module 11) — never a second execution-start path, never a modification to `startWorkflowExecution` itself.

**Trusted IDs only, resolved up front.** Before starting anything, each provided `crmContactId`/`crmCompanyId`/`crmLeadId`/`crmOpportunityId` is resolved tenant-safely through the corresponding CRM service's own `resolve*ById` function — a cross-tenant or nonexistent id throws `TenantResourceNotFoundError` before any workflow execution is ever created, so a workflow can never be started with a dangling or spoofed CRM reference.

**Never a copy of the full record.** The resolved ids — not the records themselves — land in the execution's own bounded `input` JSON (Module 11's existing, unmodified field) under four reserved keys: `crmContactId`, `crmCompanyId`, `crmLeadId`, `crmOpportunityId`. This required **no new mapping-source kind** in the Workflow Engine at all — Module 11's existing `workflow_input` mapping source (`getByPath(ctx.workflowInput, path)`) already reads arbitrary keys out of the bounded input object, so a workflow node can reference `{ source: "workflow_input", path: "crmContactId" }` today, with zero changes to `src/lib/workflows/mapping.ts`.

**No CRM automation triggers exist.** Nothing in this module watches for a CRM state change (lead qualified, opportunity won, contact created) and starts a workflow automatically — every workflow-with-CRM-context start is an explicit, human- or agent-initiated call to `startWorkflowWithCrmContext`. Automated triggers, if they're ever built, are Workflow Engine's own future scope (already noted as deferred in Module 11's own docs), not something this module reaches into Workflows to add.

A `crm_workflow_execution_started` audit event is recorded (organization, actor, execution id, the CRM reference ids, the workflow definition id) whenever at least one CRM reference was actually provided — never for an ordinary CRM-context-free workflow start, since that path is unchanged Module 11 behavior this module has no reason to audit a second time.

### Reading workflow executions back from a CRM record

`listWorkflowExecutionsForCrmEntity` performs a plain, read-only JSONB lookup (`workflow_executions.input ->> 'crmOpportunityId' = $id`, scoped by `organizationId`) — no new index, no denormalized reverse-pointer table, since the reserved input keys are already exactly the data being queried. The opportunity detail page uses this to render a "Workflow executions" section linking back to the Workflow Engine's own execution detail pages (`/app/{organizationSlug}/workflow-executions/{executionId}`), read-only, following Module 11's own real state rather than caching or re-deriving it.

## What is deliberately not built here

- No automatic project creation from a won opportunity (spec's own explicit example of what *not* to automate this module).
- No automatic workflow trigger from any CRM state change.
- No new Workflow Engine node type for CRM (a `project_task` or `agent_execution` node, combined with `workflow_input` mapping against the reserved CRM keys, is already sufficient for a workflow to act on CRM context).
- No CRM-specific artifact or approval type — a workflow acting on CRM context still produces ordinary Runtime artifacts and approvals, exactly as Module 11 already defines them.

## Verified by tests

- A CRM↔project link is tenant-safe and rejects duplicates, including under a concurrent race.
- A project link never duplicates project data — the link is a pointer only.
- (Workflow-integration-specific scenarios are exercised as part of the Workflow Engine's own Module 11 test suite, which already covers `workflow_input` mapping resolution generically; this module adds no new mapping code path to test independently.)
