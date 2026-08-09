import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { getWorkspaceForAdministration } from "@/lib/workspaces/workspaces";
import { TenantResourceNotFoundError, InsufficientRoleError } from "@/lib/authz/errors";
import { Breadcrumbs, type Breadcrumb } from "@/components/dashboard/Breadcrumbs";
import { WorkspaceSettingsForm } from "@/components/dashboard/WorkspaceSettingsForm";
import { DeleteWorkspaceSection } from "@/components/dashboard/DeleteWorkspaceSection";

export const dynamic = "force-dynamic";

/**
 * Workspace settings/administration (Step 5B) — resolved via
 * `getWorkspaceForAdministration`, which succeeds for an explicit
 * workspace manager OR an organization owner/admin via the approved
 * override, WITHOUT granting the latter workspace content access (that
 * remains gated separately, by `getWorkspaceBySlugForUser`, untouched). A
 * workspace member/viewer who is not a manager and not an org owner/admin
 * gets a clear "you don't have permission" message here — not a 404,
 * since they ARE a legitimate organization member, just not one
 * authorized to administer this specific workspace. A genuinely
 * nonexistent or cross-organization workspace slug still 404s.
 */
export default async function WorkspaceSettingsPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; workspaceSlug: string }>;
}) {
  const { organizationSlug, workspaceSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/${workspaceSlug}/settings`);

  let organizationName: string;
  let orgRole: string;
  let accessDenied = false;
  let workspaceName = "";
  let workspaceSlugValue = "";

  try {
    const { organization, membership } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    organizationName = organization.name;
    orgRole = membership.role;

    try {
      const { workspace } = await getWorkspaceForAdministration(db, organization.id, workspaceSlug, user.userId);
      workspaceName = workspace.name;
      workspaceSlugValue = workspace.slug;
    } catch (err) {
      if (err instanceof InsufficientRoleError) {
        accessDenied = true;
      } else {
        throw err;
      }
    }
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) {
      notFound();
    }
    throw err;
  }

  const breadcrumbBase: Breadcrumb[] = [{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }];

  if (accessDenied) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-8 px-6 py-10">
        <Breadcrumbs items={[...breadcrumbBase, { label: "Settings" }]} />
        <p className="text-sm text-muted">
          You don&rsquo;t have permission to administer this workspace. Only its manager, or an organization owner/admin, can.
        </p>
      </div>
    );
  }

  const canDelete = orgRole === "owner" || orgRole === "admin";

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-8 px-6 py-10">
      <Breadcrumbs
        items={[...breadcrumbBase, { label: workspaceName, href: `/app/${organizationSlug}/${workspaceSlug}` }, { label: "Settings" }]}
      />
      <header>
        <h1 className="font-serif text-3xl italic font-light text-foreground">Workspace settings</h1>
      </header>
      <WorkspaceSettingsForm organizationSlug={organizationSlug} workspaceSlug={workspaceSlug} name={workspaceName} slug={workspaceSlugValue} />
      {canDelete ? (
        <section className="flex flex-col gap-3 border-t border-border pt-6">
          <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Danger zone</h2>
          <DeleteWorkspaceSection organizationSlug={organizationSlug} workspaceSlug={workspaceSlug} workspaceName={workspaceName} />
        </section>
      ) : null}
    </div>
  );
}
