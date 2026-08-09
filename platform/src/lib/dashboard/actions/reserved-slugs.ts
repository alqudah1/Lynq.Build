/**
 * Step 5B's new admin routes introduce static path segments directly
 * under the dynamic `/app/{organizationSlug}` and `/app/{organizationSlug}/
 * {workspaceSlug}` segments — `/app/new`, `/app/{org}/settings`,
 * `/app/{org}/members`, `/app/{org}/workspaces/new`. Next.js always
 * resolves a static route over a same-level dynamic one, so an
 * organization or workspace whose SLUG happened to match one of these
 * words would become permanently unreachable at its own URL (silently
 * shadowed by the static page instead) — a real, previously-latent
 * conflict this step's own new routes expose, not something introduced
 * carelessly. Rejected at creation/rename time instead, with a clear
 * inline validation message, rather than allowed to happen invisibly.
 *
 * Step 5C adds `/app/{org}/invitations` — another static sibling of
 * `/app/{org}/{workspaceSlug}` — so `"invitations"` joins the reserved
 * workspace-slug set for the identical reason.
 */
export const RESERVED_ORGANIZATION_SLUGS = new Set(["new"]);
export const RESERVED_WORKSPACE_SLUGS = new Set(["settings", "members", "workspaces", "invitations"]);
