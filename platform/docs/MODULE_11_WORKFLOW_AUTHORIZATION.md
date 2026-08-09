# Module 11 — Workflow Authorization

Companion to `MODULE_11_WORKFLOW_ENGINE_CORE.md`, detailing exactly who may do what to a workflow definition or execution and why. All enforcement is server-side, in `src/lib/workflows/authz.ts` and the service functions that call it — never a UI-only restriction. A hidden or disabled UI control is never the security boundary.

## Roles considered

Unlike Projects Core, there is **no per-workflow membership table** — a workflow definition has no equivalent of `project_members`. Authority resolves from three existing role systems, combined by `resolveWorkflowAuthContext`:

1. **Organization role** (`owner | admin | member | viewer`, Module 2) — an org `owner`/`admin` always has full authority over every workflow in the organization.
2. **Workspace role** (`manager | member | viewer`, Module 4A) — relevant only when the workflow definition is workspace-scoped (`workflowDefinitions.workspaceId` set); a workspace `manager` has full management authority over workflows inside that workspace.
3. **Project role** (`project_owner | project_manager | contributor | viewer`, Module 10's own `project_members`) — relevant only when starting or inspecting an **execution** that is linked to a specific project; a workflow definition itself is never project-scoped.

A workflow role never implies Brain access, Agent Runtime execution permissions, Tool Runtime permissions, or Projects Core authority over the linked project's own records — it answers exactly one question: "what may this actor do to this workflow definition or execution."

## Authority floors (exact)

| Action | Required floor |
|---|---|
| Create a workflow definition (org-wide) | org `owner`/`admin` |
| Create a workflow definition inside a workspace where you're a `manager` | workspace `manager` (no org role needed) |
| View a workflow definition | org `owner`/`admin`; any workspace member for a workspace-scoped definition; any organization member for an org-wide definition |
| Edit / publish a version / pause / archive a workflow definition | org `owner`/`admin`, or this workspace's own `manager` |
| Manage templates (seed, copy into a draft) | same floor as "create a workflow definition" |
| Start an execution of a published workflow (unscoped, or workspace-scoped) | org `owner`/`admin`, or workspace `manager` |
| Start an execution linked to a specific project | above, **or** that project's own `project_owner`/`project_manager` |
| Inspect a specific execution | the start-authority floor, plus any workspace member (workspace-scoped) or any member of the linked project (view-only) |
| Pause / resume / cancel / retry an execution | org `owner`/`admin`, workspace `manager`, the execution's own initiator, or `project_owner`/`project_manager` of the linked project |
| Respond to a workflow-linked human task or approval | the assigned user (human task), or whoever Module 7's own approval authorization already allows (approval — unmodified) |
| Agents | may execute assigned Runtime nodes; may never create, publish, or redesign a workflow, bypass an approval, or expand scope beyond the node they were assigned |
| Workers | may process only a job they hold a valid lease on (Module 9's own worker-credential model, unmodified) |

## Ordinary org members

An ordinary member with no workspace role and no project role may **view** an org-wide (non-workspace-scoped) workflow definition — matching the "everyone in scope may view" floor Module 10 established — but may not create, edit, publish, or start one, and may act only where explicitly assigned (a human task, or an approval they're authorized to decide).

## What a workflow role does *not* grant

- Starting a workflow execution never grants Brain access, Agent Runtime permissions, or Tool Runtime permissions directly — every node the execution reaches re-derives its own authorization from the relevant subsystem (Module 7/8's own, unmodified) at the moment it runs, never cached from the start-authorization check.
- A project's `project_owner`/`project_manager` may start a workflow linked to their project without needing any workspace or org-level elevated role — but this only authorizes *starting that one execution*, never editing or publishing the workflow *definition* itself.
- Completing a workflow-linked human task or deciding a workflow-linked approval never changes who may manage the owning workflow definition or execution — these are checked independently.
- A workflow execution reaching a `project_task` node never grants it, or the workflow's initiator, any elevated authority over the linked project — Projects Core's own authorization (Module 10, unmodified) still governs every project-side action.

## Cross-tenant behavior

Every read/write path resolves the target workflow definition or execution by `(id, organizationId)` together before any role check runs. A workflow or execution belonging to a different organization is `TenantResourceNotFoundError` (HTTP 404) — structurally indistinguishable from one that never existed, never a 403 that would leak its existence across tenants.

## Denial auditing

Every authorization failure in `src/lib/workflows/authz.ts` calls `denyAndAudit` before throwing `InsufficientRoleError` — a `workflow_permission_denied` audit event is recorded with the organization, the acting user, the target (definition or execution) type and id, and a short `detail` string naming which floor was required, never the full request payload.

## Verified by tests

- An org member with no workspace/project role cannot create or publish a workflow.
- A workspace manager may create and publish a workspace-scoped workflow with no organization-level elevated role.
- A project owner/manager may start an execution linked to their own project; a plain contributor on that same project may not.
- Cross-tenant workflow and execution access resolves to 404 at both the service layer and the route layer.
- A permission revocation between node executions (e.g. a Brain grant revoked mid-workflow) stops the next gated node rather than silently continuing on stale authority.
