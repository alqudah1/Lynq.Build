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

export default async function CommunicationsAnalyticsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/analytics/communications`);

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

  const result = await loadDomainAnalyticsPage(db, { organizationId, workspaceId: null, actorUserId: user.userId, domain: "communications" });

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Analytics", href: `/app/${organizationSlug}/analytics` }, { label: "Communications" }]} />
      <PageHeader eyebrow="Analytics OS" title="Communications analytics" description="'Delivered' always requires a real provider delivery event — development providers never produce that signal, so delivery counts are 0 unless a real provider (e.g. Resend) is connected." />

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
