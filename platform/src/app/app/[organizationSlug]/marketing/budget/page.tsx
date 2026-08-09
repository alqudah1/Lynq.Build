import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { listCampaignsForUser } from "@/lib/marketing-os/campaigns";
import { listBudgetEntriesForCampaign } from "@/lib/marketing-os/budget";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

export default async function MarketingBudgetPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/marketing/budget`);

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

  const campaigns = await listCampaignsForUser(db, { organizationId, actorUserId: user.userId });
  const rows = await Promise.all(
    campaigns.map(async (c) => {
      const entries = await listBudgetEntriesForCampaign(db, { organizationId, campaignId: c.id, actorUserId: user.userId });
      const planned = entries.reduce((sum, e) => sum + (e.plannedAmount ? Number(e.plannedAmount) : 0), 0);
      const spend = entries.reduce((sum, e) => sum + (e.spendAmount ? Number(e.spendAmount) : 0), 0);
      return { campaign: c, planned, spend, currency: entries[0]?.currency ?? c.currency ?? "" };
    })
  );
  const withBudget = rows.filter((r) => r.planned > 0 || r.spend > 0);

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Marketing", href: `/app/${organizationSlug}/marketing` }, { label: "Budget" }]} />
      <PageHeader title="Budget" description="Planned vs. manually recorded spend, per campaign — no ad-platform sync in this module." />

      {withBudget.length === 0 ? (
        <EmptyState title="No budget entries recorded yet." description="Add one from a campaign's own page." />
      ) : (
        <ul className="flex flex-col gap-2">
          {withBudget.map((row) => (
            <Card as="li" key={row.campaign.id} padding="sm">
              <Link href={`/app/${organizationSlug}/marketing/campaigns/${row.campaign.id}`} className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-foreground">{row.campaign.name}</span>
                <span className="text-xs text-subtle">
                  Planned: {row.planned.toLocaleString()} {row.currency} · Spend: {row.spend.toLocaleString()} {row.currency}
                </span>
              </Link>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
