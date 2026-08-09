import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { loadDashboardSummary } from "@/lib/dashboard/summary";
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
  try {
    ({ organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId));
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) {
      notFound();
    }
    throw err;
  }

  const summary = await loadDashboardSummary(db, { organizationId: organization.id, actorUserId: user.userId });

  return (
    <DashboardHome
      displayName={user.name ?? user.email}
      organizationName={organization.name}
      workspaceName={null}
      organizationSlug={organizationSlug}
      summary={summary}
    />
  );
}
