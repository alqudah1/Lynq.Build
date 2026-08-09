# Module 2 Step 4B — HTTP Route Layer: API Reference

Thin HTTP handlers wrapping Step 4A's domain services — no business logic lives here (see `platform/docs/MODULE_2_AUTH_AND_TENANCY_DESIGN.md` §6/§7 and `MODULE_2_STEP_3_OAUTH_SESSION_DESIGN.md`/Step 4A's own report for the underlying rules this layer enforces via the domain services it calls). **Not production-enabled** — same caveat as Step 4A: reaching any of this requires a real session, and live Google/Microsoft OAuth acceptance is still pending.

Documented here in OpenAPI-style convention (path, method, parameters, requestBody, responses per status code) rather than as a separate machine-readable spec file — every field below corresponds exactly to the Zod schemas in `src/lib/http/validation.ts` and the route handlers in `src/app/api/organizations/**`.

---

## Conventions that apply to every endpoint

- **Auth**: every endpoint requires a valid `__Host-lynq_session` cookie (Module 2 §5). There is no other way to authenticate — no header, no query parameter, no request body field.
- **Response envelope**: `{ "data": ... }` on success; `{ "error": { "code": string, "message": string, "requestId": string } }` on failure, with the same `requestId` also present in an `X-Request-Id` response header. No exceptions.
- **Never leaked**: stack traces, SQL text, driver error messages, or connection details. An unexpected error is logged server-side only and returns a generic `500 internal_error`.
- **Cross-tenant resources**: always `404 not_found`, identical whether the resource genuinely doesn't exist or the caller simply isn't a member of it — never `403` for this case, since that would confirm existence.
- **Content type**: request bodies are JSON (`Content-Type: application/json`); a missing or malformed body is treated as `{}` before validation, surfacing as a normal `400 invalid_request`, never a raw parse error.
- **Path parameters**: every `{organizationId}`, `{workspaceId}`, `{userId}` is validated as a UUID before any query runs; a non-UUID value is `400 invalid_request`.
- **Query parameters**: none of Step 4B's endpoints accept any (no pagination/filtering yet — the domain list functions don't support it; a future step can add cursor-based pagination per Module 2 §14 without changing this document's other conventions).
- **Common error codes** (see each endpoint for which apply): `unauthenticated` (401), `invalid_request` (400), `forbidden` (403), `not_found` (404), `self_role_change` / `admin_cannot_act_on_owner` / `last_owner` / `parent_membership_required` / `workspace_deletion_not_permitted` (409), `internal_error` (500).

---

## Organizations

### `GET /api/organizations`
List every organization the authenticated user belongs to.

- **operationId**: `listOrganizations`
- **Auth**: required
- **Parameters**: none

**200 response**
```json
{
  "data": [
    { "id": "3f9a...", "name": "Acme", "slug": "acme", "role": "owner", "deletedAt": null, "createdAt": "2026-08-01T00:00:00.000Z", "updatedAt": "2026-08-01T00:00:00.000Z" }
  ]
}
```

**Error example (401)**
```json
{ "error": { "code": "unauthenticated", "message": "Authentication required", "requestId": "1a2b3c..." } }
```

---

### `POST /api/organizations`
Creates a new organization with the caller as its first owner.

- **operationId**: `createOrganization`
- **Auth**: required (any authenticated user)
- **Request body**: `{ "name": string (1-200 chars), "slug": string (lowercase, hyphenated, 1-100 chars) }` — no extra fields allowed.

**Request example**
```json
{ "name": "Acme", "slug": "acme" }
```

**201 response**
```json
{
  "data": {
    "organization": { "id": "3f9a...", "name": "Acme", "slug": "acme", "deletedAt": null, "createdAt": "...", "updatedAt": "..." },
    "ownerMembership": { "organizationId": "3f9a...", "userId": "9c1d...", "role": "owner" }
  }
}
```

**Error example (400 — invalid slug)**
```json
{ "error": { "code": "invalid_request", "message": "Request validation failed: {\"slug\":[\"must be lowercase alphanumeric with single hyphens\"]}", "requestId": "..." } }
```

---

### `GET /api/organizations/{organizationId}`
Fetches one organization.

- **operationId**: `getOrganization`
- **Auth**: required
- **Parameters**: `organizationId` (path, UUID)

**200 response**
```json
{
  "data": {
    "organization": { "id": "3f9a...", "name": "Acme", "slug": "acme", "deletedAt": null, "createdAt": "...", "updatedAt": "..." },
    "membership": { "organizationId": "3f9a...", "userId": "9c1d...", "role": "member" }
  }
}
```

**Error example (404 — not a member, or doesn't exist, or soft-deleted; identical in every case)**
```json
{ "error": { "code": "not_found", "message": "Resource not found", "requestId": "..." } }
```

---

### `PATCH /api/organizations/{organizationId}`
Updates name and/or slug. Owners and admins only.

- **operationId**: `updateOrganization`
- **Auth**: required
- **Parameters**: `organizationId` (path, UUID)
- **Request body**: `{ "name"?: string, "slug"?: string }` — at least one field required, no extra fields allowed.

**Request example**
```json
{ "name": "Acme Corp" }
```

**200 response**
```json
{ "data": { "id": "3f9a...", "name": "Acme Corp", "slug": "acme", "deletedAt": null, "createdAt": "...", "updatedAt": "..." } }
```

**Error example (403 — member/viewer)**
```json
{ "error": { "code": "forbidden", "message": "Insufficient role: organization role \"member\" is not one of [owner, admin]", "requestId": "..." } }
```

**Error example (400 — empty body)**
```json
{ "error": { "code": "invalid_request", "message": "Request validation failed: {\"_errors\":[\"at least one of name or slug must be provided\"]}", "requestId": "..." } }
```

---

### `DELETE /api/organizations/{organizationId}`
Soft-deletes the organization and cascades to its workspaces. Owners only.

- **operationId**: `deleteOrganization`
- **Auth**: required
- **Parameters**: `organizationId` (path, UUID)

**204 response**: empty body.

**Error example (403 — admin, not owner)**
```json
{ "error": { "code": "forbidden", "message": "Insufficient role: organization role \"admin\" is not one of [owner]", "requestId": "..." } }
```

---

## Organization membership

### `GET /api/organizations/{organizationId}/members`
Lists every member. Any member (any role) may view this.

- **operationId**: `listOrganizationMembers`
- **Parameters**: `organizationId` (path, UUID)

**200 response**
```json
{ "data": [ { "userId": "9c1d...", "email": "alice@example.com", "role": "owner" } ] }
```

---

### `POST /api/organizations/{organizationId}/members`
Adds an existing user to the organization. Owners and admins only.

- **operationId**: `addOrganizationMember`
- **Parameters**: `organizationId` (path, UUID)
- **Request body**: `{ "userId": string (UUID), "role": "owner" | "admin" | "member" | "viewer" }`

**Request example**
```json
{ "userId": "7e2b...", "role": "member" }
```

**201 response**
```json
{ "data": { "organizationId": "3f9a...", "userId": "7e2b...", "role": "member" } }
```

**Error example (403 — member attempting to add)**
```json
{ "error": { "code": "forbidden", "message": "Insufficient role: organization role \"member\" is not one of [owner, admin]", "requestId": "..." } }
```

---

### `PATCH /api/organizations/{organizationId}/members/{userId}`
Changes an existing member's role.

- **operationId**: `changeOrganizationMemberRole`
- **Parameters**: `organizationId` (path, UUID), `userId` (path, UUID — the target member)
- **Request body**: `{ "role": "owner" | "admin" | "member" | "viewer" }`

**Request example**
```json
{ "role": "admin" }
```

**200 response**
```json
{ "data": { "organizationId": "3f9a...", "userId": "7e2b...", "role": "admin" } }
```

**Error example (409 — self-promotion attempt)**
```json
{ "error": { "code": "self_role_change", "message": "A user cannot change their own role", "requestId": "..." } }
```

**Error example (409 — admin acting on an owner)**
```json
{ "error": { "code": "admin_cannot_act_on_owner", "message": "An admin cannot remove or demote an owner", "requestId": "..." } }
```

**Error example (409 — demoting the final owner)**
```json
{ "error": { "code": "last_owner", "message": "Cannot remove or demote the organization's final owner", "requestId": "..." } }
```

---

### `DELETE /api/organizations/{organizationId}/members/{userId}`
Removes a member.

- **operationId**: `removeOrganizationMember`
- **Parameters**: `organizationId` (path, UUID), `userId` (path, UUID)

**204 response**: empty body.

**Error example (409 — last owner)**
```json
{ "error": { "code": "last_owner", "message": "Cannot remove or demote the organization's final owner", "requestId": "..." } }
```

---

## Workspaces (nested under their parent organization)

### `GET /api/organizations/{organizationId}/workspaces`
Lists workspaces in this organization the caller has an **explicit** workspace membership in — organization membership alone never adds an entry here.

- **operationId**: `listWorkspaces`
- **Parameters**: `organizationId` (path, UUID)

**200 response**
```json
{ "data": [ { "id": "5b1e...", "organizationId": "3f9a...", "name": "Marketing", "slug": "marketing", "role": "manager", "deletedAt": null, "createdAt": "...", "updatedAt": "..." } ] }
```

---

### `POST /api/organizations/{organizationId}/workspaces`
Creates a workspace. Organization owners/admins only; the creator becomes the workspace's first `manager`.

- **operationId**: `createWorkspace`
- **Parameters**: `organizationId` (path, UUID)
- **Request body**: `{ "name": string, "slug": string }`

**Request example**
```json
{ "name": "Marketing", "slug": "marketing" }
```

**201 response**
```json
{
  "data": {
    "workspace": { "id": "5b1e...", "organizationId": "3f9a...", "name": "Marketing", "slug": "marketing", "deletedAt": null, "createdAt": "...", "updatedAt": "..." },
    "creatorMembership": { "workspaceId": "5b1e...", "organizationId": "3f9a...", "userId": "9c1d...", "role": "manager" }
  }
}
```

**Error example (403 — org member, not owner/admin)**
```json
{ "error": { "code": "forbidden", "message": "Insufficient role: organization role \"member\" is not one of [owner, admin]", "requestId": "..." } }
```

---

### `GET /api/organizations/{organizationId}/workspaces/{workspaceId}`
Fetches one workspace — requires an **explicit** workspace membership (never satisfied by organization role alone, including owner/admin).

- **operationId**: `getWorkspace`
- **Parameters**: `organizationId` (path, UUID), `workspaceId` (path, UUID)

**200 response**
```json
{
  "data": {
    "workspace": { "id": "5b1e...", "organizationId": "3f9a...", "name": "Marketing", "slug": "marketing", "deletedAt": null, "createdAt": "...", "updatedAt": "..." },
    "membership": { "workspaceId": "5b1e...", "organizationId": "3f9a...", "userId": "9c1d...", "role": "manager" }
  }
}
```

**Error example (404 — organization member without explicit workspace membership; also returned if the URL's `organizationId` doesn't match the workspace's real parent)**
```json
{ "error": { "code": "not_found", "message": "Resource not found", "requestId": "..." } }
```

---

### `PATCH /api/organizations/{organizationId}/workspaces/{workspaceId}`
Updates name/slug. The workspace's manager, or an organization owner/admin via the admin-override.

- **operationId**: `updateWorkspace`
- **Parameters**: `organizationId` (path, UUID), `workspaceId` (path, UUID)
- **Request body**: `{ "name"?: string, "slug"?: string }` — at least one field required.

**200 response**
```json
{ "data": { "id": "5b1e...", "organizationId": "3f9a...", "name": "Growth", "slug": "marketing", "deletedAt": null, "createdAt": "...", "updatedAt": "..." } }
```

---

### `DELETE /api/organizations/{organizationId}/workspaces/{workspaceId}`
Soft-deletes the workspace. No workspace role — not even manager — may do this; only an organization owner/admin.

- **operationId**: `deleteWorkspace`
- **Parameters**: `organizationId` (path, UUID), `workspaceId` (path, UUID)

**204 response**: empty body.

**Error example (409 — the workspace's own manager attempting deletion)**
```json
{ "error": { "code": "workspace_deletion_not_permitted", "message": "Only an organization owner or admin may delete a workspace", "requestId": "..." } }
```

---

## Workspace membership

### `GET /api/organizations/{organizationId}/workspaces/{workspaceId}/members`
Lists the workspace's members. Any explicit workspace member (any role), or an organization owner/admin via the admin-override.

- **operationId**: `listWorkspaceMembers`
- **Parameters**: `organizationId`, `workspaceId` (path, UUID)

**200 response**
```json
{ "data": [ { "userId": "9c1d...", "email": "alice@example.com", "role": "manager" } ] }
```

---

### `POST /api/organizations/{organizationId}/workspaces/{workspaceId}/members`
Adds an organization member to the workspace. The workspace's manager, or an org owner/admin via override.

- **operationId**: `addWorkspaceMember`
- **Parameters**: `organizationId`, `workspaceId` (path, UUID)
- **Request body**: `{ "userId": string (UUID), "role": "manager" | "member" | "viewer" }`

**201 response**
```json
{ "data": { "workspaceId": "5b1e...", "organizationId": "3f9a...", "userId": "7e2b...", "role": "member" } }
```

**Error example (409 — target has no membership in the parent organization)**
```json
{ "error": { "code": "parent_membership_required", "message": "The target user has no membership in the workspace's parent organization", "requestId": "..." } }
```

---

### `PATCH /api/organizations/{organizationId}/workspaces/{workspaceId}/members/{userId}`
Changes a workspace member's role.

- **operationId**: `changeWorkspaceMemberRole`
- **Parameters**: `organizationId`, `workspaceId`, `userId` (path, UUID)
- **Request body**: `{ "role": "manager" | "member" | "viewer" }`

**200 response**
```json
{ "data": { "workspaceId": "5b1e...", "organizationId": "3f9a...", "userId": "7e2b...", "role": "viewer" } }
```

**Error example (409 — self-role-change)**
```json
{ "error": { "code": "self_role_change", "message": "A user cannot change their own role", "requestId": "..." } }
```

---

### `DELETE /api/organizations/{organizationId}/workspaces/{workspaceId}/members/{userId}`
Removes a workspace member.

- **operationId**: `removeWorkspaceMember`
- **Parameters**: `organizationId`, `workspaceId`, `userId` (path, UUID)

**204 response**: empty body.

---

## Explicitly out of scope for Step 4B

Invitation acceptance, email sending, application-wide middleware, dashboard/React UI, Brain, agents, workflows — none of these exist in this route layer, matching the explicit Step 4B scope boundary.
