import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { loadDomainAnalyticsPage } from "@/lib/analytics-os/page-data";
import { computeSalesFunnel } from "@/lib/analytics-os/funnels";
import { resolveDateRangeForStrategy } from "@/lib/analytics-os/time";
import { resolveEffectiveAnalyticsConfiguration } from "@/lib/analytics-os/configuration";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { MetricCard } from "@/components/analytics/MetricCard";
import { MetricTable } from "@/components/analytics/MetricTable";
import { FunnelTable } from "@/components/analytics/FunnelTable";

export const dynamic = "force-dynamic";

export default async function SalesAnalyticsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/analytics/sales`);

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

  const config = await resolveEffectiveAnalyticsConfiguration(db, { organizationId, workspaceId: null, actorUserId: user.userId });
  const range = resolveDateRangeForStrategy(config.defaultDateRangeStrategy, config.businessTimezone, null);

  const [result, funnel] = await Promise.all([
    loadDomainAnalyticsPage(db, { organizationId, workspaceId: null, actorUserId: user.userId, domain: "sales" }),
    computeSalesFunnel({ db, organizationId, workspaceId: null, from: range.from, to: range.to, actorUserId: user.userId }),
  ]);

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Analytics", href: `/app/${organizationSlug}/analytics` }, { label: "Sales" }]} />
      <PageHeader eyebrow="Analytics OS" title="Sales analytics" description="Weighted pipeline is always labeled an estimate, never presented as actual revenue. Aggregated from Sales OS's own canonical leads and opportunities." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {result.metrics.map((metric) => (
          <MetricCard key={metric.metricKey} metric={metric} />
        ))}
      </div>

      {result.metrics.map((metric) => (
        <MetricTable key={metric.metricKey} metric={metric} />
      ))}

      <FunnelTable funnel={funnel} />
    </div>
  );
}
