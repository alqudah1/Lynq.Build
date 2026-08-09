import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { computeForecast } from "@/lib/sales-os/forecasting";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

const CATEGORY_LABEL: Record<string, string> = { pipeline: "Pipeline", best_case: "Best case", commit: "Commit", closed: "Closed" };

function StatCard({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
  return (
    <Card className="flex flex-col gap-1.5">
      <p className="text-xs uppercase tracking-[0.15em] text-subtle">{label}</p>
      <p className="font-serif text-3xl italic font-light text-foreground">{value}</p>
      {sublabel ? <p className="text-xs text-subtle">{sublabel}</p> : null}
    </Card>
  );
}

export default async function SalesForecastPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/sales/forecast`);

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

  const forecast = await computeForecast(db, { organizationId, actorUserId: user.userId });
  const currency = forecast.currency ?? "";

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Sales", href: `/app/${organizationSlug}/sales` }, { label: "Forecast" }]} />
      <PageHeader title="Forecast" description="Deterministic pipeline math only — the weighted total is always an estimate, never guaranteed revenue." />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Open pipeline" value={`${forecast.openPipelineValue.toLocaleString()} ${currency}`} sublabel={`${forecast.openOpportunityCount} open opportunities`} />
        <StatCard label="Weighted estimate" value={`${Math.round(forecast.weightedPipelineValueEstimate).toLocaleString()} ${currency}`} sublabel="Estimate — not guaranteed" />
        <StatCard label="Won" value={`${forecast.wonValue.toLocaleString()} ${currency}`} />
        <StatCard label="Lost" value={`${forecast.lostValue.toLocaleString()} ${currency}`} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">By forecast category</h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Object.entries(forecast.byForecastCategory).map(([category, totals]) => (
            <Card as="li" key={category} padding="sm" className="flex items-center justify-between gap-3">
              <span className="text-sm text-foreground">{CATEGORY_LABEL[category] ?? category}</span>
              <span className="text-sm text-subtle">
                {totals.count} · {totals.value.toLocaleString()} {currency}
              </span>
            </Card>
          ))}
        </ul>
      </section>
    </div>
  );
}
