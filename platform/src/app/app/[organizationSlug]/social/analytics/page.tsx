import Link from "next/link";
import { listBrands } from "@/lib/social-os/brands";
import { describeConnectionCenter } from "@/lib/social-os/connections";
import { getSocialAnalytics, type AnalyticsGroup, type AnalyticsPost } from "@/lib/social-os/analytics";
import { getSocialTimezone, listPublishedSocialContent } from "@/lib/social-os/ui-queries";
import { hasMarketingCapability, resolveMarketingAuthContext } from "@/lib/marketing-os/authz";
import { requestMetricsSyncAction } from "@/lib/dashboard/actions/social";
import { recordMarketingPerformanceAction } from "@/lib/dashboard/actions/marketing";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { ActionForm } from "@/components/dashboard/ActionForm";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/Table";
import { SocialBrandSwitcher } from "@/components/social/SocialBrandSwitcher";
import { SocialActionForm } from "@/components/social/SocialActionForm";
import { LabeledSelect, TextAreaField, TextField } from "@/components/social/fields";
import { Meter, SectionHeading } from "@/components/social/parts";
import { loadSocialPageContext, renderSocialPageError, socialBreadcrumbs } from "@/components/social/page-context";
import { firstParam, resolveBrandSelection } from "@/components/social/brand-selection";
import { ACCOUNT_STATUS_TONE, CONNECTION_STATUS_LABEL, PLATFORM_SHORT_LABEL, formatChange, formatCount, formatDateTime, formatMinor, formatRate, formatShortDate, humanize, socialHref } from "@/components/social/format";

export const dynamic = "force-dynamic";

const RANGES = [7, 30, 90] as const;
const SORTS = { published: "Newest", reach: "Reach", impressions: "Impressions", views: "Views", engagements: "Engagements", rate: "Engagement rate", clicks: "Clicks" } as const;
type SortKey = keyof typeof SORTS;

function sortPosts(posts: AnalyticsPost[], sort: SortKey): AnalyticsPost[] {
  if (sort === "published") return posts;
  const pick = (p: AnalyticsPost): number | null => (sort === "rate" ? p.engagementRate : p[sort]);
  // Unknown values always sort last — never treated as 0.
  return [...posts].sort((a, b) => {
    const x = pick(a);
    const y = pick(b);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return y - x;
  });
}

export default async function SocialAnalyticsPage({ params, searchParams }: { params: Promise<{ organizationSlug: string }>; searchParams: Promise<{ brand?: string; days?: string; sort?: string }> }) {
  const { organizationSlug } = await params;
  const sp = await searchParams;
  const { db, user, organization } = await loadSocialPageContext(organizationSlug, `/app/${organizationSlug}/social/analytics`);
  const daysRaw = Number(firstParam(sp.days));
  const days = (RANGES as readonly number[]).includes(daysRaw) ? daysRaw : 30;
  const sortRaw = firstParam(sp.sort) ?? "published";
  const sort: SortKey = sortRaw in SORTS ? (sortRaw as SortKey) : "published";

  let data;
  try {
    const [brands, timeZone, ctx, center] = await Promise.all([
      listBrands(db, { organizationId: organization.id, actorUserId: user.userId }),
      getSocialTimezone(db, organization.id),
      resolveMarketingAuthContext(db, { organizationId: organization.id, actorUserId: user.userId }),
      describeConnectionCenter(db, { organizationId: organization.id, actorUserId: user.userId }),
    ]);
    const selection = resolveBrandSelection(brands, sp.brand, true);
    const [analytics, published] = await Promise.all([
      getSocialAnalytics(db, { organizationId: organization.id, actorUserId: user.userId, brandProfileId: selection.brandProfileId, days }),
      listPublishedSocialContent(db, { organizationId: organization.id, actorUserId: user.userId, brandProfileId: selection.brandProfileId, limit: 100 }),
    ]);
    data = { brands, timeZone, ctx, center, selection, analytics, published };
  } catch (err) {
    return renderSocialPageError(err, { organizationName: organization.name, organizationSlug, title: "Analytics" });
  }
  const { brands, timeZone, ctx, center, selection, analytics, published } = data;
  const canSync = hasMarketingCapability(ctx, "marketing_manage_connections");
  const canRecord = hasMarketingCapability(ctx, "marketing_manage_content");
  const href = (extra: Record<string, string | undefined> = {}) => socialHref(organizationSlug, "/social/analytics", { brand: selection.brandParam, days: String(days), sort: sort === "published" ? undefined : sort, ...extra });
  const accountView = new Map(center.accounts.map((a) => [a.id, a]));
  const syncable = analytics.accounts.filter((a) => a.connectionStatus === "connected" && accountView.get(a.accountId)?.canReadInsights);
  const posts = sortPosts(analytics.posts, sort);
  const scopeAccounts = center.accounts.filter((a) => !selection.brandProfileId || a.brandProfileId === selection.brandProfileId);
  const { paid, organicVsPaid } = analytics;

  return (
    <div className="flex flex-col gap-8 px-6 py-8 md:px-10">
      <Breadcrumbs items={socialBreadcrumbs(organization.name, organizationSlug, [{ label: "Analytics" }])} />
      <PageHeader
        title="Analytics"
        description="Every number comes from a synced or manually recorded snapshot. A dash means no data — never zero."
        actions={<SocialBrandSwitcher brands={brands.map((b) => ({ id: b.id, name: b.name }))} selectedBrandId={selection.selectedBrandId} />}
      />

      <nav aria-label="Date range" className="-mx-1 overflow-x-auto">
        <ul className="flex gap-2 px-1">
          {RANGES.map((r) => (
            <li key={r} className="shrink-0">
              <Link href={href({ days: String(r) })} aria-current={r === days ? "page" : undefined} className={`lynq-transition inline-flex min-h-11 items-center rounded-sm border px-3 text-xs font-medium uppercase tracking-[0.08em] ${r === days ? "border-border-strong bg-glass-strong text-foreground" : "border-border text-subtle hover:text-foreground"}`}>
                Last {r} days
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <section aria-labelledby="analytics-availability" className="flex flex-col gap-3">
        <SectionHeading id="analytics-availability">Data availability</SectionHeading>
        <Card className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <span className="text-[0.65rem] uppercase tracking-[0.12em] text-subtle">Connected accounts</span>
              <span className="text-2xl text-foreground">{analytics.availability.connectedAccounts}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[0.65rem] uppercase tracking-[0.12em] text-subtle">With synced data</span>
              <span className="text-2xl text-foreground">{analytics.availability.syncedAccounts}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[0.65rem] uppercase tracking-[0.12em] text-subtle">Last sync</span>
              <span className="text-sm text-foreground">{analytics.availability.lastSyncAt ? formatDateTime(analytics.availability.lastSyncAt, timeZone) : "Never"}</span>
            </div>
          </div>
          <p className="text-sm text-muted">{analytics.availability.note}</p>
          {analytics.dataNotes.length ? (
            <ul className="flex flex-col gap-1.5">
              {analytics.dataNotes.map((note) => (
                <li key={note} className="rounded-sm border border-border px-3 py-2 text-xs text-muted">{note}</li>
              ))}
            </ul>
          ) : null}
          {canSync && syncable.length ? (
            <div className="flex flex-col gap-2">
              <span className="text-xs uppercase tracking-[0.1em] text-subtle">Sync metrics now</span>
              <ul className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {syncable.map((a) => (
                  <li key={a.accountId}>
                    <SocialActionForm action={requestMetricsSyncAction.bind(null, organizationSlug, a.accountId)} className="flex flex-col gap-2 [&_button]:w-full sm:[&_button]:w-auto">
                      <SubmitButton variant="glass" pendingLabel="Queuing…">{`${PLATFORM_SHORT_LABEL[a.platform] ?? a.platformLabel} · ${a.displayName}`}</SubmitButton>
                    </SocialActionForm>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      </section>

      <section aria-labelledby="analytics-accounts" className="flex flex-col gap-3">
        <SectionHeading id="analytics-accounts">Accounts</SectionHeading>
        {analytics.accounts.length === 0 ? (
          <EmptyState title="No accounts in scope." description="Add or connect an account in the Connection Center to see account-level results." />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Account</Th>
                <Th className="text-right">Followers</Th>
                <Th className="hidden text-right sm:table-cell">Change</Th>
                <Th className="text-right">Reach</Th>
                <Th className="hidden text-right md:table-cell">Impressions</Th>
                <Th className="hidden text-right md:table-cell">Views</Th>
                <Th className="hidden text-right lg:table-cell">Engagements</Th>
                <Th className="hidden text-right lg:table-cell">Clicks</Th>
              </tr>
            </THead>
            <TBody>
              {analytics.accounts.map((a) => (
                <Tr key={a.accountId}>
                  <Td>
                    <div className="flex flex-col gap-1">
                      <span className="text-sm text-foreground">{a.displayName}</span>
                      <span className="flex flex-wrap items-center gap-1.5 text-xs text-subtle">
                        {a.platformLabel}
                        <Badge tone={ACCOUNT_STATUS_TONE[a.connectionStatus] ?? "neutral"}>{CONNECTION_STATUS_LABEL[a.connectionStatus] ?? a.connectionStatus}</Badge>
                      </span>
                      <span className="text-[0.7rem] text-subtle">{a.coveredFrom && a.coveredTo ? `Covers ${formatShortDate(a.coveredFrom, timeZone)} – ${formatShortDate(a.coveredTo, timeZone)}` : "No account data in this range"}</span>
                    </div>
                  </Td>
                  <Td className="text-right tabular-nums">{formatCount(a.followers)}</Td>
                  <Td className="hidden text-right tabular-nums sm:table-cell">{formatChange(a.followersChange)}</Td>
                  <Td className="text-right tabular-nums">{formatCount(a.reach)}</Td>
                  <Td className="hidden text-right tabular-nums md:table-cell">{formatCount(a.impressions)}</Td>
                  <Td className="hidden text-right tabular-nums md:table-cell">{formatCount(a.views)}</Td>
                  <Td className="hidden text-right tabular-nums lg:table-cell">{formatCount(a.engagements)}</Td>
                  <Td className="hidden text-right tabular-nums lg:table-cell">{formatCount(a.websiteClicks)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      <section aria-labelledby="analytics-top" className="flex flex-col gap-3">
        <SectionHeading id="analytics-top">Top posts</SectionHeading>
        {analytics.topPosts.length === 0 ? (
          <EmptyState title="No post has an engagement rate yet." description="A rate needs reach plus at least one interaction counter, synced or recorded." />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {analytics.topPosts.slice(0, 6).map((p, i) => (
              <li key={p.variantId}>
                <Card as={Link} href={socialHref(organizationSlug, `/social/library/${p.contentItemId}`, { brand: selection.brandParam, variant: p.variantId })} interactive padding="sm" className="flex h-full flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-subtle">#{i + 1} · {PLATFORM_SHORT_LABEL[p.platform] ?? p.platform}</span>
                    <Badge tone={p.source === "synced" ? "success" : "neutral"}>{p.source ?? "no data"}</Badge>
                  </div>
                  <span className="text-sm text-foreground">{p.title}</span>
                  <span className="text-2xl text-foreground">{formatRate(p.engagementRate)}</span>
                  <span className="text-xs text-subtle">engagement rate · reach {formatCount(p.reach)} · {formatCount(p.engagements)} engagements</span>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="analytics-posts" className="flex flex-col gap-3">
        <SectionHeading
          id="analytics-posts"
          action={
            <nav aria-label="Sort posts" className="-mx-1 max-w-full overflow-x-auto">
              <ul className="flex gap-1 px-1">
                {(Object.keys(SORTS) as SortKey[]).map((k) => (
                  <li key={k} className="shrink-0">
                    <Link href={href({ sort: k === "published" ? undefined : k })} aria-current={k === sort ? "true" : undefined} className={`inline-flex min-h-11 items-center rounded-sm px-2 text-xs ${k === sort ? "text-foreground underline underline-offset-4" : "text-subtle hover:text-foreground"}`}>
                      {SORTS[k]}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          }
        >
          Published posts ({analytics.posts.length})
        </SectionHeading>
        {posts.length === 0 ? (
          <EmptyState title={`Nothing was published in the last ${days} days.`} description="Posts published through LYNQ appear here with their synced or recorded results." />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Post</Th>
                <Th className="text-right">Reach</Th>
                <Th className="hidden text-right md:table-cell">Impressions</Th>
                <Th className="hidden text-right lg:table-cell">Views</Th>
                <Th className="hidden text-right sm:table-cell">Engagements</Th>
                <Th className="text-right">Rate</Th>
                <Th className="hidden text-right lg:table-cell">Clicks</Th>
              </tr>
            </THead>
            <TBody>
              {posts.map((p) => (
                <Tr key={p.variantId}>
                  <Td>
                    <Link href={socialHref(organizationSlug, `/social/library/${p.contentItemId}`, { brand: selection.brandParam, variant: p.variantId })} className="flex min-h-11 flex-col justify-center hover:underline">
                      <span className="text-sm text-foreground">{p.title}</span>
                      <span className="text-xs text-subtle">
                        {PLATFORM_SHORT_LABEL[p.platform] ?? p.platform} · {humanize(p.format)} · {formatDateTime(p.publishedAt, timeZone)}
                        {p.source ? ` · ${p.source}` : " · no results yet"}
                      </span>
                    </Link>
                  </Td>
                  <Td className="text-right tabular-nums">{formatCount(p.reach)}</Td>
                  <Td className="hidden text-right tabular-nums md:table-cell">{formatCount(p.impressions)}</Td>
                  <Td className="hidden text-right tabular-nums lg:table-cell">{formatCount(p.views)}</Td>
                  <Td className="hidden text-right tabular-nums sm:table-cell">{formatCount(p.engagements)}</Td>
                  <Td className="text-right tabular-nums">{formatRate(p.engagementRate)}</Td>
                  <Td className="hidden text-right tabular-nums lg:table-cell">{formatCount(p.clicks)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      {analytics.posts.length ? (
        <div className="grid gap-6 xl:grid-cols-3">
          <Breakdown id="by-platform" title="By platform" groups={analytics.byPlatform} />
          <Breakdown id="by-format" title="By format" groups={analytics.byFormat} />
          <Breakdown id="by-campaign" title="By campaign" groups={analytics.byCampaign} />
        </div>
      ) : null}

      <section aria-labelledby="analytics-paid" className="flex flex-col gap-3">
        <SectionHeading id="analytics-paid" action={<Link href={socialHref(organizationSlug, "/social/advertising", { brand: selection.brandParam })} className="text-xs text-muted hover:text-foreground">Ad Command Center →</Link>}>
          Paid and organic
        </SectionHeading>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="flex flex-col gap-3">
            <h3 className="text-sm text-foreground">Paid summary</h3>
            {!paid ? (
              <p className="text-sm text-subtle">No ad campaign data was synced for this period.</p>
            ) : (
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <Stat label="Spend" value={formatMinor(paid.spendMinor, paid.currency)} />
                <Stat label="Impressions" value={formatCount(paid.impressions)} />
                <Stat label="Clicks" value={formatCount(paid.clicks)} />
                <Stat label="Conversions" value={formatCount(paid.conversions)} />
                <Stat label="CTR" value={formatRate(paid.ctr)} />
                <Stat label="CPC" value={formatMinor(paid.cpc, paid.currency)} />
                <Stat label="CPM" value={formatMinor(paid.cpm, paid.currency)} />
                <Stat label="CPA" value={formatMinor(paid.cpa, paid.currency)} />
              </dl>
            )}
            {paid ? <p className="text-xs text-subtle">{paid.campaigns} campaign{paid.campaigns === 1 ? "" : "s"}, latest synced window each.</p> : null}
          </Card>
          <Card className="flex flex-col gap-3">
            <h3 className="text-sm text-foreground">Organic vs paid</h3>
            <OrganicPaidRow label="Reach" organic={organicVsPaid.organicReach} paid={organicVsPaid.paidReach} />
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Stat label="Organic engagements" value={formatCount(organicVsPaid.organicEngagements)} />
              <Stat label="Paid clicks" value={formatCount(organicVsPaid.paidClicks)} />
            </dl>
          </Card>
        </div>
      </section>

      {canRecord ? (
        <section aria-labelledby="analytics-manual" className="flex flex-col gap-3">
          <SectionHeading id="analytics-manual">Record results manually</SectionHeading>
          <Card>
            <details>
              <summary className="flex min-h-11 cursor-pointer items-center text-sm text-foreground">For accounts that cannot sync (TikTok, YouTube, X, manual accounts) or older posts</summary>
              {published.length === 0 || scopeAccounts.length === 0 ? (
                <p className="pt-3 text-sm text-subtle">{published.length === 0 ? "No published posts to record results for." : "Add an account for this brand first."}</p>
              ) : (
                <ActionForm action={recordMarketingPerformanceAction.bind(null, organizationSlug)} className="flex flex-col gap-4 pt-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <LabeledSelect label="Post" name="contentItemId" id="manual-content" options={dedupeByItem(published).map((p) => ({ value: p.contentItemId, label: `${p.title} · ${p.platformLabel}${p.publishedAt ? ` · ${formatShortDate(p.publishedAt, timeZone)}` : ""}` }))} />
                    <LabeledSelect label="Account" name="channelAccountId" id="manual-account" options={scopeAccounts.map((a) => ({ value: a.id, label: `${a.displayName} · ${a.platformLabel}` }))} hint="Pick the account the post went out on — results count for that platform version." />
                  </div>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    {(["impressions", "reach", "views", "likes", "comments", "shares", "saves", "clicks"] as const).map((k) => (
                      <TextField key={k} label={humanize(k)} name={k} id={`manual-${k}`} type="number" placeholder="0" />
                    ))}
                  </div>
                  <TextAreaField label="Notes" name="notes" id="manual-notes" rows={2} maxLength={1000} />
                  <p className="text-xs text-subtle">Empty boxes are saved as 0 for a manual entry — fill in every counter you have.</p>
                  <div className="[&_button]:w-full sm:[&_button]:w-auto">
                    <SubmitButton variant="glass" pendingLabel="Saving…">Record results</SubmitButton>
                  </div>
                </ActionForm>
              )}
            </details>
          </Card>
        </section>
      ) : null}
    </div>
  );
}

function dedupeByItem<T extends { contentItemId: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.contentItemId) ? false : (seen.add(r.contentItemId), true)));
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[0.65rem] uppercase tracking-[0.12em] text-subtle">{label}</dt>
      <dd className="tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function OrganicPaidRow({ label, organic, paid }: { label: string; organic: number | null; paid: number | null }) {
  const total = organic !== null && paid !== null ? organic + paid : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Stat label={`Organic ${label.toLowerCase()}`} value={formatCount(organic)} />
        <Stat label={`Paid ${label.toLowerCase()}`} value={formatCount(paid)} />
      </div>
      {total !== null && total > 0 ? (
        <div className="flex flex-col gap-1">
          <Meter value={organic} total={total} label="Organic share of reach" />
          <span className="text-xs text-subtle">{formatRate(organic! / total, 0)} organic</span>
        </div>
      ) : (
        <p className="text-xs text-subtle">A split needs both organic and paid reach.</p>
      )}
    </div>
  );
}

function Breakdown({ id, title, groups }: { id: string; title: string; groups: AnalyticsGroup[] }) {
  const reachTotal = groups.reduce<number | null>((sum, g) => (g.reach === null ? sum : (sum ?? 0) + g.reach), null);
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <SectionHeading id={id}>{title}</SectionHeading>
      <Table>
        <THead>
          <tr>
            <Th>Group</Th>
            <Th className="text-right">Posts</Th>
            <Th className="text-right">Reach</Th>
            <Th className="text-right">Avg rate</Th>
          </tr>
        </THead>
        <TBody>
          {groups.map((g) => (
            <Tr key={g.key}>
              <Td>
                <div className="flex flex-col gap-1">
                  <span className="text-sm capitalize text-foreground">{g.label}</span>
                  <Meter value={g.reach} total={reachTotal} label={`${g.label} share of reach`} />
                </div>
              </Td>
              <Td className="text-right tabular-nums">
                {g.posts}
                {g.postsWithData < g.posts ? <span className="block text-[0.7rem] text-subtle">{g.postsWithData} with data</span> : null}
              </Td>
              <Td className="text-right tabular-nums">{formatCount(g.reach)}</Td>
              <Td className="text-right tabular-nums">{formatRate(g.avgEngagementRate)}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </section>
  );
}
