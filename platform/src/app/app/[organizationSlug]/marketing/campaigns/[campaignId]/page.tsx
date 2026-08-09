import Link from "next/link";
import { notFound } from "next/navigation";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { getCampaignForUser } from "@/lib/marketing-os/campaigns";
import { listContentItemsForCampaign } from "@/lib/marketing-os/content";
import { listCampaignRunsForCampaign, listCampaignRunItems } from "@/lib/marketing-os/campaign-runs";
import { listDestinationsForCampaign } from "@/lib/marketing-os/destinations";
import { listBudgetEntriesForCampaign } from "@/lib/marketing-os/budget";
import { computeCampaignHealth } from "@/lib/marketing-os/health";
import { listPlaybooksForUser } from "@/lib/marketing-os/playbooks";
import {
  transitionCampaignStatusAction,
  launchCampaignBriefAction,
  launchCampaignSummaryAction,
  startCampaignRunAction,
  completeCampaignRunItemAction,
  createDestinationAction,
  createBudgetEntryAction,
} from "@/lib/dashboard/actions/marketing";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { SelectField } from "@/components/dashboard/SelectField";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { ActionForm } from "@/components/dashboard/ActionForm";
import { FormField } from "@/components/dashboard/FormField";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { MARKETING_CAMPAIGN_STATUSES, type MarketingCampaignStatus } from "@/lib/marketing-os/validation";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<MarketingCampaignStatus, BadgeTone> = { draft: "neutral", planning: "info", ready: "info", active: "success", paused: "warning", completed: "success", cancelled: "danger", archived: "neutral" };
const HEALTH_TONE: Record<string, BadgeTone> = { healthy: "success", attention: "warning", at_risk: "danger" };
const CONTENT_STATUS_TONE: Record<string, BadgeTone> = { draft: "neutral", review: "info", approved: "success", scheduled: "info", published: "success", rejected: "danger", archived: "neutral" };

export default async function MarketingCampaignDetailPage({ params }: { params: Promise<{ organizationSlug: string; campaignId: string }> }) {
  const { organizationSlug, campaignId } = await params;
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, `/app/${organizationSlug}/marketing/campaigns/${campaignId}`);

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

  let campaign;
  try {
    campaign = await getCampaignForUser(db, { organizationId, campaignId, actorUserId: user.userId });
  } catch (err) {
    if (err instanceof TenantResourceNotFoundError) notFound();
    throw err;
  }

  const [contentItems, runs, destinations, budgetEntries, health, playbooks] = await Promise.all([
    listContentItemsForCampaign(db, { organizationId, campaignId, actorUserId: user.userId }),
    listCampaignRunsForCampaign(db, { organizationId, campaignId, actorUserId: user.userId }),
    listDestinationsForCampaign(db, { organizationId, campaignId, actorUserId: user.userId }),
    listBudgetEntriesForCampaign(db, { organizationId, campaignId, actorUserId: user.userId }),
    computeCampaignHealth(db, { organizationId, campaignId, actorUserId: user.userId }),
    listPlaybooksForUser(db, { organizationId, playbookType: "campaign", actorUserId: user.userId }),
  ]);

  const activeRun = runs.find((r) => r.status === "in_progress" || r.status === "waiting") ?? null;
  const activeRunItems = activeRun ? await listCampaignRunItems(db, organizationId, activeRun.id) : [];

  const plannedBudget = budgetEntries.reduce((sum, b) => sum + (b.plannedAmount ? Number(b.plannedAmount) : 0), 0);
  const recordedSpend = budgetEntries.reduce((sum, b) => sum + (b.spendAmount ? Number(b.spendAmount) : 0), 0);

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={[{ label: "LYNQ", href: "/app" }, { label: organizationName, href: `/app/${organizationSlug}` }, { label: "Marketing", href: `/app/${organizationSlug}/marketing` }, { label: "Campaigns", href: `/app/${organizationSlug}/marketing/campaigns` }, { label: campaign.name }]} />

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-3xl italic font-light text-foreground">{campaign.name}</h1>
          <Badge tone={STATUS_TONE[campaign.status]}>{campaign.status}</Badge>
          <Badge tone={HEALTH_TONE[health.status]}>{health.status.replace(/_/g, " ")}</Badge>
        </div>
        <p className="text-sm text-muted">
          {campaign.campaignKey} · {campaign.objectiveType.replace(/_/g, " ")}
          {campaign.startDate ? ` · starts ${campaign.startDate.toLocaleDateString()}` : ""}
          {campaign.endDate ? ` · ends ${campaign.endDate.toLocaleDateString()}` : ""}
        </p>
        {health.reasons.length > 0 ? <p className="text-xs text-subtle">Health reasons: {health.reasons.map((r) => r.replace(/_/g, " ")).join(", ")}</p> : null}
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Lifecycle</h2>
        <div className="flex flex-wrap gap-2">
          <ActionForm action={transitionCampaignStatusAction.bind(null, organizationSlug, campaignId)} className="flex items-end gap-2">
            <SelectField label="Transition to" name="toStatus" options={MARKETING_CAMPAIGN_STATUSES.map((s) => ({ value: s, label: s }))} />
            <input type="hidden" name="expectedRevision" value={campaign.revision} />
            <SubmitButton>Transition</SubmitButton>
          </ActionForm>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Agents</h2>
        <div className="flex flex-wrap gap-2">
          <ActionForm action={launchCampaignBriefAction.bind(null, organizationSlug, campaignId)}>
            <SubmitButton variant="glass" pendingLabel="Assembling…">Launch Campaign Brief Assistant</SubmitButton>
          </ActionForm>
          <ActionForm action={launchCampaignSummaryAction.bind(null, organizationSlug, campaignId)}>
            <SubmitButton variant="glass" pendingLabel="Summarizing…">Launch Campaign Summary Assistant</SubmitButton>
          </ActionForm>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Playbook run</h2>
        {runs.length === 0 ? (
          <ActionForm action={startCampaignRunAction.bind(null, organizationSlug, campaignId)} className="flex items-end gap-2">
            <SelectField label="Playbook version" name="playbookVersionId" options={playbooks.filter((p) => p.currentPublishedVersionId).map((p) => ({ value: p.currentPublishedVersionId!, label: p.name }))} />
            <SubmitButton>Start run</SubmitButton>
          </ActionForm>
        ) : activeRun ? (
          <Card padding="md" className="flex flex-col gap-3">
            <Badge tone={activeRun.status === "waiting" ? "warning" : "info"}>{activeRun.status.replace(/_/g, " ")}</Badge>
            {activeRunItems.length === 0 ? (
              <EmptyState title="This playbook version has no steps." />
            ) : (
              <ul className="flex flex-col gap-2">
                {activeRunItems.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-2 last:border-b-0">
                    <div>
                      <p className="text-sm text-foreground">{item.step.name}</p>
                    </div>
                    {item.status === "pending" ? (
                      <div className="flex gap-2">
                        <ActionForm action={completeCampaignRunItemAction.bind(null, organizationSlug, campaignId, item.id)} hiddenFields={{ status: "complete" }}>
                          <SubmitButton>Complete</SubmitButton>
                        </ActionForm>
                        <ActionForm action={completeCampaignRunItemAction.bind(null, organizationSlug, campaignId, item.id)} hiddenFields={{ status: "skipped" }}>
                          <SubmitButton variant="glass">Skip</SubmitButton>
                        </ActionForm>
                      </div>
                    ) : (
                      <Badge tone={item.status === "complete" ? "success" : "neutral"}>{item.status}</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {activeRun.missingRequirements.length > 0 ? <p className="text-xs text-subtle">Missing: {activeRun.missingRequirements.join(", ")}</p> : null}
          </Card>
        ) : (
          <EmptyState title="No active run — most recent run finished." />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Content</h2>
          <Link href={`/app/${organizationSlug}/marketing/content?campaignId=${campaignId}`} className="lynq-transition text-xs text-subtle hover:text-foreground">
            View all →
          </Link>
        </div>
        {contentItems.length === 0 ? (
          <EmptyState title="No content items yet." />
        ) : (
          <ul className="flex flex-col gap-2">
            {contentItems.slice(0, 8).map((item) => (
              <Card as="li" key={item.id} padding="sm">
                <Link href={`/app/${organizationSlug}/marketing/content/${item.id}`} className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm text-foreground">{item.title}</span>
                  <Badge tone={CONTENT_STATUS_TONE[item.status]}>{item.status}</Badge>
                </Link>
              </Card>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Destinations / UTM</h2>
        <ActionForm action={createDestinationAction.bind(null, organizationSlug, campaignId)} className="grid gap-3 border border-border p-4 sm:grid-cols-2">
          <FormField label="Label" name="label" required />
          <FormField label="URL" name="url" required />
          <FormField label="utm_source" name="utmSource" required />
          <FormField label="utm_medium" name="utmMedium" required />
          <FormField label="utm_campaign" name="utmCampaign" required />
          <div className="sm:col-span-2">
            <SubmitButton>Add destination</SubmitButton>
          </div>
        </ActionForm>
        {destinations.length === 0 ? (
          <EmptyState title="No destinations configured yet." />
        ) : (
          <ul className="flex flex-col gap-2">
            {destinations.map((d) => (
              <Card as="li" key={d.id} padding="sm" className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-foreground">{d.label}</span>
                <span className="text-xs text-subtle">{d.utmSource} / {d.utmMedium} / {d.utmCampaign}</span>
              </Card>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xs uppercase tracking-[0.1em] text-subtle">Budget</h2>
        <p className="text-sm text-foreground">Planned: {plannedBudget.toLocaleString()} · Manually recorded spend: {recordedSpend.toLocaleString()}</p>
        <ActionForm action={createBudgetEntryAction.bind(null, organizationSlug, campaignId)} className="grid gap-3 border border-border p-4 sm:grid-cols-2">
          <FormField label="Category" name="category" hint="defaults to 'general'" />
          <FormField label="Currency" name="currency" required hint="e.g. USD" />
          <FormField label="Planned amount" name="plannedAmount" type="number" />
          <FormField label="Recorded spend" name="spendAmount" type="number" />
          <div className="sm:col-span-2">
            <SubmitButton>Add budget entry</SubmitButton>
          </div>
        </ActionForm>
      </section>
    </div>
  );
}
