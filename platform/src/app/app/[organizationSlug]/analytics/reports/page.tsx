import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { listSavedReports } from "@/lib/analytics-os/reports";
import { listMetrics } from "@/lib/analytics-os/metrics/registry";
import { ANALYTICS_DATE_RANGE_STRATEGIES, ANALYTICS_TIME_GRAINS, ANALYTICS_VISUALIZATIONS, ANALYTICS_REPORT_VISIBILITIES } from "@/lib/analytics-os/validation";
import { createSavedReportAction, deleteSavedReportAction } from "@/lib/dashboard/actions/analytics";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ActionForm } from "@/components/dashboard/ActionForm";
import { FormField } from "@/components/dashboard/FormField";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";

export const dynamic = "force-dynamic";

const toOptions = (values: readonly string[]) => values.map((v) => ({ value: v, label: v }));

export default async function AnalyticsReportsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/analytics/reports`);

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

  const [reports, metrics] = await Promise.all([listSavedReports(db, { organizationId, workspaceId: null, actorUserId: user.userId }), Promise.resolve(listMetrics())]);

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Analytics", href: `/app/${organizationSlug}/analytics` }, { label: "Reports" }]} />
      <PageHeader eyebrow="Analytics OS" title="Saved reports" description="A saved report is a stored, revalidated set of query engine inputs — never executable SQL. Every run re-checks the same authorization every ad-hoc query does." />

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Your reports</h2>
        {reports.length === 0 ? (
          <Card className="text-sm text-subtle">No saved reports yet.</Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {reports.map((report) => (
              <li key={report.id}>
                <Card padding="sm" className="flex items-center justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <Link href={`/app/${organizationSlug}/analytics/reports/${report.id}`} className="text-sm text-foreground hover:text-accent">{report.name}</Link>
                    <span className="text-xs text-subtle">{report.metricKeys.length} metrics · {report.dateRangeStrategy}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={report.visibility === "organization" ? "info" : "neutral"}>{report.visibility}</Badge>
                    {report.ownerUserId === user.userId ? (
                      <ActionForm action={deleteSavedReportAction.bind(null, organizationSlug)} hiddenFields={{ reportId: report.id }}>
                        <button type="submit" className="text-xs text-danger hover:underline">Delete</button>
                      </ActionForm>
                    ) : null}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">New report</h2>
        <Card padding="md" className="max-w-2xl">
          <ActionForm action={createSavedReportAction.bind(null, organizationSlug)} className="flex flex-col gap-5">
            <FormField label="Name" name="name" required />
            <FormField label="Metric keys (comma-separated)" name="metricKeys" required placeholder="crm_leads_open, sales_pipeline_weighted_value" hint={`Available: ${metrics.map((m) => m.definition.metricKey).join(", ")}`} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SelectField label="Date range" name="dateRangeStrategy" defaultValue="last_30_days" options={toOptions(ANALYTICS_DATE_RANGE_STRATEGIES)} />
              <SelectField label="Time grain" name="timeGrain" defaultValue="day" options={toOptions(ANALYTICS_TIME_GRAINS)} />
              <SelectField label="Visualization" name="visualization" defaultValue="kpi_card" options={toOptions(ANALYTICS_VISUALIZATIONS)} />
              <SelectField label="Visibility" name="visibility" defaultValue="private" options={toOptions(ANALYTICS_REPORT_VISIBILITIES)} />
            </div>
            <label className="flex items-center gap-2 text-xs text-subtle">
              <input type="checkbox" name="comparisonEnabled" defaultChecked />
              Compare to previous period
            </label>
            <div>
              <SubmitButton>Save report</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </section>
    </div>
  );
}
