import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { computeExecutiveOperationsView } from "@/lib/founder-os/operations-view";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { MetricCard } from "@/components/analytics/MetricCard";

export const dynamic = "force-dynamic";

export default async function FounderOperationsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/founder/operations`);

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

  const view = await computeExecutiveOperationsView(db, { organizationId, workspaceId: null, actorUserId: user.userId });

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Founder", href: `/app/${organizationSlug}/founder` }, { label: "Operations" }]} />
      <PageHeader eyebrow="Founder Workspace" title="Executive Operations / Workflows view" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {view.metrics.map((metric) => (
          <MetricCard key={metric.metricKey} metric={metric} />
        ))}
      </div>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card padding="md"><p className="text-xs uppercase tracking-[0.15em] text-subtle">Waiting for approval</p><p className="font-serif text-2xl italic font-light text-foreground">{view.workflowsWaitingForApproval}</p></Card>
        <Card padding="md"><p className="text-xs uppercase tracking-[0.15em] text-subtle">Retry scheduled</p><p className="font-serif text-2xl italic font-light text-foreground">{view.retryScheduled}</p></Card>
        <Card padding="md"><p className="text-xs uppercase tracking-[0.15em] text-subtle">Dead-lettered jobs</p><p className="font-serif text-2xl italic font-light text-foreground">{view.deadLettered}</p></Card>
        <Card padding="md"><p className="text-xs uppercase tracking-[0.15em] text-subtle">Expired leases</p><p className="font-serif text-2xl italic font-light text-foreground">{view.expiredLeases}</p></Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Runtime queue state</h2>
        <Card padding="sm" className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-[0.1em] text-subtle">
                <th scope="col" className="py-2 pr-4">Status</th>
                <th scope="col" className="py-2">Count</th>
              </tr>
            </thead>
            <tbody>
              {view.runtimeQueueState.map((row) => (
                <tr key={row.status} className="border-b border-border/60 last:border-0">
                  <td className="py-2 pr-4 text-foreground">{row.status}</td>
                  <td className="py-2 text-muted">{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>
    </div>
  );
}
