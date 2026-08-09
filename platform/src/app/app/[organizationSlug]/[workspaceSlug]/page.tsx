import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { getWorkspaceBySlugForUser } from "@/lib/workspaces/workspaces";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { loadDashboardSummary } from "@/lib/dashboard/summary";
import { DashboardHome } from "@/components/dashboard/DashboardHome";

export const dynamic = "force-dynamic";

/**
 * Workspace-level dashboard home (Step 5A). Independently re-resolves the
 * session, the organization, AND the workspace — the workspace lookup uses
 * `getWorkspaceBySlugForUser`, which requires an EXPLICIT workspace
 * membership (never an organization-role admin-override): an organization
 * owner/admin with no workspace membership of their own gets the identical
 * 404 as anyone else, exactly matching "org owners/admins without
 * workspace membership must not see workspace content."
 */
export default async function WorkspaceDashboardPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; workspaceSlug: string }>;
}) {
  const { organizationSlug, workspaceSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/${workspaceSlug}`);

  let organizationName: string;
  let organizationId: string;
  let workspaceName: string;
  let workspaceId: string;
  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    const { workspace } = await getWorkspaceBySlugForUser(db, organization.id, workspaceSlug, user.userId);
    organizationName = organization.name;
    organizationId = organization.id;
    workspaceName = workspace.name;
    workspaceId = workspace.id;
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) {
      notFound();
    }
    throw err;
  }

  const summary = await loadDashboardSummary(db, { organizationId, workspaceId, actorUserId: user.userId });

  return (
    <DashboardHome
      displayName={user.name ?? user.email}
      organizationName={organizationName}
      workspaceName={workspaceName}
      organizationSlug={organizationSlug}
      summary={summary}
    />
  );
}
