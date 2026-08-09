import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError, InsufficientRoleError } from "@/lib/authz/errors";
import { runSavedReport } from "@/lib/analytics-os/reports";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { MetricCard } from "@/components/analytics/MetricCard";
import { MetricTable } from "@/components/analytics/MetricTable";

export const dynamic = "force-dynamic";

export default async function AnalyticsReportDetailPage({ params }: { params: Promise<{ organizationSlug: string; reportId: string }> }) {
  const { organizationSlug, reportId } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/analytics/reports/${reportId}`);

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

  let report;
  let result;
  try {
    ({ report, result } = await runSavedReport(db, { organizationId, actorUserId: user.userId, reportId }));
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    if (err instanceof InsufficientRoleError) {
      return (
        <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
          <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Analytics", href: `/app/${organizationSlug}/analytics` }, { label: "Reports", href: `/app/${organizationSlug}/analytics/reports` }, { label: "Report" }]} />
          <Card className="text-sm text-danger">This report is private to its owner.</Card>
        </div>
      );
    }
    throw err;
  }

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Analytics", href: `/app/${organizationSlug}/analytics` }, { label: "Reports", href: `/app/${organizationSlug}/analytics/reports` }, { label: report.name }]} />
      <PageHeader eyebrow="Saved report" title={report.name} description={report.description ?? undefined} />

      <p className="text-xs text-subtle">
        Range: {result.range.from.toISOString().slice(0, 10)} → {result.range.to.toISOString().slice(0, 10)}
        {result.comparisonRange ? ` · compared to ${result.comparisonRange.from.toISOString().slice(0, 10)} → ${result.comparisonRange.to.toISOString().slice(0, 10)}` : null}
      </p>

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
