import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { computeExecutiveMarketingView } from "@/lib/founder-os/marketing-view";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { MetricCard } from "@/components/analytics/MetricCard";

export const dynamic = "force-dynamic";

export default async function FounderMarketingPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/founder/marketing`);

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

  const view = await computeExecutiveMarketingView(db, { organizationId, workspaceId: null, actorUserId: user.userId });

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Founder", href: `/app/${organizationSlug}/founder` }, { label: "Marketing" }]} />
      <PageHeader eyebrow="Founder Workspace" title="Executive Marketing view" description="No impressions/CTR/ROAS are shown unless real provider data exists — none does yet, so none are fabricated." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {view.metrics.map((metric) => (
          <MetricCard key={metric.metricKey} metric={metric} />
        ))}
      </div>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card padding="md"><p className="text-xs uppercase tracking-[0.15em] text-subtle">Pending content approvals</p><p className="font-serif text-2xl italic font-light text-foreground">{view.pendingContentApprovals}</p></Card>
        <Card padding="md">
          <p className="text-xs uppercase tracking-[0.15em] text-subtle">Upcoming launches (30 days)</p>
          {view.upcomingLaunches.length === 0 ? (
            <p className="text-sm text-subtle">None scheduled.</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-1">
              {view.upcomingLaunches.map((c) => (
                <li key={c.id} className="text-sm text-foreground">{c.name} — {c.startDate.slice(0, 10)}</li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}
