import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { loadDomainAnalyticsPage } from "@/lib/analytics-os/page-data";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { MetricCard } from "@/components/analytics/MetricCard";
import { MetricTable } from "@/components/analytics/MetricTable";

export const dynamic = "force-dynamic";

export default async function ProjectsAnalyticsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/analytics/projects`);

  let organizationName: string;
  let organizationId: string;
  try {
    const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
    organizationName = organization.name;
    organizationId = organization.id;
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  const result = await loadDomainAnalyticsPage(db, { organizationId, workspaceId: null, actorUserId: user.userId, domain: "projects" });

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Analytics", href: `/app/${organizationSlug}/analytics` }, { label: "Projects" }]} />
      <PageHeader eyebrow="Analytics OS" title="Projects analytics" description="Org-wide counts across all projects — visible to any organization member, since Projects Core has no separate org-wide aggregate gate of its own. Drilling into a specific project still goes through that project's own real permission check." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {result.metrics.map((metric) => (
          <MetricCard key={metric.metricKey} metric={metric} />
        ))}
      </div>

      {result.metrics.map((metric) => (
        <MetricTable key={metric.metricKey} metric={metric} />
      ))}
    </div>
  );
}
