import "server-only";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { AuthzError, TenantResourceNotFoundError } from "@/lib/authz/errors";
import { Breadcrumbs, type Breadcrumb } from "@/components/dashboard/Breadcrumbs";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

/** The standard dashboard data path every Social page starts with: env → db → session gate → tenant-scoped organization (404 when not a member). */
export async function loadSocialPageContext(organizationSlug: string, path: string) {
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, path);
  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    return { db, user, organization, organizationSlug };
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }
}

export function socialBreadcrumbs(organizationName: string, organizationSlug: string, trail: Breadcrumb[]): Breadcrumb[] {
  return [{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Social", href: trail.length ? `/app/${organizationSlug}/social` : undefined }, ...trail];
}

/** Maps a service error on a page read: cross-tenant ids 404; missing marketing authority renders an honest no-access state; anything else bubbles to the error boundary. */
export function renderSocialPageError(err: unknown, input: { organizationName: string; organizationSlug: string; title: string }): React.ReactElement {
  if (err instanceof TenantResourceNotFoundError) notFound();
  if (err instanceof AuthzError) {
    return (
      <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
        <Breadcrumbs items={socialBreadcrumbs(input.organizationName, input.organizationSlug, [{ label: input.title }])} />
        <PageHeader title={input.title} />
        <EmptyState title="You don't have access to Social yet." description="Ask an organization owner or admin to give you a marketing role (viewer, contributor or manager)." />
      </div>
    );
  }
  throw err;
}
