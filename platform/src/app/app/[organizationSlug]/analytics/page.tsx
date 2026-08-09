import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { computeExecutiveKpis } from "@/lib/analytics-os/kpis";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { MetricCard } from "@/components/analytics/MetricCard";

export const dynamic = "force-dynamic";

const GROUP_LABELS: Record<string, string> = {
  growth: "Growth",
  sales: "Sales",
  marketing: "Marketing",
  delivery: "Delivery",
  operations: "Operations",
  communications: "Communications",
  ai: "AI",
};

const DOMAIN_PAGES = [
  { href: "crm", label: "CRM" },
  { href: "sales", label: "Sales" },
  { href: "marketing", label: "Marketing" },
  { href: "communications", label: "Communications" },
  { href: "projects", label: "Projects" },
  { href: "workflows", label: "Workflows" },
  { href: "agents", label: "Agents" },
];

export default async function AnalyticsOverviewPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/analytics`);

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

  const groups = await computeExecutiveKpis(db, { organizationId, workspaceId: null, actorUserId: user.userId });

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Analytics" }]} />
      <PageHeader
        eyebrow="Analytics OS"
        title="Analytics"
        description="Deterministic metrics aggregated from CRM, Sales, Marketing, Communications, Projects, Workflows, and Agent Runtime — every value traces back to a real canonical record, never an LLM-generated or fabricated number."
        actions={
          <>
            <Link href={`/app/${organizationSlug}/analytics/reports`} className="text-xs text-accent">Saved reports →</Link>
            <Link href={`/app/${organizationSlug}/analytics/settings`} className="text-xs text-accent">Settings →</Link>
          </>
        }
      />

      <section className="flex flex-wrap gap-2" aria-label="Domain analytics">
        {DOMAIN_PAGES.map((d) => (
          <Link key={d.href} href={`/app/${organizationSlug}/analytics/${d.href}`} className="lynq-transition rounded-sm border border-border px-3 py-1.5 text-xs text-subtle hover:border-border-strong hover:text-foreground">
            {d.label}
          </Link>
        ))}
      </section>

      {groups.length === 0 ? (
        <Card className="text-sm text-subtle">No Analytics metrics are visible to you yet — ask an organization admin to grant an Analytics role, or check back once CRM/Sales/Marketing/Communications/Projects/Workflow/Agent data exists.</Card>
      ) : (
        groups.map((group) => (
          <section key={group.group} className="flex flex-col gap-3">
            <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">{GROUP_LABELS[group.group] ?? group.group}</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {group.metrics.map((metric) => (
                <MetricCard key={metric.metricKey} metric={metric} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
