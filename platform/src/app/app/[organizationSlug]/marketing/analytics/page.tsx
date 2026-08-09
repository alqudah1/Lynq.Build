import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { getMarketingAnalyticsSummary } from "@/lib/marketing-os/analytics";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

export default async function MarketingAnalyticsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/marketing/analytics`);

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

  const analytics = await getMarketingAnalyticsSummary(db, { organizationId, actorUserId: user.userId });

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Marketing", href: `/app/${organizationSlug}/marketing` }, { label: "Analytics" }]} />
      <PageHeader title="Analytics" description="Operational analytics only — CRM-derived outcomes are clearly distinguished from (currently unavailable) external channel metrics." />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card padding="sm" className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-[0.15em] text-subtle">Campaigns by status</p>
          <p className="text-sm text-foreground">{Object.entries(analytics.campaignsByStatus).map(([s, c]) => `${s}: ${c}`).join(", ") || "None"}</p>
        </Card>
        <Card padding="sm" className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-[0.15em] text-subtle">Campaigns starting soon</p>
          <p className="font-serif text-2xl italic font-light text-foreground">{analytics.campaignsStartingSoon}</p>
        </Card>
        <Card padding="sm" className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-[0.15em] text-subtle">Overdue content</p>
          <p className="font-serif text-2xl italic font-light text-foreground">{analytics.overdueContentCount}</p>
        </Card>
        <Card padding="sm" className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-[0.15em] text-subtle">Content by status</p>
          <p className="text-sm text-foreground">{Object.entries(analytics.contentByStatus).map(([s, c]) => `${s}: ${c}`).join(", ") || "None"}</p>
        </Card>
        <Card padding="sm" className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-[0.15em] text-subtle">Pending approvals</p>
          <p className="font-serif text-2xl italic font-light text-foreground">{analytics.pendingApprovalsCount}</p>
        </Card>
        <Card padding="sm" className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-[0.15em] text-subtle">Budget: planned vs. recorded spend</p>
          <p className="text-sm text-foreground">{analytics.budgetPlannedTotal.toLocaleString()} planned · {analytics.budgetRecordedSpendTotal.toLocaleString()} recorded</p>
        </Card>
        <Card padding="sm" className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-[0.15em] text-subtle">Campaign-sourced CRM leads</p>
          <p className="font-serif text-2xl italic font-light text-foreground">{analytics.campaignSourcedLeadCount}</p>
        </Card>
        <Card padding="sm" className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-[0.15em] text-subtle">Workflow executions by status</p>
          <p className="text-sm text-foreground">{Object.entries(analytics.workflowExecutionsByStatus).map(([s, c]) => `${s}: ${c}`).join(", ") || "None"}</p>
        </Card>
      </section>

      <p className="text-xs text-subtle">Impressions, reach, clicks, CPC, CTR, and ROAS are not shown — this module has no real external channel integration to source them from yet.</p>
    </div>
  );
}
