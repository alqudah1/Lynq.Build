# Module 10 — Projects Authorization

Companion to `MODULE_10_PROJECTS_CORE.md`, detailing exactly who may do what to a project and why. All enforcement is server-side, in `src/lib/projects/authz.ts` and the individual service functions that call it — never a UI-only restriction. A hidden or disabled UI control is never the security boundary; every route re-derives authority from the database on every request.

## Roles

Two independent role systems feed a project-level authorization decision, resolved once per request by `resolveProjectAuthContext`:

1. **Organization role** (`owner | admin | member | viewer`, from Module 2) — an org `owner`/`admin` always has full authority over every project in the organization, regardless of project membership.
2. **Workspace role** (`manager | member | viewer`, from Module 4A) — relevant only when the project is workspace-scoped (`projects.workspaceId` is set); a workspace `manager` has management authority over projects inside that workspace.
3. **Project role** (`project_owner | project_manager | contributor | viewer`, new this module, stored in `project_members`) — scoped to exactly one project; a user may hold a different role on every project they belong to.

None of these three roles imply Brain access, Agent Runtime execution permissions, or any other subsystem's authorization — a project role answers exactly one question: "what may this human do to this project's own records."

## Authority floors (exact)

| Action | Required floor |
|---|---|
| Create a project (unscoped or in a workspace where you're not a manager) | org `owner`/`admin` |
| Create a project inside a workspace where you're a `manager` | workspace `manager` (no org role needed) |
| View a project | org `owner`/`admin`, **any** project member (including `viewer`), or any workspace member (workspace-scoped project) |
| Manage project settings, archive, manage members | org `owner`/`admin`, workspace `manager`, or this project's own `project_owner` |
| Manage phases, milestones, task assignments, dependencies | above, **or** this project's own `project_manager` |
| Create a task | content-authority floor, **or** this project's own `contributor` |
| Update a task | content-authority floor, **or** a `contributor` who is that specific task's own assignee |
| Add project-level activity (comments, etc. — none exist yet this module) | content-authority floor |
| Launch an agent execution from a task | content-authority floor (`project_manager` and above) — **not** `contributor` |
| View-only | `viewer` and above (read access, no mutation) |

The "workspace manager, or org owner/admin" clause is an *override*, not a separate ladder — it means those two roles never need an explicit `project_members` row to manage a project they'd otherwise have no project-specific role in, matching the equivalent override Module 4A already established for workspace management over organization admins.

## Contributor + assignee carve-out

A plain `contributor` cannot update an arbitrary task in the project — only one they are personally assigned to (`requireTaskUpdateAuthority` takes a live `isTaskAssignee` check, not a cached flag, so revoking an assignment immediately revokes the update right too). This is the one place project role alone is insufficient to answer an authorization question; task assignment state must be checked at the same time.

## What a role does *not* grant

- A project role never grants Brain read/write access, regardless of how high (a `project_owner` with no Brain grant still cannot read Brain knowledge through this module).
- A project role never grants Agent Runtime permissions directly — launching an execution creates a *request* that flows through the Runtime's own, unmodified authorization (Module 7); the project role only gates whether the *request* is allowed to be made.
- Assigning a human to a task transfers responsibility, never permission — an assignee's task-update right comes from the assignee check above, not from any elevated role.
- Linking an artifact or approval to a project never changes who may view or decide on the underlying Runtime record — `listApprovalLinks` always reads the Runtime's live status rather than caching a decision, so revoking Runtime-level visibility (if that ever existed) would immediately affect what a project viewer sees too, with no separate revocation needed here.

## Cross-tenant behavior

Every read/write path resolves the target project by `(id, organizationId)` together (`resolveProjectById`) before any role check runs. A project belonging to a different organization is `TenantResourceNotFoundError` (HTTP 404) — structurally indistinguishable from a project that never existed, never a 403 that would leak the project's existence to an unauthorized caller in a different tenant.

## Denial auditing

Every authorization failure inside `src/lib/projects/authz.ts` calls `denyAndAudit` before throwing `InsufficientRoleError` — a `project_permission_denied` audit event is recorded with the organization, the acting user, the target project, and a short `detail` string naming which floor was required (e.g. `"requires project owner, workspace manager, or organization owner/admin"`), never the full request payload.

## Verified by tests

- A viewer cannot transition or update the project (`projects.integration.test.ts`).
- A plain org member with no project/workspace role cannot view the project (`InsufficientRoleError`).
- A contributor may create tasks; a viewer may not.
- A contributor who is the assignee may update their task; a non-assigned contributor on the same task may not.
- A workspace manager may create a workspace-scoped project without any organization-level elevated role.
- Cross-tenant project access resolves to 404 at both the service layer and the route layer.
