import { notFound, redirect } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { InsufficientRoleError, TenantResourceNotFoundError } from "@/lib/authz/errors";
import { loadDashboardSummary } from "@/lib/dashboard/summary";
import { loadOfficeView } from "@/lib/office/view";
import { listWorkspacesForUser } from "@/lib/workspaces/workspaces";
import { DashboardHome } from "@/components/dashboard/DashboardHome";

export const dynamic = "force-dynamic";

/**
 * Organization-level dashboard home — no workspace selected (Step 5A).
 * Independently re-resolves both the session and the organization (never
 * trusts the parent layout's own resolution implicitly), matching this
 * project's "every route resolves its own authorization" discipline.
 */
export default async function OrganizationDashboardPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}`);

  let organization;
  let membership;
  try {
    ({ organization, membership } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId));
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) {
      notFound();
    }
    throw err;
  }

  // Team members should enter a clear task-first page, rather than a
  // founder's command centre full of tools they do not need.
  if (membership.role === "member" || membership.role === "viewer") {
    redirect(`/app/${organizationSlug}/my-work`);
  }

  const [summary, officeResult, workspaces] = await Promise.all([
    loadDashboardSummary(db, { organizationId: organization.id, actorUserId: user.userId }),
    /*
     * The leadership-floor view contains founder-only reporting. A regular
     * member must still be able to enter the Office and reach their projects
     * and work, even if that optional founder view is unavailable to them.
     */
    loadOfficeView(db, { organizationId: organization.id, actorUserId: user.userId }).catch((err) => {
      // The leadership-floor report is optional for a normal member. Do not
      // swallow infrastructure or data errors: only the expected capability
      // boundary gets this member-safe fallback.
      if (!(err instanceof InsufficientRoleError)) throw err;
      return {
        employees: [],
        recentActivity: [],
        activeAssignmentCount: 0,
        completedThisPeriod: 0,
        assistantAgentId: null,
      };
    }),
    listWorkspacesForUser(db, user.userId),
  ]);
  const primaryWorkspace =
    workspaces.find((workspace) => workspace.organizationId === organization.id && workspace.slug === "operations") ??
    workspaces.find((workspace) => workspace.organizationId === organization.id) ??
    null;

  return (
    <DashboardHome
      displayName={user.name ?? user.email}
      organizationName={organization.name}
      workspaceName={primaryWorkspace?.name ?? null}
      organizationId={organization.id}
      organizationSlug={organizationSlug}
      workspaceId={primaryWorkspace?.id ?? null}
      summary={summary}
      office={officeResult}
    />
  );
}
