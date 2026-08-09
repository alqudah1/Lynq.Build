# Module 2 Step 5B — Organization and Workspace Administration UI

Builds authenticated administration screens on top of Step 4A's domain services and Step 4B's HTTP APIs — organization settings, organization member management, workspace settings, workspace member management, create-organization and create-workspace flows, and role-change/removal/deletion confirmation flows. Extends Step 5A's dashboard shell; introduces no new authentication mechanism and no application-wide middleware. **Not production-enabled** — Step 3's live Google/Microsoft OAuth acceptance remains pending, unchanged by this step. Invitations UI, Brain, Agent Registry, Workflow Engine, Marketing, Sales, billing, and analytics were **not** started.

---

## Route structure

```
/app/new                                                → create-organization form
/app/{organizationSlug}/settings                        → organization settings + deletion
/app/{organizationSlug}/members                         → organization member management
/app/{organizationSlug}/workspaces/new                  → create-workspace form
/app/{organizationSlug}/{workspaceSlug}/settings         → workspace settings + deletion
/app/{organizationSlug}/{workspaceSlug}/members          → workspace member management
```

Every page resolves the authenticated user and authorization **server-side**, independently, via `requireDashboardUser` followed by the same slug-resolution functions Step 5A already established (`getOrganizationBySlugForUser`) plus one new one (`getWorkspaceForAdministration`, below). No page trusts `organizationSlug`/`workspaceSlug` from the URL as anything more than a lookup key — every one is re-resolved against the current user's real membership on every request.

### Reserved-slug protection (a route-shadowing bug this step had to close)

Next.js always resolves a static route segment (`settings`, `members`, `workspaces`, `new`) over a same-level dynamic one (`[organizationSlug]`/`[workspaceSlug]`). Without a guard, an organization or workspace whose slug happened to match one of these words would become permanently unreachable at its own URL. `RESERVED_ORGANIZATION_SLUGS = {"new"}` and `RESERVED_WORKSPACE_SLUGS = {"settings", "members", "workspaces"}` (`src/lib/dashboard/actions/reserved-slugs.ts`) are enforced via a Zod `.refine()` on both the create and update schemas — a reserved slug is rejected as a normal `invalid_request` validation error, never a silent shadow.

---

## Server actions — the mutation layer

All mutations are Next.js Server Actions (`src/lib/dashboard/actions/{organizations,workspaces}.ts`), never a duplicated API route. Each one:

1. Calls `requireDashboardUser` itself (independent re-authentication, matching Step 5A's "never chain trust" discipline).
2. Re-resolves the organization/workspace **by slug**, server-side — never trusts a client-supplied ID for authorization.
3. Validates input with Zod, reusing the **existing, shared** schemas from `src/lib/http/validation.ts` (`nameSchema`, `slugSchema`, `organizationRoleSchema`, `workspaceRoleSchema`) rather than duplicating validation logic.
4. Delegates every authorization and business rule to the **unmodified** Step 4A domain functions (`createOrganization`, `updateOrganization`, `softDeleteOrganization`, `changeOrganizationRole`, `removeOrganizationMember`, `createWorkspace`, `updateWorkspace`, `softDeleteWorkspace`, `addWorkspaceMember`, `changeWorkspaceRole`, `removeWorkspaceMember`). **No business rule is re-implemented or weakened in a server action or a React component anywhere in this step.**
5. Translates any thrown error into a typed `ActionResult` (`toActionResult`, `src/lib/dashboard/actions/errors.ts`) — the exact `{code, message}` shape Step 4B's HTTP layer already uses. Never a stack trace, never raw SQL/driver text; anything unrecognized collapses to a single generic `internal_error` message, logged server-side only.

### Two small, justified domain-layer additions

- **`SlugAlreadyTakenError`** (`src/lib/authz/errors.ts`) + an `isPostgresUniqueViolation` helper, added to `createOrganization`/`updateOrganization` (`organizations.ts`) and `createWorkspace`/`updateWorkspace` (`workspaces.ts`). Before this step, a duplicate slug leaked a raw Postgres unique-violation error past the domain boundary — a real gap the "duplicate slug shows a safe error" requirement exposed. Now caught and rethrown as a clean, expected `slug_taken` domain error, exactly like every other rule in this codebase's `DomainRuleViolationError` family.
- **`getWorkspaceForAdministration(db, organizationId, slug, userId)`** (`src/lib/workspaces/workspaces.ts`) — resolves a workspace by slug, then authorizes via `requireWorkspaceManagementAccess` (already existing from Step 4A: explicit workspace `manager` membership, falling back to the organization admin-override). Returns `{ workspace, via: "workspace-manager" | "org-admin-override" }`. This is deliberately a **second, distinct** resolver from Step 5A's `getWorkspaceBySlugForUser` — see "Two workspace-access tiers" below.

---

## Workspace-creation membership policy — reviewed, not reinvented

The step's instructions explicitly required reviewing the existing behavior rather than inventing a new policy. `createWorkspace` (Step 4A, unmodified) already atomically creates the workspace and grants its creator an explicit `manager` workspace membership in the same transaction — its own existing comment already documents why: "without this, a brand-new workspace would have zero members and be unreachable, even to the org admin who just created it." **No other organization member — including other admins or the owner — gains workspace content access merely because a workspace was created.** This step adds no new logic here; `createWorkspaceAction` calls the domain function as-is. Verified directly in `workspaces.integration.test.ts`: after creation, exactly one `workspace_memberships` row exists (the creator, `manager`), even when other organization members exist.

---

## Two workspace-access tiers (content vs. administration)

Step 5A established `getWorkspaceBySlugForUser` for **workspace content** — strict, explicit-membership-only, no admin override; an organization owner/admin with no workspace membership of their own gets the same 404 as a stranger. This step adds a second, narrower-purpose resolver for **workspace administration only**:

| Resolver | Purpose | Org admin override? |
|---|---|---|
| `getWorkspaceBySlugForUser` (Step 5A) | View workspace content | No |
| `getWorkspaceForAdministration` (Step 5B) | Open settings/members pages | Yes (`requireWorkspaceManagementAccess`) |

An organization owner/admin can reach `/app/{org}/{workspace}/settings` and `/members` without ever holding an explicit workspace membership — but this **never** creates a `workspace_memberships` row for them and grants **no** access to workspace content. Verified directly: `updateWorkspaceAction` under the override succeeds while a query for a `workspace_memberships` row for that admin still returns zero rows (`workspaces.integration.test.ts`).

A plain organization member (not a manager, not an owner/admin) who opens a workspace administration page they cannot manage receives `InsufficientRoleError` (403) — the settings/members pages catch this specifically and render "You don't have permission to administer this workspace," never a false 404 (they are a genuine organization member, not a cross-tenant stranger; a 404 would be misleading).

---

## Role management and deletion — UI decides what to SHOW, domain decides what's ALLOWED

Every row-level mutation (role change, removal) and every deletion goes through `ConfirmDialog` (`src/components/dashboard/ConfirmDialog.tsx`) — clicking the trigger only opens the dialog; the mutation runs only when the dialog's own Confirm button is submitted. On failure the dialog stays open and shows the error inline; on success it closes automatically.

Rows (`OrganizationMemberRow.tsx`, `WorkspaceMemberRow.tsx`) hide controls based on role (e.g., a plain member sees no role selector or remove button; a user's own row shows "This is you" instead of self-management controls) — but this is presentation only. **Every actual rule is enforced by the unchanged Step 4A domain functions, independent of what the UI renders**: an admin cannot remove or demote an owner, the final owner cannot be removed or demoted away, a user cannot change their own role, and members/viewers cannot manage membership at all — regardless of what a manipulated client might submit. Confirmed directly in `organizations.integration.test.ts`/`workspaces.integration.test.ts` by calling the server actions with deliberately-unauthorized actor/target combinations and asserting the same domain errors fire (`admin_cannot_act_on_owner`, `last_owner`, `self_role_change`, `forbidden`, `parent_membership_required`).

Deletion is soft (`deletedAt`), owner-only for organizations, and org-owner/admin-only for workspaces — a workspace manager can update but never delete their own workspace (`workspace_deletion_not_permitted`). No billing settings exist anywhere in the organization settings UI (out of scope, matching the domain layer's own boundaries).

---

## Data boundaries — no internal ID ever reaches the client unnecessarily

This step's own first draft got this wrong in one place, caught during manual verification and fixed before completion — documented here because the failure mode is worth remembering:

- **The bug**: `OrganizationMemberRow`/`WorkspaceMemberRow` originally received a raw `userId` prop and called `.bind(null, organizationSlug, userId)` on the server action themselves, client-side. Inspecting the actual rendered page confirmed every member's raw UUID was serialized into the page's HTML/RSC payload as a result — not shown as visible text, but present in the page source. Separately, the organization layout was passing its **entire** `DashboardUser` object (`{userId, email, name}`) to `Sidebar`/`MobileNav`, which only need `{name, email}` — TypeScript's structural typing doesn't strip the extra `userId` field off a passed variable the way it would an inline object literal, so the current user's own ID was also being serialized unnecessarily.
- **The fix**: `changeRoleAction`/`removeAction` are now bound **server-side**, inside the page component, and only the already-bound function is passed as a prop — the row components no longer accept or hold a raw ID prop at all. The layout now passes an explicit `{ name: user.name, email: user.email }` object to Sidebar/MobileNav instead of the full user record. The "add workspace member" flow was changed to identify candidates by **email** (already-visible text) rather than user ID — `addWorkspaceMemberAction` resolves the email to a user ID server-side, the same case-insensitive lookup OAuth account-linking already uses, and treats a non-matching email identically to "not a parent-org member" (never distinguishing the two).
- **What this fix does and doesn't guarantee**: Next.js does not encrypt `.bind()` arguments — they are the action's own parameters, not a closure, so a per-row action reference still carries that row's target ID once rendered, whether bound on the client or the server; there is no plaintext-vs-encrypted difference between the two. Binding server-side instead removes the ID as something a component *prop* exposes or a future caller could misuse, and eliminates every case where the ID was being serialized **without a corresponding, load-bearing use** (the current user's own ID on every page load; every add-member candidate's ID before the admin had even chosen one). The actual security guarantee was never "the ID is secret" — it is that `changeOrganizationRole`/`removeOrganizationMember`/`changeWorkspaceRole`/`removeWorkspaceMember` independently re-verify the caller's authorization against that ID every single time, regardless of where it came from.

No organization/workspace page renders a raw ID as visible text anywhere — only name, email, role, and slug.

---

## Accessibility

- Every form input has a `<label>`; validation errors are field-associated via `aria-describedby`/`aria-invalid` (`FormField.tsx`) and rendered in a `role="alert"` live region; a successful save announces via `role="status"` (`StatusMessage.tsx`).
- Role `<select>` elements carry a per-row `aria-label` (e.g. "Role for Jane Doe") so screen-reader users can distinguish rows without relying on table structure alone (`SelectField.tsx`).
- `ConfirmDialog` reuses Step 5A's proven modal pattern: `role="dialog" aria-modal="true"`, labelled and described by its own title/description, focus moves to the Cancel button on open and returns to the trigger on close (Escape, Cancel, or a successful submit).
- Every interactive target is at least 44×44px (`min-h-11`), matching Step 5A's standard.
- Reduced-motion and visible-focus rules are inherited globally from Step 5A's `globals.css` — no per-component overrides needed.
- **Automated checks**: `jest-axe` runs against every new interactive component — `ConfirmDialog` (closed, open, error, and confirm-triggered states), `CreateOrganizationForm`, `OrganizationSettingsForm` (default, field-error, and success states), `OrganizationMemberRow` (all four visibility states, plus the role-change confirmation flow), and `AddWorkspaceMemberForm` (candidate list and empty state) — `npm run test:a11y`. `eslint-config-next`'s bundled `jsx-a11y` rules additionally run on every `npm run lint`.

---

## Design

Uses the existing LYNQ platform tokens exactly as extended in Step 5A (`globals.css`) — no new colors, no new type scale, sharp corners, no gradients or box-shadows. No new design-system decisions were needed for this step.

---

## Tests

- **Unit/integration** (`npm run test:integration`, real Neon database): `src/lib/dashboard/actions/organizations.integration.test.ts` (24 tests) and `src/lib/dashboard/actions/workspaces.integration.test.ts` (22 tests) — cover: unauthenticated redirect for every action; owner/admin/member/viewer authorization boundaries for org settings and deletion; final-owner and admin-cannot-act-on-owner protections enforced through the actions, not just the domain layer; self-role-change rejection; duplicate-slug and reserved-slug handling; workspace creation's membership policy (creator-only); the admin-override for workspace administration without workspace content access; workspace-manager-cannot-delete; parent-org-membership enforcement on add-member, including the "no such email" and "email exists but isn't an org member" cases resolving to the identical safe error; and a data-serialization-boundary assertion that no `ActionResult` ever contains a stack trace, SQL text, or the session cookie.
- **Accessibility** (`npm run test:a11y`, jsdom + `jest-axe`): 18 new tests across 5 new component test files (`ConfirmDialog`, `CreateOrganizationForm`, `OrganizationSettingsForm`, `OrganizationMemberRow`, `AddWorkspaceMemberForm`), plus the existing Step 5A suite — 36 total, all passing.
- **Domain-layer regression**: two pre-existing Step 4B integration tests (`.../members/route.integration.test.ts` for both organizations and workspaces) were updated for the new `name` field added to `listOrganizationMembers`/`listWorkspaceMembers` (a small, additive `SELECT` column so the admin UI can display a member's name, not just their email) — no behavior or authorization change.
- **Verification commands run clean**: `npm run typecheck`, `npm run lint`, `npm run build` (all new routes compile as dynamic, server-rendered pages), `npm run test:a11y` (36/36), and the two new integration files (46/46). The seeded verification database rows used for manual dev-server checks were removed afterward; no test leaves residual rows on failure (every `afterEach` cleans up its own created users/organizations, cascading to memberships/workspaces/sessions).

---

## Manual verification

A real session (via `createSession`, the same primitive a real OAuth login populates — never a bypass) was seeded for an owner, an admin, and a plain member of a test organization with one workspace, and every new route was requested against a real dev server: unauthenticated → redirect; owner/admin → 200 on every admin route including the workspace admin-override; a plain org member → a clear permission message (not a fake 404) on workspace administration; role selectors and remove/delete controls present only for `canManage` rows; no raw ID rendered as visible text. This is what surfaced the data-boundary bug described above, before it shipped.

---

## Known limitations

- **Live Google/Microsoft OAuth acceptance remains pending** (Step 3, unchanged by this step) — every test and manual check in this step uses database-backed sessions created directly via `createSession`, the same primitive a real login would populate; `requireDashboardUser` is the exact, unmodified validation path either way.
- **No invitations UI was built** — out of scope per this step's explicit instructions; adding a member currently requires them to already hold an organization membership (via the existing invitation API, unchanged).
- **No real email provider is configured anywhere in this step** — nothing in Step 5B sends transactional email.
- Module 2 as a whole remains **not production-enabled**.
