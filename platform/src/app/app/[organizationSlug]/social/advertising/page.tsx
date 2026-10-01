import Link from "next/link";
import { listBrands } from "@/lib/social-os/brands";
import { getAdCommandCenter, type AdChangeRequestView } from "@/lib/social-os/advertising";
import { describeAiProviders, loadSocialAiEnv } from "@/lib/social-os/providers/ai/registry";
import { getSocialTimezone } from "@/lib/social-os/ui-queries";
import { listOrganizationMembers } from "@/lib/organizations/memberships";
import { hasMarketingCapability, resolveMarketingAuthContext } from "@/lib/marketing-os/authz";
import { SOCIAL_ORGANIC_PLATFORMS, SOCIAL_PLATFORM_LABELS, type SocialAdChangeStatus } from "@/lib/social-os/validation";
import {
  cancelAdChangeAction,
  decideAdChangeAction,
  generateAdRecommendationsAction,
  proposeAdChangeAction,
  requestMetricsSyncAction,
  submitAdChangeAction,
} from "@/lib/dashboard/actions/social";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { ConfirmDialog } from "@/components/dashboard/ConfirmDialog";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/Table";
import { SocialBrandSwitcher } from "@/components/social/SocialBrandSwitcher";
import { SocialActionForm } from "@/components/social/SocialActionForm";
import { CreativeConceptsPanel } from "@/components/social/CreativeConceptsPanel";
import { LabeledSelect, TextAreaField, TextField } from "@/components/social/fields";
import { SectionHeading, StatTile } from "@/components/social/parts";
import { loadSocialPageContext, renderSocialPageError, socialBreadcrumbs } from "@/components/social/page-context";
import { resolveBrandSelection } from "@/components/social/brand-selection";
import { ACCOUNT_STATUS_TONE, AD_CHANGE_STATUS_LABEL, AD_CHANGE_STATUS_TONE, CONNECTION_STATUS_LABEL, formatCount, formatDateTime, formatMinor, formatRate, humanize, socialHref } from "@/components/social/format";

export const dynamic = "force-dynamic";

const STATUS_GROUPS: { title: string; statuses: SocialAdChangeStatus[] }[] = [
  { title: "Awaiting approval", statuses: ["pending_approval"] },
  { title: "Proposed — not yet submitted", statuses: ["proposed"] },
  { title: "Approved and executing", statuses: ["approved", "executing"] },
  { title: "Failed", statuses: ["failed"] },
  { title: "Executed", statuses: ["executed"] },
  { title: "Rejected or cancelled", statuses: ["rejected", "cancelled"] },
];

const CHANGE_TYPE_LABEL: Record<string, string> = {
  create_campaign: "Create campaign (starts paused)",
  update_budget: "Change budget",
  pause_campaign: "Pause campaign",
  resume_campaign: "Resume campaign",
  update_targeting: "Change targeting",
  create_ad_set: "Create ad set",
  create_ad: "Create ad",
};

/** The exact change, in words — what an approver is agreeing to. */
function describeChange(c: AdChangeRequestView): string {
  const p = c.payload;
  const cur = typeof p.currency === "string" ? p.currency : c.currency;
  const money = (v: unknown) => (typeof v === "number" ? formatMinor(v, cur) : null);
  const campaign = c.externalCampaignId ?? (typeof p.externalCampaignId === "string" ? p.externalCampaignId : null);
  switch (c.changeType) {
    case "pause_campaign":
      return `Pause campaign ${campaign ?? "?"}.`;
    case "resume_campaign":
      return `Resume campaign ${campaign ?? "?"} — it will start spending again at its current budget.`;
    case "update_budget": {
      const parts = [money(p.dailyBudgetMinor) ? `daily budget → ${money(p.dailyBudgetMinor)}` : null, money(p.lifetimeBudgetMinor) ? `lifetime budget → ${money(p.lifetimeBudgetMinor)}` : null].filter(Boolean);
      return `Campaign ${campaign ?? "?"}: ${parts.join(", ") || "no budget given"}.`;
    }
    case "create_campaign":
      return `Create campaign “${String(p.name ?? "")}” (objective ${String(p.objective ?? "")})${money(p.dailyBudgetMinor) ? `, daily budget ${money(p.dailyBudgetMinor)}` : ""}${money(p.lifetimeBudgetMinor) ? `, lifetime budget ${money(p.lifetimeBudgetMinor)}` : ""}. It is created paused.`;
    default:
      return `${CHANGE_TYPE_LABEL[c.changeType] ?? humanize(c.changeType)}${campaign ? ` on campaign ${campaign}` : ""}: ${JSON.stringify(p).slice(0, 300)}`;
  }
}

export default async function SocialAdvertisingPage({ params, searchParams }: { params: Promise<{ organizationSlug: string }>; searchParams: Promise<{ brand?: string }> }) {
  const { organizationSlug } = await params;
  const sp = await searchParams;
  const { db, user, organization } = await loadSocialPageContext(organizationSlug, `/app/${organizationSlug}/social/advertising`);

  let data;
  try {
    const [brands, timeZone, ctx, providers, members] = await Promise.all([
      listBrands(db, { organizationId: organization.id, actorUserId: user.userId }),
      getSocialTimezone(db, organization.id),
      resolveMarketingAuthContext(db, { organizationId: organization.id, actorUserId: user.userId }),
      loadSocialAiEnv().then(describeAiProviders),
      listOrganizationMembers(db, organization.id, user.userId),
    ]);
    const selection = resolveBrandSelection(brands, sp.brand, true);
    const center = await getAdCommandCenter(db, { organizationId: organization.id, actorUserId: user.userId, brandProfileId: selection.brandProfileId });
    data = { brands, timeZone, ctx, providers, members, selection, center };
  } catch (err) {
    return renderSocialPageError(err, { organizationName: organization.name, organizationSlug, title: "Advertising" });
  }
  const { brands, timeZone, ctx, providers, members, selection, center } = data;
  const canManageAds = hasMarketingCapability(ctx, "marketing_manage_ads");
  const canApprove = hasMarketingCapability(ctx, "marketing_approve_ad_changes");
  const canGenerate = hasMarketingCapability(ctx, "marketing_generate_content");
  const canSync = hasMarketingCapability(ctx, "marketing_manage_connections");
  const textConfigured = providers.some((p) => p.kind === "text" && p.configured);
  const memberName = new Map(members.map((m) => [m.userId, m.name || m.email]));
  const { accounts, campaigns, totals, anomalies, changeRequests, dataNotes } = center;
  const connectedAds = accounts.filter((a) => a.connectionStatus === "connected");
  const proposable = accounts.filter((a) => !a.archivedAt);

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={socialBreadcrumbs(organization.name, organizationSlug, [{ label: "Advertising" }])} />
      <PageHeader
        title="Ad Command Center"
        description="Synced campaign results, anomalies, and every proposed change with its approval trail."
        actions={<SocialBrandSwitcher brands={brands.map((b) => ({ id: b.id, name: b.name }))} selectedBrandId={selection.selectedBrandId} />}
      />

      <p role="note" className="rounded-sm border border-info/30 bg-info-wash px-4 py-3 text-sm text-info">
        Nothing spends without an approval. Recommendations — from a person or the AI — are only proposals. A change reaches the ad platform only after someone with ad-approval rights approves it, and then it runs once; a failure is shown here, never retried silently.
      </p>

      {dataNotes.length ? (
        <ul className="flex flex-col gap-1.5">
          {dataNotes.map((note) => (
            <li key={note} className="rounded-sm border border-border px-3 py-2 text-xs text-muted">{note}</li>
          ))}
        </ul>
      ) : null}

      <section aria-labelledby="ads-accounts" className="flex flex-col gap-3">
        <SectionHeading id="ads-accounts" action={<Link href={socialHref(organizationSlug, "/social/connections", { brand: selection.brandParam })} className="text-xs text-muted hover:text-foreground">Connection Center →</Link>}>
          Ad accounts
        </SectionHeading>
        {accounts.length === 0 ? (
          <EmptyState title="No advertising account linked." description="Connect Meta Ads, Google Ads or LinkedIn Ads in the Connection Center to see campaigns here." />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {accounts.map((a) => (
              <li key={a.id}>
                <Card variant="surface" padding="sm" className="flex h-full flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-foreground">{a.displayName}</span>
                    <Badge>{a.platformLabel}</Badge>
                    <Badge tone={ACCOUNT_STATUS_TONE[a.connectionStatus] ?? "neutral"} dot>{CONNECTION_STATUS_LABEL[a.connectionStatus] ?? a.connectionStatus}</Badge>
                  </div>
                  <span className="text-xs text-subtle">{a.lastSyncAt ? `Last synced ${formatDateTime(a.lastSyncAt, timeZone)}` : "Never synced"}{a.brandName ? ` · ${a.brandName}` : ""}</span>
                  {a.lastErrorMessage && a.connectionStatus !== "connected" ? <p className="text-xs text-danger">{a.lastErrorMessage}</p> : null}
                  <div className="mt-auto flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap">
                    {canSync && a.connectionStatus === "connected" ? (
                      <SocialActionForm action={requestMetricsSyncAction.bind(null, organizationSlug, a.id)} className="flex flex-col gap-2 [&_button]:w-full sm:[&_button]:w-auto">
                        <SubmitButton variant="glass" pendingLabel="Queuing…">Sync campaigns</SubmitButton>
                      </SocialActionForm>
                    ) : null}
                    {canManageAds && textConfigured ? (
                      <SocialActionForm action={generateAdRecommendationsAction.bind(null, organizationSlug)} hiddenFields={{ channelAccountId: a.id }} className="flex flex-col gap-2 [&_button]:w-full sm:[&_button]:w-auto">
                        <SubmitButton variant="glass" pendingLabel="Analysing…">AI recommendations</SubmitButton>
                      </SocialActionForm>
                    ) : null}
                  </div>
                  {canManageAds && !textConfigured ? <p className="text-xs text-subtle">AI recommendations need an AI text provider.</p> : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {campaigns.length ? (
        <section aria-label="Paid totals" className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <StatTile label="Spend" value={formatMinor(totals.spendMinor, totals.currency)} detail={totals.currency ? undefined : "Mixed currencies"} />
          <StatTile label="Impressions" value={formatCount(totals.impressions)} />
          <StatTile label="Clicks" value={formatCount(totals.clicks)} />
          <StatTile label="CTR" value={formatRate(totals.ctr)} />
          <StatTile label="CPC" value={formatMinor(totals.cpc, totals.currency)} />
          <StatTile label="Conversions" value={formatCount(totals.conversions)} />
        </section>
      ) : null}

      <section aria-labelledby="ads-campaigns" className="flex flex-col gap-3">
        <SectionHeading id="ads-campaigns">Campaigns (latest synced window)</SectionHeading>
        {campaigns.length === 0 ? (
          <EmptyState title="No campaign data synced yet." description={connectedAds.length ? "Run a campaign sync on a connected ad account." : "Connect an ad account first — no campaign numbers are shown until they are synced."} />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Campaign</Th>
                <Th className="hidden md:table-cell">Budget</Th>
                <Th className="text-right">Spend</Th>
                <Th className="hidden text-right lg:table-cell">Impr.</Th>
                <Th className="hidden text-right lg:table-cell">Clicks</Th>
                <Th className="text-right">CTR</Th>
                <Th className="hidden text-right sm:table-cell">CPC</Th>
                <Th className="hidden text-right xl:table-cell">CPM</Th>
                <Th className="hidden text-right md:table-cell">Conv.</Th>
                <Th className="hidden text-right xl:table-cell">CPA</Th>
              </tr>
            </THead>
            <TBody>
              {campaigns.map((c) => (
                <Tr key={`${c.channelAccountId}-${c.externalCampaignId}`}>
                  <Td>
                    <div className="flex flex-col gap-1">
                      <span className="text-sm text-foreground">{c.name}</span>
                      <span className="flex flex-wrap items-center gap-1.5 text-xs text-subtle">
                        <Badge tone={/^(ACTIVE|ENABLED|RUNNING)$/i.test(c.status) ? "success" : "neutral"}>{c.status.toLowerCase().replace(/_/g, " ")}</Badge>
                        {SOCIAL_PLATFORM_LABELS[c.platform]} · id {c.externalCampaignId}
                      </span>
                    </div>
                  </Td>
                  <Td className="hidden text-xs text-muted md:table-cell">
                    {c.dailyBudgetMinor !== null ? `${formatMinor(c.dailyBudgetMinor, c.currency)}/day` : c.lifetimeBudgetMinor !== null ? `${formatMinor(c.lifetimeBudgetMinor, c.currency)} lifetime` : "—"}
                  </Td>
                  <Td className="text-right tabular-nums">{formatMinor(c.spendMinor, c.currency)}</Td>
                  <Td className="hidden text-right tabular-nums lg:table-cell">{formatCount(c.impressions)}</Td>
                  <Td className="hidden text-right tabular-nums lg:table-cell">{formatCount(c.clicks)}</Td>
                  <Td className="text-right tabular-nums">{formatRate(c.ctr)}</Td>
                  <Td className="hidden text-right tabular-nums sm:table-cell">{formatMinor(c.cpc, c.currency)}</Td>
                  <Td className="hidden text-right tabular-nums xl:table-cell">{formatMinor(c.cpm, c.currency)}</Td>
                  <Td className="hidden text-right tabular-nums md:table-cell">{formatCount(c.conversions)}</Td>
                  <Td className="hidden text-right tabular-nums xl:table-cell">{formatMinor(c.cpa, c.currency)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      <section aria-labelledby="ads-anomalies" className="flex flex-col gap-3">
        <SectionHeading id="ads-anomalies">Anomalies</SectionHeading>
        {anomalies.length === 0 ? (
          <p className="text-sm text-subtle">{campaigns.length ? "No anomalies in the synced data." : "Anomaly checks run once campaign data is synced."}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {anomalies.map((a) => (
              <li key={`${a.channelAccountId}-${a.campaignId}-${a.kind}`} className="flex flex-col gap-1 rounded-sm border border-warning/30 bg-warning-wash px-3 py-2 sm:flex-row sm:items-center sm:gap-3">
                <Badge tone="warning">{humanize(a.kind)}</Badge>
                <span className="text-sm text-warning">{a.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="ads-changes" className="flex flex-col gap-4">
        <SectionHeading id="ads-changes">Change requests</SectionHeading>
        {changeRequests.length === 0 ? (
          <EmptyState title="No proposed changes." description="Propose one below, or ask the AI for recommendations on an account with synced campaign data." />
        ) : (
          STATUS_GROUPS.map((group) => {
            const rows = changeRequests.filter((c) => group.statuses.includes(c.status));
            if (!rows.length) return null;
            return (
              <div key={group.title} className="flex flex-col gap-2">
                <h3 className="text-sm text-foreground">{group.title} <span className="text-subtle">({rows.length})</span></h3>
                <ul className="flex flex-col gap-2">
                  {rows.map((c) => (
                    <li key={c.id}>
                      <ChangeCard organizationSlug={organizationSlug} change={c} timeZone={timeZone} canManageAds={canManageAds} canApprove={canApprove} memberName={memberName} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </section>

      {canManageAds ? (
        <section aria-labelledby="ads-propose" className="flex flex-col gap-3">
          <SectionHeading id="ads-propose">Propose a change</SectionHeading>
          <Card>
            {proposable.length === 0 ? (
              <p className="text-sm text-subtle">Link an advertising account first.</p>
            ) : (
              <details>
                <summary className="flex min-h-11 cursor-pointer items-center text-sm text-foreground">New proposal — saved as a recommendation until it is submitted and approved</summary>
                <SocialActionForm action={proposeAdChangeAction.bind(null, organizationSlug)} className="flex flex-col gap-4 pt-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <LabeledSelect label="Ad account" name="channelAccountId" id="propose-account" options={proposable.map((a) => ({ value: a.id, label: `${a.displayName} · ${a.platformLabel}` }))} />
                    <LabeledSelect label="Change" name="changeType" id="propose-type" options={["update_budget", "pause_campaign", "resume_campaign", "create_campaign"].map((t) => ({ value: t, label: CHANGE_TYPE_LABEL[t] }))} />
                  </div>
                  <TextField label="Title" name="title" id="propose-title" required maxLength={200} placeholder="e.g. Raise budget on the spring promo" />
                  <TextAreaField label="Why" name="rationale" id="propose-rationale" rows={3} maxLength={4000} placeholder="The evidence for this change" />
                  <fieldset className="flex flex-col gap-4 rounded-md border border-border p-4">
                    <legend className="px-1 text-xs uppercase tracking-[0.1em] text-subtle">Budget, pause, resume</legend>
                    {campaigns.length ? (
                      <LabeledSelect label="Campaign" name="externalCampaignId" id="propose-campaign" options={[{ value: "", label: "Choose a synced campaign" }, ...campaigns.map((c) => ({ value: c.externalCampaignId, label: `${c.name} (${c.externalCampaignId})` }))]} />
                    ) : (
                      <TextField label="Campaign id" name="externalCampaignId" id="propose-campaign" maxLength={100} hint="No campaigns are synced yet — use the platform's campaign id." />
                    )}
                    <div className="grid gap-4 sm:grid-cols-3">
                      <TextField label="New daily budget" name="dailyBudget" id="propose-daily" type="number" placeholder="e.g. 25.00" hint="In dollars — stored in cents." />
                      <TextField label="New lifetime budget" name="lifetimeBudget" id="propose-lifetime" type="number" placeholder="e.g. 500.00" />
                      <TextField label="Currency" name="currency" id="propose-currency" maxLength={3} placeholder="CAD" />
                    </div>
                  </fieldset>
                  <fieldset className="flex flex-col gap-4 rounded-md border border-border p-4">
                    <legend className="px-1 text-xs uppercase tracking-[0.1em] text-subtle">Create campaign (always starts paused)</legend>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <TextField label="Campaign name" name="name" id="propose-name" maxLength={200} />
                      <TextField label="Objective" name="objective" id="propose-objective" maxLength={60} placeholder="e.g. OUTCOME_LEADS" />
                    </div>
                    <p className="text-xs text-subtle">Uses the daily/lifetime budget and currency above.</p>
                  </fieldset>
                  <TextField label="Estimated daily spend (optional)" name="estimatedDailySpend" id="propose-estimate" type="number" hint="Shown to the approver. Defaults to the new daily budget." />
                  <div className="[&_button]:w-full sm:[&_button]:w-auto">
                    <SubmitButton pendingLabel="Saving…">Save proposal</SubmitButton>
                  </div>
                </SocialActionForm>
              </details>
            )}
          </Card>
        </section>
      ) : null}

      <section aria-labelledby="ads-creative" className="flex flex-col gap-3">
        <SectionHeading id="ads-creative">Creative concepts</SectionHeading>
        <Card>
          {!canGenerate ? (
            <p className="text-sm text-subtle">Generating ad concepts needs a marketing contributor role or higher.</p>
          ) : !textConfigured ? (
            <p className="text-sm text-subtle">No AI text provider is configured on this server, so no concepts can be generated.</p>
          ) : !selection.brandProfileId ? (
            <p className="text-sm text-subtle">Choose a brand to write concepts in its voice.</p>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-subtle">Recommendation only — concepts are shown here for you to use; nothing is saved as an ad or sent to a platform.</p>
              <CreativeConceptsPanel organizationId={organization.id} brandProfileId={selection.brandProfileId} platforms={[...SOCIAL_ORGANIC_PLATFORMS.filter((p) => p === "facebook" || p === "instagram" || p === "linkedin"), "meta_ads" as const, "google_ads" as const, "linkedin_ads" as const].map((p) => ({ value: p, label: SOCIAL_PLATFORM_LABELS[p] }))} />
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}

function ChangeCard({ organizationSlug, change: c, timeZone, canManageAds, canApprove, memberName }: { organizationSlug: string; change: AdChangeRequestView; timeZone: string; canManageAds: boolean; canApprove: boolean; memberName: Map<string, string> }) {
  const rev = String(c.revision);
  const bound = <A extends unknown[], R>(fn: (slug: string, id: string, ...rest: A) => R) => fn.bind(null, organizationSlug, c.id) as (...rest: A) => R;
  const executed = c.status === "executed";
  const externalIds = c.externalResult.externalIds && typeof c.externalResult.externalIds === "object" ? Object.entries(c.externalResult.externalIds as Record<string, unknown>) : [];
  const summary = describeChange(c);
  const estimate = c.estimatedDailySpendMinor !== null ? `${formatMinor(c.estimatedDailySpendMinor, c.currency)} per day (estimate)` : "No spend estimate given";
  const proposer = c.generationId || c.proposedByAgentId ? "AI recommendation" : c.proposedByUserId ? `Proposed by ${memberName.get(c.proposedByUserId) ?? "a former member"}` : "Proposed";

  return (
    <Card variant="surface" padding="sm" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={executed ? "success" : "neutral"}>{executed ? "Execution" : "Recommendation"}</Badge>
        <Badge tone={AD_CHANGE_STATUS_TONE[c.status] ?? "neutral"} dot>{AD_CHANGE_STATUS_LABEL[c.status] ?? c.status}</Badge>
        <span className="text-sm text-foreground">{c.title}</span>
      </div>
      <p className="text-sm text-foreground">{summary}</p>
      <p className="text-xs text-subtle">
        {CHANGE_TYPE_LABEL[c.changeType] ?? humanize(c.changeType)} · {c.accountDisplayName ?? "Ad account"} · {estimate} · {proposer} {formatDateTime(c.createdAt, timeZone)}
      </p>
      {c.rationale ? <p className="whitespace-pre-wrap text-sm text-muted">{c.rationale}</p> : null}
      {c.approvedAt ? <p className="text-xs text-subtle">Approved {formatDateTime(c.approvedAt, timeZone)}{c.approvedByUserId ? ` by ${memberName.get(c.approvedByUserId) ?? "a former member"}` : ""}.</p> : null}
      {c.decisionNote ? <p className="text-xs text-subtle">Decision note: {c.decisionNote}</p> : null}
      {executed ? (
        <div className="rounded-sm border border-success/30 bg-success-wash px-3 py-2 text-xs text-success">
          Executed {formatDateTime(c.executedAt, timeZone)}.
          {typeof c.externalResult.summary === "string" ? ` ${c.externalResult.summary}` : ""}
          {externalIds.length ? <span className="mt-1 block">Platform ids: {externalIds.map(([k, v]) => `${k} ${String(v)}`).join(" · ")}</span> : null}
        </div>
      ) : null}
      {c.status === "failed" ? <p className="rounded-sm border border-danger/30 bg-danger-wash px-3 py-2 text-xs text-danger">Not executed{c.lastErrorMessage ? `: ${c.lastErrorMessage}` : "."} Nothing is retried automatically — propose it again if it still makes sense.</p> : null}
      {c.status === "approved" || c.status === "executing" ? <p role="status" className="text-xs text-info">Approved — waiting for the worker to apply it on the platform.</p> : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap [&>button]:w-full sm:[&>button]:w-auto">
        {c.status === "proposed" && canManageAds ? (
          <SocialActionForm action={bound(submitAdChangeAction)} hiddenFields={{ expectedRevision: rev }} className="flex flex-col gap-2 [&_button]:w-full sm:[&_button]:w-auto">
            <SubmitButton pendingLabel="Submitting…">Submit for approval</SubmitButton>
          </SocialActionForm>
        ) : null}
        {c.status === "pending_approval" && canApprove ? (
          <>
            <ConfirmDialog
              triggerLabel="Approve"
              title="Approve this ad change?"
              description={`${summary} ${estimate}. Approving sends this exact change to ${c.accountDisplayName ?? "the ad account"} once${c.changeType === "pause_campaign" ? " — the campaign stops delivering." : " — it may start spending money."}`}
              confirmLabel="Approve and execute"
              formAction={bound(decideAdChangeAction)}
              hiddenFields={{ expectedRevision: rev, decision: "approve" }}
            />
            <ConfirmDialog triggerLabel="Reject" triggerVariant="danger" variant="danger" title="Reject this ad change?" description={`${summary} Nothing will change on the platform.`} confirmLabel="Reject" formAction={bound(decideAdChangeAction)} hiddenFields={{ expectedRevision: rev, decision: "reject" }} />
          </>
        ) : null}
        {c.status === "pending_approval" && !canApprove ? <p className="text-xs text-subtle">Waiting for someone with ad-approval rights.</p> : null}
        {(c.status === "proposed" || c.status === "pending_approval") && canManageAds ? (
          <ConfirmDialog triggerLabel="Cancel" triggerVariant="subtle" title="Cancel this proposal?" description="It will not be executed. Any open approval request is closed." confirmLabel="Cancel proposal" formAction={bound(cancelAdChangeAction)} hiddenFields={{ expectedRevision: rev }} />
        ) : null}
      </div>
    </Card>
  );
}
