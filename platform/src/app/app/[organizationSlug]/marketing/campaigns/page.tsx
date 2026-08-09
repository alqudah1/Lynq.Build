import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { listCampaignsForUser } from "@/lib/marketing-os/campaigns";
import { createCampaignAction } from "@/lib/dashboard/actions/marketing";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField } from "@/components/dashboard/FormField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { ActionForm } from "@/components/dashboard/ActionForm";
import type { MarketingCampaignStatus } from "@/lib/marketing-os/validation";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<MarketingCampaignStatus, BadgeTone> = {
  draft: "neutral",
  planning: "info",
  ready: "info",
  active: "success",
  paused: "warning",
  completed: "success",
  cancelled: "danger",
  archived: "neutral",
};

export default async function MarketingCampaignsPage({ params, searchParams }: { params: Promise<{ organizationSlug: string }>; searchParams: Promise<{ status?: string }> }) {
  const { organizationSlug } = await params;
  const { status } = await searchParams;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/marketing/campaigns`);

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

  const campaigns = await listCampaignsForUser(db, { organizationId, actorUserId: user.userId, status: status as MarketingCampaignStatus | undefined });

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Marketing", href: `/app/${organizationSlug}/marketing` }, { label: "Campaigns" }]} />
      <PageHeader title="Campaigns" description="Every marketing campaign — the canonical source of truth for its own lifecycle status." />

      <ActionForm action={createCampaignAction.bind(null, organizationSlug)} className="flex flex-wrap items-end gap-3 border border-border p-4">
        <FormField label="Campaign key" name="campaignKey" required hint="UPPERCASE_WITH_UNDERSCORES" />
        <FormField label="Name" name="name" required />
        <SubmitButton>Create campaign</SubmitButton>
      </ActionForm>

      {campaigns.length === 0 ? (
        <EmptyState title="No campaigns yet." description="Create your first campaign above." />
      ) : (
        <ul className="flex flex-col gap-2">
          {campaigns.map((campaign) => (
            <Card as="li" key={campaign.id} padding="sm">
              <Link href={`/app/${organizationSlug}/marketing/campaigns/${campaign.id}`} className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm text-foreground">{campaign.name}</span>
                  <span className="text-xs text-subtle">{campaign.campaignKey} · {campaign.objectiveType.replace(/_/g, " ")}</span>
                </div>
                <Badge tone={STATUS_TONE[campaign.status]}>{campaign.status}</Badge>
              </Link>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
