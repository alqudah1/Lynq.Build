# Module 2 Step 5C — Invitation Management UI and Safe Email Preview

Builds organization invitation management on top of Step 4C's domain services and Step 4C.1's hardened continuation-cookie flow, plus the clean `/invite` acceptance landing that Step 4C.1's own exchange route deliberately deferred ("real UI for this destination... is intentionally deferred to the dashboard — out of scope for this pass"). No real email delivery is configured anywhere in this step. Extends Step 5B's admin UI; introduces no new authentication mechanism and no application-wide middleware. **Not production-enabled** — Step 3's live Google/Microsoft OAuth acceptance remains pending, unchanged by this step.

---

## Route structure

```
/app/{organizationSlug}/invitations           → invitation management: create/refresh form + pending/expired/accepted/revoked list
/app/{organizationSlug}/invitations/preview   → owner/admin-only, environment-gated email preview
/invite                                        → clean, token-free acceptance landing (was a plain-text route.ts; now a real page)
```

`/invite/{rawToken}` (Step 4C.1) is unchanged and remains the **only** route that ever handles a raw invitation token — this step adds no second path that accepts one. `"invitations"` was added to the dashboard's existing reserved-workspace-slug set (`src/lib/dashboard/actions/reserved-slugs.ts`) for the same reason `"settings"`/`"members"`/`"workspaces"` already were: it is a new static sibling of `/app/{org}/{workspaceSlug}`, and Next.js always resolves a static segment over a same-level dynamic one.

---

## Authorization

- **Invitation management page**: owner/admin only. Unlike organization settings (which has a read-only fallback for members), `listOrganizationInvitations` itself requires owner/admin just to view the list — there is no partial view to fall back to, so a member/viewer sees a plain permission message and no invitation content at all.
- **Email preview page**: owner/admin only (checked directly against the resolved membership role — there is no persisted resource to gate here, so no separate domain function was needed), AND gated by `isEmailPreviewEnabled()` (see below). Both gates apply independently; failing either shows a distinct, still-generic message.
- **Server actions** (`src/lib/dashboard/actions/invitations.ts`): `createOrRefreshInvitationAction` and `revokeInvitationAction` each independently call `requireDashboardUser`, re-resolve the organization by slug, and delegate every rule to the **unmodified** Step 4C domain functions (`createOrRefreshInvitation`, `revokeInvitation`) — owner/admin-only, "an admin cannot invite an owner," "revoking requires the invitation to currently be pending," and the workspace-must-belong-to-this-organization tenant check are all enforced there, never re-implemented or weakened in an action or component.
- `createOrRefreshInvitationAction` also applies the same rate limit the existing HTTP route already does (`invitationCreateRateLimitKey(organizationId, actorUserId)`, 20/hour) — the dashboard's own creation path was not left unrestricted just because it's a different transport than the API route.

---

## Create/refresh invitation form

Fields: email (Zod `emailSchema`, reused — not duplicated), organization role, optional workspace, optional workspace role (paired — one requires the other, matching the existing HTTP route's own schema `.refine()`). `availableRoles` is computed **server-side** by the page from the actor's own membership role: an admin's role list never includes "owner." This is presentation only — `createOrRefreshInvitation` itself still independently rejects an admin attempting to invite an owner regardless of what the form happens to offer, proven directly in `invitations.integration.test.ts`.

The workspace list (`listWorkspacesForOrganization`, a new small domain-layer addition in `src/lib/workspaces/workspaces.ts`) is scoped strictly to the current organization and owner/admin-gated itself — deliberately **not** filtered to the actor's own explicit workspace memberships (unlike `listWorkspacesForUser`), since an org owner/admin may invite someone directly into any workspace of their organization; `createOrRefreshInvitation` itself only checks that the target workspace belongs to this organization, never that the inviting actor personally belongs to it. A workspace ID from a *different* organization is rejected as `not_found` — proven directly by constructing a foreign workspace in a second organization and submitting its ID.

A duplicate active invitation to the same email is **refreshed in place** (`createOrRefreshInvitation`'s existing atomic UPSERT, unmodified) rather than creating a second row — the action surfaces which happened (`{ok: true, refreshed: boolean}`) so the form can show "Invitation sent" vs. "Invitation refreshed and re-sent," proven directly by creating the same email twice and asserting exactly one row exists afterward. The raw token is **never** part of the action's return value or any rendered success state — only `refreshed: boolean`.

Because no real transport is configured (`RESEND_API_KEY` unset in this environment), `notifyInvitationCreated`'s call inside the action is a genuine no-op — the same pre-existing "best-effort, `null` transport means skip sending" behavior from Step 4C, unmodified.

---

## Pending invitation list and row actions

Every invitation for the organization is listed (pending, expired, accepted, revoked — `listOrganizationInvitations`, extended with two additive, non-behavioral `SELECT`-time joins: `workspaceName` and `invitedByName`, the latter `null` whenever the inviter's own user row is unavailable). Shown per row: invited email, organization role, optional workspace name + role, status (as visible text, not color alone), expiration date, and invited-by display name when available. **Never shown**: `token_hash`, a raw token, the invitation's own internal ID, audit metadata, or any other internal authorization detail.

Row actions are presentation-only gating on `status`:

- **pending** → Resend and Revoke
- **expired** → Resend only
- **accepted** / **revoked** → no actions at all

"Resend" needs no invitation ID whatsoever — it resubmits the row's own already-displayed email/role/workspace values through the identical `createOrRefreshInvitationAction`, via `ConfirmDialog`'s `hiddenFields`. "Revoke" is the one place this step genuinely needs the invitation's internal ID (there is no other stable identifier across an email's full history once multiple revoked/expired rows can exist) — the page binds `revokeInvitationAction` to that specific ID **server-side**, before the bound function is ever handed to the client `InvitationRow`; the row component itself never receives or holds a raw ID prop. Rows are keyed by `${email}-${status}-${createdAt}`, not by ID, for the same reason.

As established in Step 5B: a `.bind()`'d server action's arguments are not encrypted — they are the action's own parameters, serialized like any other argument, whether bound on the client or the server. The guarantee here is not that the ID is secret; it is that `revokeInvitation` independently re-verifies the caller's authorization and the invitation's current status against it every time, and that a member/viewer or a foreign organization's actor cannot use it to bypass anything — both proven directly in `invitations.integration.test.ts` (a member/viewer's revoke attempt is rejected `forbidden`; a foreign invitation ID is rejected `not_found`; an already-accepted invitation cannot be revoked, `already_used`; revoking twice fails safely the second time).

Both Resend and Revoke require an explicit `ConfirmDialog` confirmation — the trigger only opens the dialog, the mutation only runs on the dialog's own Confirm submit, matching Step 5B's established pattern exactly.

---

## Safe email preview

`/app/{org}/invitations/preview` renders a realistic sample invitation email — the current organization's real name, the current actor's own name as the sample inviter, a fixed sample invitee address, and (via a plain `method="get"` form with no client JS and no server action at all) an organization-role and optional-workspace picker so the owner/admin can see how the wording changes across combinations.

**No real invitation, raw token, or accept URL is ever generated anywhere in this surface.** `renderInvitationEmailPreview` (`src/lib/email/preview.ts`) calls the exact same `renderInvitationEmail` function real delivery will eventually use — satisfying "must use the same rendering function as future real email delivery" — but supplies a fixed, non-functional placeholder string in place of `acceptUrl` from the very first call; there is no real link ever created that then needs scrubbing. The template's `<a href="...">Accept invitation</a>` markup is replaced (by tag content, via regex, not by matching the placeholder string itself — robust to the real template gaining further anchor attributes later) with plain, visibly non-clickable text: `[Secure invitation link inserted at send time]`. Verified directly (`preview.test.ts`): the rendered output never contains any `http(s)://` URL and never contains an `<a` tag at all.

The preview is gated by `isEmailPreviewEnabled()`: unconditionally enabled outside `NODE_ENV=production`; in production, disabled unless `ENABLE_EMAIL_PREVIEW` is the **exact** string `"true"` — never inferred from any other configuration, never satisfied by a merely-truthy value. Verified directly for `"1"` and `"TRUE"` both still resolving to disabled in production.

The email template itself (`src/lib/email/render.ts`) was restyled in this step to the LYNQ platform's warm, editorial palette (warm stone/off-white background, charcoal text, a single restrained amber call-to-action, no gradients, sharp corners) using inline CSS and a table-based layout — the only structure reliably rendered across email clients; this is what the preview surface exists to let an owner actually verify before Resend is configured.

---

## Acceptance landing (`/invite`)

Replaces the prior plain-text `route.ts` (Step 4C.1's own deferred placeholder) with a real page. Reads invitation state **only** through the signed continuation cookie and the already-safe `InvitationPreview` shape (`organizationName`, `workspaceName`, `email`, `role`, `workspaceRole`, `expiresAt`) — never a token, a hash, or any internal ID, anywhere on this page, in either direction. Five states, in priority order:

1. `?invitation=accepted|failed` (the OAuth callback just attempted acceptance) — shows the matching generic outcome. A `failed` outcome offers a "Try again" retry **only** if the continuation cookie is still present (a transient failure preserves it; a terminal one clears it), and retry goes through the exact same `InvitationAcceptButton` / `POST /api/invitations/current/accept` call as first-time acceptance — never a different code path.
2. `?status=unavailable` (the raw-token exchange itself rejected the token, before any cookie was ever set).
3. No continuation cookie present (missing, tampered, or its own 10-minute window expired) — nothing to show.
4. A cookie is present, but `getInvitationPreviewByHash` finds its invitation dead (expired/revoked/already accepted).
5. A cookie is present and the invitation is genuinely live — shows the safe preview plus either a sign-in prompt (mirroring `/sign-in-required`'s own Google/Microsoft buttons, `redirectTo=/invite`) or an Accept control, matching the two paths `POST /api/invitations/current/accept` already distinguishes internally (checked via the same `getSessionCookie` + `requireAuthenticatedUser`-and-catch pattern that route already uses — never a redirect away from this page for being unauthenticated, since `/invite` must work for a brand-new visitor with no session at all).

States 2–4 all render the **identical** "Invitation is no longer available" wording — never distinguishing dead-token-at-exchange from dead-token-at-preview. No internal reason (expired, revoked, email mismatch, tenant mismatch, already used) is ever exposed on this page; every one of those is collapsed to one of exactly three public strings: "Invitation accepted.", "This invitation could not be completed.", or "Invitation is no longer available." Specific reasons remain audit-only, exactly as before this step (unchanged in `invitations.ts`/`acceptance.ts`).

`InvitationAcceptButton` (`src/components/invite/InvitationAcceptButton.tsx`) is the one interactive control on this otherwise fully server-rendered page — it posts to the existing, unmodified `POST /api/invitations/current/accept` and renders one of exactly three states (pending, generic error, generic success-with-dashboard-link), never branching on the response's specific error code.

---

## New-user continuation

The OAuth callback's existing invitation-continuation logic (`src/app/api/auth/[provider]/callback/route.ts`) was **not touched** by this step — it still folds `invitationTokenHash` into the pre-auth cookie at login-initiation, still calls `acceptInvitationByHash` itself after a successful login, and still redirects with the same generic `?invitation=accepted|failed`. This step's only relationship to that flow is that `/invite` is now a real page capable of receiving and displaying that same query parameter, and that its sign-in links point `redirectTo` back at `/invite` so the round trip lands somewhere real instead of the old plain-text stub. As with every other invitation surface in this project, this was tested via the provider-independent callback infrastructure and database-backed sessions (`createSession`), never a fake login page or a temporary session bypass — and, per the standing project discipline, the full new-user flow is **not** claimed as production-verified; that remains blocked on Step 3's live OAuth acceptance.

---

## Data boundaries — what is (and isn't) serialized to client components

- **Never serialized anywhere in this step**: raw invitation tokens, token hashes, session tokens, provider account IDs, audit metadata. Verified directly: the create/revoke actions' `ActionResult` never matches `/token|hash/i` (`invitations.integration.test.ts`); the email preview never contains a URL or anchor tag (`preview.test.ts`); manual verification against a real dev server confirmed no raw token appears anywhere in the invitations list page's HTML/RSC payload, the preview page, or the `/invite` landing in any of its five states.
- **Invitation rows never hold a raw ID prop**: `revokeInvitationAction` is bound to its target ID server-side, in the page, before ever reaching the client `InvitationRow` — the row component's own prop type has no ID field for the invitation itself.
- **Workspace IDs are not treated as sensitive** the way user IDs were in Step 5B — a workspace UUID carries no personal information, and the create-invitation form submits one directly (needed for `createOrRefreshInvitation`'s real input shape) rather than resolving through a secondary identifier; this is a deliberate, documented difference from Step 5B's `AddWorkspaceMemberForm`, not an oversight.
- Server components resolve session, organization, invitation list, authorization, and the `/invite` page's entire acceptance-state determination; client components are limited to the create form, the row-level confirm dialogs, and the one accept button.

---

## Accessibility

- Every form input has a `<label>`; the create-invitation form's fields and the email-preview page's role/workspace pickers all follow the same pattern already established in Step 5B (`FormField`, `SelectField`).
- Invitation status is rendered as visible text ("Pending", "Expired", "Accepted", "Revoked"), never color alone.
- `ConfirmDialog` (unchanged from Step 5B) provides the keyboard-operable, focus-trapped, focus-restoring modal for both Resend and Revoke.
- `InvitationAcceptButton`'s error state uses `role="alert"` (`StatusMessage`, reused from Step 5B); its success state uses `role="status"`.
- All interactive targets are at least 44×44px, matching the existing standard; reduced-motion and visible-focus rules are inherited globally, unchanged.
- **Automated checks**: `jest-axe` runs against `CreateInvitationForm` (default, role-restricted, and workspace-conditional states), `InvitationRow` (all four status states plus both confirmation flows), and `InvitationAcceptButton` (pending, error, and success states) — `npm run test:a11y`, 52 tests total across 12 files, all passing.

---

## Design

Uses the existing LYNQ platform tokens exactly as established in Step 5A/5B (`globals.css`) for every dashboard page in this step — no new dashboard design-system decisions. The invitation **email template** (`render.ts`) is a separate design surface with its own constraints (inline CSS only, table-based layout, no custom web fonts) and was restyled to the same warm, editorial visual direction the design brief describes: warm stone/off-white background, charcoal text, a single restrained amber accent, no gradients, sharp corners.

---

## Tests

- **Unit** (`npm test`): `src/lib/email/preview.test.ts` (9 tests) — no usable URL or anchor tag in the preview output, placeholder text present, real organization/inviter/role content present, and the production email-preview flag's exact behavior.
- **Integration** (`npm run test:integration`, real Neon database): `src/lib/dashboard/actions/invitations.integration.test.ts` (20 tests) — covers: unauthenticated redirect for both actions; owner/admin can create; member/viewer cannot create (`forbidden`); admin cannot invite an owner (`unauthorized_role`), owner can; a duplicate email refreshes the same row (exactly one row afterward); a workspace from a different organization never submits successfully (`not_found`); a genuinely-owned workspace succeeds; invalid email is rejected; the action result never contains "token"/"hash"; owner/admin can revoke a pending invitation; member/viewer cannot (`forbidden`); an already-accepted invitation cannot be revoked (`already_used`) and its status is unchanged; revoking twice fails safely the second time; a foreign organization's invitation ID is rejected (`not_found`).
- **Accessibility** (`npm run test:a11y`): see above.
- **Regression**: the full existing suite (166 unit, 256 integration, 52 a11y prior to this step's own additions) was re-run after every domain-layer change (the `InvitationListItem`/`workspaceName`/`invitedByName` join, `listWorkspacesForOrganization`) and passed unmodified — no existing test needed updating.
- **Manual verification**: a real invitation, its raw token, and four real sessions (owner, admin, member, invitee) were seeded via `createOrRefreshInvitation`/`createSession` directly against a real dev server. Confirmed: unauthenticated → redirect on the management page, generic "no longer available" on `/invite`; owner/admin → 200 with the create form and full list, member → permission message; the create form's role options correctly exclude "Owner" for an admin; the real raw-token exchange (`/invite/{rawToken}`) → clean redirect → sign-in state (unauthenticated) → accept state (authenticated as the invitee) → a real `POST accept` succeeded end-to-end → the invitation's status flipped to "Accepted" in the owner's list view with "No actions" shown and the raw token absent throughout. All seeded rows were removed afterward and confirmed clean.

---

## Known limitations

- **Live Google/Microsoft OAuth acceptance remains pending** (Step 3, unchanged) — every test and manual check uses database-backed sessions created directly via `createSession`; the OAuth callback's own invitation-continuation logic was not modified and is exercised only through the existing provider-independent callback test infrastructure, never a real provider round trip.
- **No real email delivery is configured anywhere in this step** — `RESEND_API_KEY` remains unset; `notifyInvitationCreated`'s call inside the create/refresh action is a verified no-op in this environment. The safe preview surface exists specifically so branding/wording can be verified before that changes.
- Module 2 as a whole remains **not production-enabled**.
