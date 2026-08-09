import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser, listOrganizationsForUser } from "@/lib/organizations/organizations";
import { listWorkspacesForUser } from "@/lib/workspaces/workspaces";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { toOrganizationSwitcherItems, toWorkspaceSwitcherItems } from "@/lib/dashboard/view-models";
import { getNavItems } from "@/lib/dashboard/nav-items";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { MobileNav } from "@/components/dashboard/MobileNav";
import { TopBar } from "@/components/dashboard/TopBar";

export const dynamic = "force-dynamic";

/**
 * Resolves the organization named in the URL for the current user (Step
 * 5A) — an invalid or inaccessible slug renders Next.js's `notFound()`
 * (404), identical whether the slug doesn't exist at all or simply isn't
 * one this user belongs to (never leaking which case it was). Re-runs the
 * session gate independently of the parent `/app` layout, and fetches
 * everything the persistent shell (sidebar + mobile drawer) needs: the
 * user's full organization list (for the org switcher) and this
 * organization's workspace list, filtered from `listWorkspacesForUser`
 * exactly like the existing `GET /api/organizations/{id}/workspaces` route
 * already does — reusing, not duplicating, that filtering logic.
 */
export default async function OrganizationLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}`);

  let organization;
  try {
    ({ organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId));
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) {
      notFound();
    }
    throw err;
  }

  const [organizations, allWorkspaces] = await Promise.all([
    listOrganizationsForUser(db, user.userId),
    listWorkspacesForUser(db, user.userId),
  ]);
  const workspaces = allWorkspaces.filter((ws) => ws.organizationId === organization.id);

  const navItems = getNavItems(organizationSlug);
  const dashboardHref = `/app/${organizationSlug}`;
  const organizationItems = toOrganizationSwitcherItems(organizations);
  const workspaceItems = toWorkspaceSwitcherItems(workspaces);
  // Sidebar/MobileNav only ever need name/email for display — passing the
  // full `user` object here would also serialize `userId` into the client
  // bundle (TypeScript's structural typing doesn't strip excess fields off
  // a variable the way it would an inline object literal).
  const displayUser = { name: user.name, email: user.email };

  return (
    <div className="lynq-app-shell flex flex-1 flex-col md:flex-row">
      <Sidebar
        user={displayUser}
        organizations={organizationItems}
        currentOrganizationSlug={organizationSlug}
        workspaces={workspaceItems}
        navItems={navItems}
        dashboardHref={dashboardHref}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="lynq-glass flex items-center justify-between border-b border-glass-border p-4 md:hidden">
          <span className="font-serif text-lg italic font-light text-foreground">LYNQ</span>
          <MobileNav
            user={displayUser}
            organizations={organizationItems}
            currentOrganizationSlug={organizationSlug}
            workspaces={workspaceItems}
            navItems={navItems}
            dashboardHref={dashboardHref}
          />
        </div>
        <TopBar navItems={navItems} dashboardHref={dashboardHref} user={displayUser} />
        <main className="flex flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
