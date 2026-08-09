# Module 2 Step 5A — Authenticated Dashboard Shell, Organization Switcher, and Workspace Switcher

The first real UI in this codebase — everything before this step was API-only (Step 4A–4C.1) or a single plain-text landing stub (`/invite`). Built entirely on the domain services, authorization helpers, and session primitives already shipped in earlier steps; no new authentication mechanism, no bypass, no temporary login mode. **Not production-enabled** — Step 3's live Google/Microsoft OAuth acceptance remains pending, unchanged by this step.

---

## Route structure

```
/app                                        → redirects to the user's first organization, or an empty state
/app/{organizationSlug}                     → organization-level dashboard home
/app/{organizationSlug}/{workspaceSlug}     → workspace-level dashboard home
/sign-in-required                           → the "simple sign-in-required state", outside the /app tree entirely
```

Slugs, never database IDs, appear in every primary user-facing URL. `organizations.slug` and `workspaces.slug` (both already unique — globally and per-organization respectively) back this directly; two new domain functions do the slug-to-record resolution:

- `getOrganizationBySlugForUser(db, slug, userId)` (`src/lib/organizations/organizations.ts`)
- `getWorkspaceBySlugForUser(db, organizationId, slug, userId)` (`src/lib/workspaces/workspaces.ts`)

Both mirror their existing ID-based counterparts exactly (same tenant-scoped-then-membership-checked pattern, same `TenantResourceNotFoundError` for every failure mode — nonexistent, soft-deleted, or simply not-a-member — never distinguished).

`/sign-in-required` is deliberately outside `/app` so the session gate can never redirect into itself.

---

## Session-gate behavior

`requireDashboardUser(db, currentPath)` (`src/lib/dashboard/session-gate.ts`) is the reusable guard:

1. Reads the `__Host-lynq_session` cookie via the existing `getSessionCookie`.
2. Validates it through the existing, **unmodified** `validateSessionToken` — the identical function a real OAuth login's session goes through. No bypass, no test-only mode: this function cannot tell a session created via `createSession` (as every test does, matching this project's standing discipline) apart from one created by a real OAuth callback.
3. On any failure (no cookie, expired, revoked, tampered — `validateSessionToken` already treats all three identically) or a missing user row, calls Next.js's `redirect()` to `/sign-in-required?returnTo={validated path}` — never throws a catchable error back to the caller.
4. On success, returns only `{ userId, email, name }` — never the session token, its hash, or any other row.

**Every route resolves this independently** — there is no single choke point a request could bypass. `/app/page.tsx`, `/app/{slug}/layout.tsx`, and `/app/{slug}/{workspace}/page.tsx` each call `requireDashboardUser` themselves, matching this project's "never chain trust, always re-verify at the point of use" discipline (the same principle behind Step 4A's tenant-scoped queries and Step 4C's per-route rate limiting). The outermost `/app/layout.tsx` deliberately does **not** duplicate this check — testing confirmed that an additional check there would always fire first, collapsing every redirect's `returnTo` down to the generic `/app` fallback instead of the more specific path the user actually requested; removing it lets the more specific nested checks be the ones that fire, with no loss of coverage (nothing renders without passing through a nested gate regardless).

**No application-wide middleware was introduced.** Protection is explicit, at the route/layout level, exactly as instructed.

### Open-redirect prevention

`buildSignInRequiredUrl` re-validates every candidate return path through the existing `resolveSafeRedirectTarget` (Step 3's internal-relative-only allow-list) — regardless of whether the value came from a route's own known params or from a query string a user could type by hand. `/sign-in-required` itself re-validates `returnTo` a second time before using it, since a user can visit that page directly with an arbitrary query string. Verified directly: `https://evil.example.com` and `//evil.example.com` both collapse to the safe `/app` fallback.

---

## Organization and workspace resolution

- **Organization switcher**: populated from `listOrganizationsForUser` (already excludes soft-deleted organizations). Switching is a real navigation (`<Link href="/app/{slug}">`), never a client-side state change — the destination route re-runs its own server-side gate and membership check. An inaccessible or nonexistent slug produces Next.js's `notFound()` (404), identical whether it doesn't exist or simply isn't this user's.
- **Workspace switcher**: populated from `listWorkspacesForUser`, filtered to the current organization — the same filtering approach already established for `GET /api/organizations/{id}/workspaces` (Step 4B), reused rather than duplicated. Organization membership alone — including owner/admin — never makes a workspace appear; only an explicit `workspace_memberships` row does. `getWorkspaceBySlugForUser` enforces this with no admin-override, so an organization owner/admin with no workspace membership of their own gets the identical 404 as anyone else. A separate workspace-administration surface for such admins is explicitly deferred, not built here.
- **Empty states**: an explicit "No organizations yet" state at `/app` for a user in zero organizations (no auto-created organization), and an explicit "No workspaces assigned" state in the workspace switcher (and a hint on the organization dashboard home) when the current organization has none assigned to this user.

---

## Data boundaries — what is (and isn't) serialized to client components

Two mapping functions (`src/lib/dashboard/view-models.ts`) are the explicit, tested boundary between a full domain record and what a "use client" component actually receives:

```ts
toOrganizationSwitcherItems(orgs) → { slug, name, role }[]
toWorkspaceSwitcherItems(workspaces) → { slug, name, role }[]
```

Neither ever carries an `id`, `organizationId`, `deletedAt`, or timestamp — proven directly in `view-models.test.ts` by asserting the exact key set of the mapped output. Navigation is slug-based throughout, so no client component ever needs a raw ID at all.

**Never serialized to any client component, anywhere in this step**: the session token, its hash, a raw membership row (only `{slug, name, role}` ever crosses the server/client boundary), audit metadata, provider account IDs, or any other internal authorization detail. `requireDashboardUser`'s own return type is the enforcement point for the user object (`{userId, email, name}` only); the two view-model functions are the enforcement point for organization/workspace lists.

---

## Responsive navigation

Desktop: a persistent `<aside>` sidebar (`Sidebar.tsx`) — organization switcher, workspace switcher, a `<nav aria-label="Primary">` landmark for the actual nav links, and account controls (name/email, sign-out) — visible at `md:` and above.

Mobile: `MobileNav.tsx` — a trigger button that opens a full-screen `role="dialog" aria-modal="true"` drawer with the **identical** information hierarchy (same switchers, same nav, same account controls — one shared `NavList` component, never a divergent mobile-only nav). No hover-dependent controls anywhere. Every interactive target is at least 44×44px (`min-h-11 min-w-11`, Tailwind's `11 = 2.75rem = 44px`). Opening moves focus to the drawer's close button; Escape closes the drawer and returns focus to the trigger; body scroll is locked while open.

Both surfaces share one nav-item list (`getNavItems`, `src/lib/dashboard/nav-items.ts`): only "Dashboard" is a real link. Brain, Agents, Workflows, Clients, Products, and Settings all render as plain, non-interactive text with a "Coming later" badge — not a link, not a button, nothing that could ever 404 or otherwise break.

**Update (LYNQ Projects Core, Module 10):** `getNavItems` now includes a real "Projects" link (`/app/{organizationSlug}/projects`), placed immediately after "Dashboard" and before the remaining "Coming later" placeholders — the first entry added to this list since Step 5A/5B/5C. No other item's `comingLater`/`href` state changed.

**Update (LYNQ Workflow Engine Core, Module 11):** `getNavItems` gains 3 more real links — "Workflows" (`/app/{organizationSlug}/workflows`, replacing its own former "Coming later" placeholder), "Workflow Executions" (`/app/{organizationSlug}/workflow-executions`), and "My Work" (`/app/{organizationSlug}/my-work`) — each following the exact same pattern "Projects" established in Module 10. Remaining placeholders (Brain, Agents, Clients, Products) are unchanged.

**Update (LYNQ CRM Core, Module 12):** `getNavItems` gains one more real link — "CRM" (`/app/{organizationSlug}/crm`), placed after "Projects" and before "Workflows". "Clients" deliberately remains a "Coming later" placeholder rather than being repointed at CRM — CRM is the canonical contact/customer layer for Sales OS/Marketing OS to build on later, not a "Clients" feature in its own right; a future module may retire that placeholder once a real client-facing surface exists. Brain/Agents/Products are unchanged.

**Update (LYNQ Marketing OS Core, Module 15, now complete):** `getNavItems` gains one more real link — "Marketing" (`/app/{organizationSlug}/marketing`), placed between "Sales" and "Workflows". Remaining placeholders are unchanged. See `MODULE_15_MARKETING_OS.md`.

**Update (LYNQ Communications & Integrations Core, Module 16, now complete):** `getNavItems` gains two more real links — "Communications" (`/app/{organizationSlug}/communications`) and "Integrations" (`/app/{organizationSlug}/integrations`), placed immediately after "Marketing" and before "Workflows". Remaining placeholders are unchanged. See `MODULE_16_COMMUNICATIONS_CORE.md`.

---

## Invitation-status behavior

`InvitationStatusBanner` reads `?invitation=accepted|failed` from the URL (the only two values the OAuth callback — Step 4C.1 — ever attaches) via a lazy `useState` initializer (computed once, during the initial render, not as a side effect). It renders one of exactly two fixed strings — `"Invitation accepted."` or `"This invitation could not be completed."` — from a small lookup table; any other or missing value renders nothing. The specific internal reason (expired/revoked/email_mismatch/already_used/tenant_mismatch/not_found) never reaches this component in the first place — the server-side flow (Step 4C.1) already collapses all of those to the single word `failed` before it ever appears in a URL. Immediately after the initial render, the component strips `invitation` from the URL via `router.replace` (so a refresh doesn't re-trigger it) while keeping the banner itself visible until the user explicitly dismisses it — satisfying "dismiss after display OR remove from the URL" by doing both.

---

## Accessibility

- **Semantic landmarks**: `<aside>` for the sidebar, `<nav aria-label="Primary">` for the actual nav links (scoped narrowly — the switchers and account controls sit in the `<aside>` but outside the `<nav>`, since they aren't "navigation" in the landmark sense), `<main>` for page content, `<header>`/`<section aria-label="Available modules">` on the dashboard home.
- **Keyboard operability**: both switchers and the mobile drawer close on Escape; all interactive elements are real `<button>`/`<a>` elements (never a `<div>` with a click handler).
- **Visible focus states**: a global `:focus-visible` rule (`globals.css`) using the brand accent color, not the browser default — applies everywhere, not per-component.
- **Labels**: `aria-haspopup`/`aria-expanded`/`aria-controls` on both switcher triggers and the mobile nav trigger; `aria-label` on the mobile dialog and on icon-only buttons (open/close/dismiss).
- **`aria-current="page"`**: on the active nav link and on the currently-selected item inside each switcher's menu.
- **Reduced motion**: a global `prefers-reduced-motion` media query collapses all animation/transition durations to near-zero.
- **Heading hierarchy**: one `<h1>` per dashboard-home render (the greeting), `<h3>` for each module placeholder card — no skipped levels.
- **Automated checks**: `jest-axe` runs against every interactive dashboard component (`*.a11y.test.tsx`, jsdom environment, `npm run test:a11y`) — the organization switcher, workspace switcher, mobile nav (both closed and open states), and the invitation banner. `eslint-config-next`'s bundled `jsx-a11y` rules additionally run on every `npm run lint`.

---

## Design

Uses the LYNQ platform tokens exactly as already defined in `globals.css` (dark near-black background `#080808`, elevated surface `#0e0e0e`, warm gold accent `#d2aa64`/`#e0bb80`, Outfit sans + Cormorant Garamond italic-serif headings) — the actual, existing LYNQ brand system is dark-only by design (confirmed against the marketing site's own CSS during this step's research; no light/stone surface exists anywhere in LYNQ's brand material to begin with). Extended `@theme inline` with `--color-elevated`/`--color-border`/`--color-muted`/`--color-subtle`/`--color-accent` so new components use semantic Tailwind utilities (`bg-elevated`, `border-border`, `text-muted`) instead of arbitrary-value sprawl. Sharp corners (no rounded-2xl "SaaS template" look), no gradients, no box-shadows — matching the marketing site's own near-flat, editorial aesthetic. No fake metrics, no fake activity data, no fake agents — every module card is a plain navigation placeholder with a description and a "Coming later" badge, nothing else. The marketing site itself was not touched.

---

## Known limitation

**Live Google/Microsoft OAuth acceptance remains pending** (Step 3) — this dashboard is built and tested entirely against database-backed sessions created directly via `createSession` (the same primitive a real OAuth login would populate), never against a real provider round trip. No runtime bypass or temporary authentication mode was introduced anywhere to make this possible — `requireDashboardUser` is the exact, unmodified validation path a real session would go through; only the origin of the session token differs between a test and a real login. Module 2 as a whole remains **not production-enabled** until that live acceptance succeeds.

## Update (LYNQ Analytics OS, Module 17, now complete)

`getNavItems` gained one new real link — "Analytics", pointing at `/app/[organizationSlug]/analytics` — alongside the existing "Communications"/"Integrations" links, following the identical pattern every prior module used to add its own nav entry. No change to the shell's own layout, session handling, or any other nav item. See `MODULE_17_ANALYTICS_OS.md`.

## Update (LYNQ Founder Workspace / Executive OS, Module 18, now complete)

`getNavItems` gained one new real link — "Founder", pointing at `/app/[organizationSlug]/founder` — following the identical pattern every prior module used to add its own nav entry. No change to the shell's own layout, session handling, or any other nav item. See `MODULE_18_FOUNDER_WORKSPACE.md`.
