import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { computeExecutiveSalesView } from "@/lib/founder-os/sales-view";
import { formatMetricValue } from "@/lib/analytics-os/format";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { AttentionList } from "@/components/founder/AttentionList";

export const dynamic = "force-dynamic";

export default async function FounderSalesPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/founder/sales`);

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

  const view = await computeExecutiveSalesView(db, { organizationId, workspaceId: null, actorUserId: user.userId });

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Founder", href: `/app/${organizationSlug}/founder` }, { label: "Sales" }]} />
      <PageHeader eyebrow="Founder Workspace" title="Executive Sales view" description="Weighted pipeline is always labeled an estimate. No predictive win probability is ever computed." />

      {view.forecast ? (
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card padding="md"><p className="text-xs uppercase tracking-[0.15em] text-subtle">Open pipeline</p><p className="font-serif text-2xl italic font-light text-foreground">{formatMetricValue(view.forecast.openPipelineValue, "currency", null)}</p></Card>
          <Card padding="md"><p className="text-xs uppercase tracking-[0.15em] text-subtle">Weighted pipeline (estimate)</p><p className="font-serif text-2xl italic font-light text-foreground">{formatMetricValue(view.forecast.weightedPipelineValueEstimate, "currency", null)}</p></Card>
          <Card padding="md"><p className="text-xs uppercase tracking-[0.15em] text-subtle">Won value</p><p className="font-serif text-2xl italic font-light text-foreground">{formatMetricValue(view.forecast.wonValue, "currency", null)}</p></Card>
          <Card padding="md"><p className="text-xs uppercase tracking-[0.15em] text-subtle">Lost value</p><p className="font-serif text-2xl italic font-light text-foreground">{formatMetricValue(view.forecast.lostValue, "currency", null)}</p></Card>
        </section>
      ) : null}

      {view.forecast ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Forecast categories</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(view.forecast.byForecastCategory).map(([category, totals]) => (
              <Card key={category} padding="sm">
                <p className="text-xs uppercase tracking-[0.1em] text-subtle">{category.replace(/_/g, " ")}</p>
                <p className="text-sm text-foreground">{totals.count} opportunities</p>
                <p className="text-sm text-muted">{formatMetricValue(totals.value, "currency", null)}</p>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">At-risk opportunities</h2>
        {view.atRisk ? <p className="text-sm text-foreground">{view.atRisk.current.points[0]?.value ?? 0} opportunities past expected close date</p> : null}
        {view.overdueFollowUps ? <p className="text-sm text-foreground">{view.overdueFollowUps.current.points[0]?.value ?? 0} overdue follow-ups</p> : null}
      </section>

      {view.topOpportunities.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Top opportunities by value</h2>
          <Card padding="sm" className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-[0.1em] text-subtle">
                  <th scope="col" className="py-2 pr-4">Opportunity</th>
                  <th scope="col" className="py-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {view.topOpportunities.map((o) => (
                  <tr key={o.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-4 text-foreground">{o.name}</td>
                    <td className="py-2 text-muted">{formatMetricValue(o.amount, "currency", null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      ) : null}

      {view.targetProgress.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Target progress</h2>
          <AttentionList
            items={view.targetProgress.map((tp) => ({
              id: tp.target.id,
              severity: tp.progressRatio < 0.5 ? "attention" : "info",
              domain: "sales" as const,
              reasonCode: "target_progress",
              title: `${Math.round(tp.progressRatio * 100)}% of target reached`,
              explanation: `Actual: ${formatMetricValue(tp.actualValue, "currency", null)} of ${formatMetricValue(Number(tp.target.targetValue), "currency", null)}`,
              recordType: "sales_target",
              recordId: tp.target.id,
              dueAt: tp.target.periodEnd.toISOString(),
              recommendedActionType: "review_sales_target",
              drilldown: { metricKey: null, recordType: "sales_target", recordId: tp.target.id },
            }))}
          />
        </section>
      ) : null}
    </div>
  );
}
