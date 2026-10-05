import "server-only";
import { and, desc, eq, gte, inArray, isNull, or } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingCampaigns, marketingChannelAccounts, marketingContentItems, marketingContentPerformanceSnapshots, socialAccountMetricSnapshots, socialContentVariants } from "@/db/schema";
import { resolveMarketingAuthContext, requireMarketingViewAuthority } from "@/lib/marketing-os/authz";
import { computeAdTotals, latestPerCampaign, loadAdCampaignSnapshots } from "./advertising";
import { SOCIAL_PLATFORM_LABELS, SOCIAL_PLATFORM_PROVIDER, isAdPlatform, socialPlatformSchema, type SocialPlatform } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;
type PerfRow = typeof marketingContentPerformanceSnapshots.$inferSelect;
type AccountSnapRow = typeof socialAccountMetricSnapshots.$inferSelect;

/**
 * Module 19 — the Analytics screen's read model. Every number comes from a
 * stored snapshot (provider-synced or manually recorded); "no data" is
 * `null`, never 0. Synced post snapshots only count the counters the
 * provider returned (`extraMetrics.provided`); manual snapshots count every
 * counter a human typed in.
 *
 * Account-level snapshots are rolling provider windows (e.g. the last 28
 * days, upserted daily), so summing every snapshot would double count —
 * totals sum only non-overlapping windows, newest first.
 *
 * Manual performance entry is NOT duplicated here: use
 * `recordPerformanceSnapshot` from `@/lib/marketing-os/command-center`.
 */

const DAY_MS = 24 * 3600 * 1000;
const POST_COUNTERS = ["impressions", "reach", "views", "likes", "comments", "shares", "saves", "clicks"] as const;
type PostCounter = (typeof POST_COUNTERS)[number];

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function sumNullable(values: (number | null | undefined)[]): number | null {
  let total: number | null = null;
  for (const v of values) if (typeof v === "number" && Number.isFinite(v)) total = (total ?? 0) + v;
  return total;
}

export type PostCounters = Record<PostCounter, number | null>;

/** The counters a snapshot actually carries: manual → every column; synced → only `extraMetrics.provided` keys. Pure. */
export function postCountersFromSnapshot(row: Pick<PerfRow, PostCounter | "source" | "extraMetrics">): PostCounters {
  const out = {} as PostCounters;
  if (!row.source.startsWith("synced:")) {
    for (const k of POST_COUNTERS) out[k] = row[k];
    return out;
  }
  const extra = row.extraMetrics && typeof row.extraMetrics === "object" ? (row.extraMetrics as Record<string, unknown>) : {};
  const provided = extra.provided && typeof extra.provided === "object" ? (extra.provided as Record<string, unknown>) : {};
  for (const k of POST_COUNTERS) {
    const v = provided[k];
    out[k] = typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  return out;
}

/** (likes + comments + shares + saves) / reach — null unless reach > 0 and at least one interaction counter is known. Pure. */
export function engagementRate(c: Pick<PostCounters, "likes" | "comments" | "shares" | "saves" | "reach">): number | null {
  if (c.reach === null || c.reach <= 0) return null;
  const interactions = sumNullable([c.likes, c.comments, c.shares, c.saves]);
  if (interactions === null) return null;
  return Math.round((interactions / c.reach) * 10000) / 10000;
}

export function engagementsOf(c: Pick<PostCounters, "likes" | "comments" | "shares" | "saves">): number | null {
  return sumNullable([c.likes, c.comments, c.shares, c.saves]);
}

export interface PeriodSnapshot {
  periodStart: Date;
  periodEnd: Date;
  capturedAt: Date;
}

/** Newest-first greedy pick of non-overlapping reporting windows ending after `from`. Pure. */
export function pickDisjointPeriods<T extends PeriodSnapshot>(snapshots: T[], from: Date): T[] {
  const sorted = [...snapshots].filter((s) => s.periodEnd.getTime() > from.getTime()).sort((a, b) => b.periodEnd.getTime() - a.periodEnd.getTime() || b.capturedAt.getTime() - a.capturedAt.getTime());
  const picked: T[] = [];
  let boundary = Number.POSITIVE_INFINITY;
  for (const s of sorted) {
    if (s.periodEnd.getTime() <= boundary) {
      picked.push(s);
      boundary = s.periodStart.getTime();
    }
  }
  return picked;
}

export interface AnalyticsPost extends PostCounters {
  variantId: string;
  contentItemId: string;
  title: string;
  platform: SocialPlatform;
  format: string;
  campaignId: string;
  campaignName: string | null;
  channelAccountId: string | null;
  publishedAt: Date | null;
  externalPostUrl: string | null;
  engagements: number | null;
  engagementRate: number | null;
  source: "synced" | "manual" | null;
  capturedAt: Date | null;
}

export interface AnalyticsGroup {
  key: string;
  label: string;
  posts: number;
  postsWithData: number;
  impressions: number | null;
  reach: number | null;
  views: number | null;
  engagements: number | null;
  clicks: number | null;
  /** Mean of the posts' own engagement rates (posts without a rate excluded); null when none. */
  avgEngagementRate: number | null;
}

/** Groups posts by a key, null-safe. Pure. */
export function groupPosts(posts: AnalyticsPost[], keyOf: (p: AnalyticsPost) => { key: string; label: string }): AnalyticsGroup[] {
  const groups = new Map<string, { label: string; posts: AnalyticsPost[] }>();
  for (const p of posts) {
    const { key, label } = keyOf(p);
    const g = groups.get(key) ?? { label, posts: [] };
    g.posts.push(p);
    groups.set(key, g);
  }
  return [...groups.entries()]
    .map(([key, g]) => {
      const rates = g.posts.map((p) => p.engagementRate).filter((r): r is number => r !== null);
      return {
        key,
        label: g.label,
        posts: g.posts.length,
        postsWithData: g.posts.filter((p) => p.source !== null).length,
        impressions: sumNullable(g.posts.map((p) => p.impressions)),
        reach: sumNullable(g.posts.map((p) => p.reach)),
        views: sumNullable(g.posts.map((p) => p.views)),
        engagements: sumNullable(g.posts.map((p) => p.engagements)),
        clicks: sumNullable(g.posts.map((p) => p.clicks)),
        avgEngagementRate: rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10000) / 10000 : null,
      };
    })
    .sort((a, b) => b.posts - a.posts || a.label.localeCompare(b.label));
}

/** Top posts: highest engagement rate, then reach; only posts with a computable rate. Pure. */
export function topPostsOf(posts: AnalyticsPost[], n = 10): AnalyticsPost[] {
  return posts
    .filter((p) => p.engagementRate !== null)
    .sort((a, b) => (b.engagementRate ?? 0) - (a.engagementRate ?? 0) || (b.reach ?? -1) - (a.reach ?? -1))
    .slice(0, n);
}

export interface OrganicVsPaid {
  organicReach: number | null;
  paidReach: number | null;
  organicEngagements: number | null;
  paidClicks: number | null;
}

export function computeOrganicVsPaid(input: { organicAccounts: { reach: number | null; engagements: number | null }[]; paidCampaigns: { reach: number | null; clicks: number | null }[] }): OrganicVsPaid {
  return {
    organicReach: sumNullable(input.organicAccounts.map((a) => a.reach)),
    paidReach: sumNullable(input.paidCampaigns.map((c) => c.reach)),
    organicEngagements: sumNullable(input.organicAccounts.map((a) => a.engagements)),
    paidClicks: sumNullable(input.paidCampaigns.map((c) => c.clicks)),
  };
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

export interface AnalyticsAccount {
  accountId: string;
  platform: SocialPlatform;
  platformLabel: string;
  displayName: string;
  brandProfileId: string;
  connectionStatus: string;
  accountKind: string;
  followers: number | null;
  followersChange: number | null;
  reach: number | null;
  impressions: number | null;
  views: number | null;
  engagements: number | null;
  websiteClicks: number | null;
  /** The reporting windows the totals above cover (provider-defined). */
  coveredFrom: Date | null;
  coveredTo: Date | null;
  lastSyncAt: Date | null;
}

export interface SocialAnalytics {
  range: { from: Date; to: Date; days: number };
  availability: { connectedAccounts: number; syncedAccounts: number; lastSyncAt: Date | null; note: string };
  accounts: AnalyticsAccount[];
  posts: AnalyticsPost[];
  byPlatform: AnalyticsGroup[];
  byFormat: AnalyticsGroup[];
  byCampaign: AnalyticsGroup[];
  paid: { spendMinor: number | null; impressions: number | null; clicks: number | null; conversions: number | null; cpc: number | null; cpm: number | null; ctr: number | null; cpa: number | null; currency: string | null; campaigns: number } | null;
  organicVsPaid: OrganicVsPaid;
  topPosts: AnalyticsPost[];
  dataNotes: string[];
}

function asPlatform(value: string): SocialPlatform | null {
  const p = socialPlatformSchema.safeParse(value);
  return p.success ? p.data : null;
}

export async function getSocialAnalytics(
  db: Db,
  input: { organizationId: string; actorUserId: string; brandProfileId?: string; platform?: SocialPlatform; campaignId?: string; days?: number; now?: Date },
): Promise<SocialAnalytics> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "social_analytics", input.brandProfileId ?? "all");
  const now = input.now ?? new Date();
  const days = Math.min(Math.max(Math.floor(input.days ?? 30), 1), 365);
  const from = new Date(now.getTime() - days * DAY_MS);

  // Accounts in scope
  const accountConditions = [eq(marketingChannelAccounts.organizationId, input.organizationId), isNull(marketingChannelAccounts.archivedAt)];
  if (input.brandProfileId) accountConditions.push(eq(marketingChannelAccounts.brandProfileId, input.brandProfileId));
  if (input.platform) accountConditions.push(eq(marketingChannelAccounts.platform, input.platform));
  const accountRows = await db.select().from(marketingChannelAccounts).where(and(...accountConditions)).orderBy(marketingChannelAccounts.platform, marketingChannelAccounts.displayName);
  const accountIds = accountRows.map((a) => a.id);
  const accountSnaps: AccountSnapRow[] = accountIds.length
    ? await db
        .select()
        .from(socialAccountMetricSnapshots)
        .where(and(eq(socialAccountMetricSnapshots.organizationId, input.organizationId), inArray(socialAccountMetricSnapshots.channelAccountId, accountIds), gte(socialAccountMetricSnapshots.periodEnd, from)))
        .orderBy(desc(socialAccountMetricSnapshots.periodEnd))
        .limit(5000)
    : [];
  const snapsByAccount = new Map<string, AccountSnapRow[]>();
  for (const s of accountSnaps) {
    const list = snapsByAccount.get(s.channelAccountId) ?? [];
    list.push(s);
    snapsByAccount.set(s.channelAccountId, list);
  }

  const accounts: AnalyticsAccount[] = [];
  for (const a of accountRows) {
    const platform = asPlatform(a.platform);
    if (!platform) continue;
    const snaps = snapsByAccount.get(a.id) ?? [];
    const disjoint = pickDisjointPeriods(snaps, from);
    const withFollowers = snaps.filter((s) => s.followers !== null).sort((x, y) => x.capturedAt.getTime() - y.capturedAt.getTime());
    const latestFollowers = withFollowers.length ? withFollowers[withFollowers.length - 1].followers : null;
    const earliestFollowers = withFollowers.length >= 2 ? withFollowers[0].followers : null;
    accounts.push({
      accountId: a.id,
      platform,
      platformLabel: SOCIAL_PLATFORM_LABELS[platform],
      displayName: a.displayName,
      brandProfileId: a.brandProfileId,
      connectionStatus: a.connectionStatus,
      accountKind: a.accountKind,
      followers: latestFollowers,
      followersChange: latestFollowers !== null && earliestFollowers !== null ? latestFollowers - earliestFollowers : null,
      reach: sumNullable(disjoint.map((s) => s.reach)),
      impressions: sumNullable(disjoint.map((s) => s.impressions)),
      views: sumNullable(disjoint.map((s) => s.views)),
      engagements: sumNullable(disjoint.map((s) => s.engagements)),
      websiteClicks: sumNullable(disjoint.map((s) => s.websiteClicks)),
      coveredFrom: disjoint.length ? new Date(Math.min(...disjoint.map((s) => s.periodStart.getTime()))) : null,
      coveredTo: disjoint.length ? new Date(Math.max(...disjoint.map((s) => s.periodEnd.getTime()))) : null,
      lastSyncAt: a.lastSyncAt,
    });
  }

  // Published posts in range
  const variantConditions = [eq(socialContentVariants.organizationId, input.organizationId), eq(socialContentVariants.status, "published"), gte(socialContentVariants.publishedAt, from)];
  if (input.brandProfileId) variantConditions.push(eq(marketingContentItems.brandProfileId, input.brandProfileId));
  if (input.platform) variantConditions.push(eq(socialContentVariants.platform, input.platform));
  if (input.campaignId) variantConditions.push(eq(marketingContentItems.campaignId, input.campaignId));
  const variants = await db
    .select({ variant: socialContentVariants, title: marketingContentItems.title, campaignId: marketingContentItems.campaignId, campaignName: marketingCampaigns.name })
    .from(socialContentVariants)
    .innerJoin(marketingContentItems, and(eq(marketingContentItems.id, socialContentVariants.contentItemId), eq(marketingContentItems.organizationId, socialContentVariants.organizationId)))
    .leftJoin(marketingCampaigns, and(eq(marketingCampaigns.id, marketingContentItems.campaignId), eq(marketingCampaigns.organizationId, marketingContentItems.organizationId)))
    .where(and(...variantConditions))
    .orderBy(desc(socialContentVariants.publishedAt))
    .limit(500);
  const variantIds = variants.map((v) => v.variant.id);
  const itemIds = [...new Set(variants.map((v) => v.variant.contentItemId))];
  const perfRows: PerfRow[] = variantIds.length
    ? await db
        .select()
        .from(marketingContentPerformanceSnapshots)
        .where(
          and(
            eq(marketingContentPerformanceSnapshots.organizationId, input.organizationId),
            or(inArray(marketingContentPerformanceSnapshots.contentVariantId, variantIds), and(isNull(marketingContentPerformanceSnapshots.contentVariantId), inArray(marketingContentPerformanceSnapshots.contentItemId, itemIds))),
          ),
        )
        .orderBy(desc(marketingContentPerformanceSnapshots.capturedAt))
        .limit(5000)
    : [];
  // Newest snapshot per variant: a synced row keyed to the variant, or a manual row for the same item + account.
  const latestByVariant = new Map<string, PerfRow>();
  for (const v of variants) {
    const match = perfRows.find((s) => s.contentVariantId === v.variant.id || (s.contentVariantId === null && s.contentItemId === v.variant.contentItemId && s.channelAccountId === v.variant.channelAccountId));
    if (match) latestByVariant.set(v.variant.id, match);
  }
  const posts: AnalyticsPost[] = variants.map(({ variant, title, campaignId, campaignName }) => {
    const snap = latestByVariant.get(variant.id) ?? null;
    const counters: PostCounters = snap ? postCountersFromSnapshot(snap) : { impressions: null, reach: null, views: null, likes: null, comments: null, shares: null, saves: null, clicks: null };
    return {
      variantId: variant.id,
      contentItemId: variant.contentItemId,
      title,
      platform: asPlatform(variant.platform) ?? "facebook",
      format: variant.format,
      campaignId,
      campaignName: campaignName ?? null,
      channelAccountId: variant.channelAccountId,
      publishedAt: variant.publishedAt,
      externalPostUrl: variant.externalPostUrl,
      ...counters,
      engagements: engagementsOf(counters),
      engagementRate: engagementRate(counters),
      source: snap ? (snap.source.startsWith("synced:") ? "synced" : "manual") : null,
      capturedAt: snap?.capturedAt ?? null,
    };
  });

  // Paid
  const { snapshots: adSnaps } = await loadAdCampaignSnapshots(db, { organizationId: input.organizationId, brandProfileId: input.brandProfileId, since: from });
  const scopedAdSnaps = input.platform ? adSnaps.filter((s) => s.platform === input.platform) : adSnaps;
  const latestCampaigns = latestPerCampaign(scopedAdSnaps).map((s) => ({ currency: s.currency, spendMinor: s.spendMinor, impressions: s.impressions, clicks: s.clicks, reach: s.reach, conversions: s.conversions === null ? null : Number(s.conversions) }));
  const adTotals = latestCampaigns.length ? computeAdTotals(latestCampaigns) : null;
  const paid = adTotals ? { spendMinor: adTotals.spendMinor, impressions: adTotals.impressions, clicks: adTotals.clicks, conversions: adTotals.conversions, cpc: adTotals.cpc, cpm: adTotals.cpm, ctr: adTotals.ctr, cpa: adTotals.cpa, currency: adTotals.currency, campaigns: adTotals.campaigns } : null;

  const organicAccounts = accounts.filter((a) => a.accountKind !== "paid" && !isAdPlatform(a.platform));
  const organicVsPaid = computeOrganicVsPaid({ organicAccounts, paidCampaigns: latestCampaigns });

  // Availability + notes
  const connected = accountRows.filter((a) => a.connectionStatus === "connected");
  const synced = accountRows.filter((a) => (snapsByAccount.get(a.id)?.length ?? 0) > 0 || adSnaps.some((s) => s.channelAccountId === a.id));
  const syncTimes = accountRows.map((a) => a.lastSyncAt?.getTime() ?? 0).filter((t) => t > 0);
  const lastSyncAt = syncTimes.length ? new Date(Math.max(...syncTimes)) : null;
  const dataNotes: string[] = [];
  if (accounts.some((a) => a.platform === "instagram")) dataNotes.push("Instagram impressions are no longer provided by Meta; views are shown instead.");
  if (accounts.some((a) => a.platform === "facebook")) dataNotes.push("Facebook Page reach and views use Meta's media-view metrics; likes for Facebook posts are total reactions.");
  for (const a of accountRows) {
    const platform = asPlatform(a.platform);
    if (!platform) continue;
    const label = `${SOCIAL_PLATFORM_LABELS[platform]} (${a.displayName})`;
    if (!SOCIAL_PLATFORM_PROVIDER[platform]) dataNotes.push(`${label} has no official-API integration in this build — record its results manually.`);
    else if (a.connectionStatus === "manual") dataNotes.push(`${label} is tracked manually — connect it to sync metrics.`);
    else if (a.connectionStatus !== "connected") dataNotes.push(`${label} is ${a.connectionStatus.replace(/_/g, " ")} — reconnect it to resume syncing.`);
    else if (!synced.includes(a)) dataNotes.push(`No synced data for ${label} yet — run a sync to see metrics.`);
  }
  if (posts.length && !posts.some((p) => p.source !== null)) dataNotes.push(`${posts.length} post(s) were published in this period but no performance has been synced or recorded for them yet.`);
  if (input.campaignId) dataNotes.push("Account-level metrics are not campaign-specific; the campaign filter applies to posts only.");
  if (paid && paid.currency === null) dataNotes.push("Ad campaigns use more than one currency — paid spend totals are not combined.");

  const note = !accountRows.length
    ? "No social accounts in scope yet."
    : connected.length === 0
      ? "No account is connected — figures below come only from manually recorded results."
      : synced.length === 0
        ? "Accounts are connected but nothing has been synced yet."
        : `${synced.length} of ${accountRows.length} account(s) have synced data.`;

  return {
    range: { from, to: now, days },
    availability: { connectedAccounts: connected.length, syncedAccounts: synced.length, lastSyncAt, note },
    accounts,
    posts,
    byPlatform: groupPosts(posts, (p) => ({ key: p.platform, label: SOCIAL_PLATFORM_LABELS[p.platform] })),
    byFormat: groupPosts(posts, (p) => ({ key: p.format, label: p.format.replace(/_/g, " ") })),
    byCampaign: groupPosts(posts, (p) => ({ key: p.campaignId, label: p.campaignName ?? "Campaign" })),
    paid,
    organicVsPaid,
    topPosts: topPostsOf(posts),
    dataNotes,
  };
}
