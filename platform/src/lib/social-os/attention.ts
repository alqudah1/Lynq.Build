import "server-only";
import { and, count, eq, gte, inArray, isNull, lt, max, min, notInArray, sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingBrandProfiles, marketingChannelAccounts, marketingContentItems, socialContentVariants, socialEngagementItems, socialPublishJobs } from "@/db/schema";
import { resolveMarketingAuthContext, requireMarketingViewAuthority } from "@/lib/marketing-os/authz";
import type { AttentionItem } from "@/lib/founder-os/attention-engine";
import { computeAdAnomalies, loadAdCampaignSnapshots, type AdAnomaly } from "./advertising";
import type { SocialServiceDeps } from "./analytics-sync";
import { computeInboxSummary } from "./engagement";
import { dailyBudgetUsd, getDailyMediaSpendUsd } from "./generation";
import { loadSocialAiEnv } from "./providers/ai/registry";
import { zonedDateTimeToUtc } from "./studio";
import { SOCIAL_PLATFORM_LABELS, SOCIAL_PLATFORM_PROVIDER, isOrganicPlatform, socialPlatformSchema, type SocialPlatform } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * Module 19 — the Social daily manager. Deterministic rules over live data
 * (no LLM): what awaits approval, what publishes today, what failed, what
 * the inbox owes, which connections are broken or expiring, which platforms
 * have gone quiet, ad anomalies, brands with nothing planned, and AI spend.
 * Every item carries an app path relative to `/app/{organizationSlug}` —
 * the UI prefixes it.
 */

export const SOCIAL_ATTENTION_TIMEZONE = "America/Toronto";
export const STALE_PLATFORM_DAYS = 4;
const DAY_MS = 24 * 3600 * 1000;

export type SocialAttentionSeverity = "info" | "attention" | "urgent";

export interface SocialAttentionItem {
  id: string;
  severity: SocialAttentionSeverity;
  reasonCode: string;
  title: string;
  detail: string;
  /** App path relative to `/app/{organizationSlug}` (e.g. `/social/approvals`). */
  path: string;
  count?: number;
  recordType: string;
  recordId: string;
  actionLabel?: string;
}

export interface SocialAttention {
  greeting: "Good morning" | "Good afternoon" | "Good evening";
  items: SocialAttentionItem[];
  actions: { label: string; path: string }[];
  computedAt: string;
}

export interface SocialAttentionFacts {
  organizationId: string;
  reviewQueue: { count: number; oldestAt: Date | null };
  scheduledToday: number;
  publishedToday: number;
  failedPublishJobs: { count: number; latestAt: Date | null };
  inbox: { openCount: number; newCount: number; oldestAt: Date | null };
  brokenAccounts: { id: string; displayName: string; platform: SocialPlatform; status: string; lastErrorMessage: string | null }[];
  expiringAccounts: { id: string; displayName: string; platform: SocialPlatform; tokenExpiresAt: Date }[];
  stalePlatforms: { accountId: string; displayName: string; platform: SocialPlatform; daysSinceLastPost: number | null }[];
  adAnomalies: AdAnomaly[];
  brandsWithoutUpcoming: { id: string; name: string }[];
  engagementTrend: { thisWeek: number; lastWeek: number } | null;
  aiBudget: { spentUsd: number; budgetUsd: number } | null;
}

// ---------------------------------------------------------------------------
// Pure
// ---------------------------------------------------------------------------

function localHour(now: Date, timeZone: string): number {
  const h = new Intl.DateTimeFormat("en-CA", { timeZone, hour: "numeric", hourCycle: "h23" }).format(now);
  return Number(h) % 24;
}

/** Greeting by local hour (default America/Toronto): < 12 morning, < 17 afternoon, else evening. Pure. */
export function greetingFor(now: Date, timeZone: string = SOCIAL_ATTENTION_TIMEZONE): SocialAttention["greeting"] {
  const h = localHour(now, timeZone);
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** [start, end) of the local calendar day containing `now`, as UTC instants. Pure. */
export function localDayBounds(now: Date, timeZone: string = SOCIAL_ATTENTION_TIMEZONE): { start: Date; end: Date } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((p) => [p.type, p.value]));
  const y = Number(parts.year);
  const m = Number(parts.month);
  const d = Number(parts.day);
  const start = zonedDateTimeToUtc(y, m, d, 0, 0, timeZone);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const end = zonedDateTimeToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, timeZone);
  return { start, end };
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function ageHours(from: Date | null, now: Date): number {
  return from ? (now.getTime() - from.getTime()) / 3600_000 : 0;
}

const SEVERITY_WEIGHT: Record<SocialAttentionSeverity, number> = { urgent: 3, attention: 2, info: 1 };

/** Turns gathered facts into ordered attention items. Pure and deterministic. */
export function buildSocialAttentionItems(facts: SocialAttentionFacts, now: Date): SocialAttentionItem[] {
  const org = facts.organizationId;
  const items: SocialAttentionItem[] = [];

  if (facts.reviewQueue.count > 0) {
    const old = ageHours(facts.reviewQueue.oldestAt, now);
    items.push({
      id: "social_review_queue",
      severity: old >= 24 ? "urgent" : "attention",
      reasonCode: "social_posts_awaiting_approval",
      title: `${plural(facts.reviewQueue.count, "post")} waiting for your approval`,
      detail: old >= 1 ? `The oldest has been waiting ${old >= 48 ? `${Math.floor(old / 24)} days` : `${Math.floor(old)} hours`}.` : "Submitted within the last hour.",
      path: "/social/approvals",
      count: facts.reviewQueue.count,
      recordType: "organization",
      recordId: org,
      actionLabel: "Review posts",
    });
  }

  if (facts.failedPublishJobs.count > 0) {
    items.push({
      id: "social_publish_failed",
      severity: "urgent",
      reasonCode: "social_publish_failed",
      title: `${plural(facts.failedPublishJobs.count, "post")} failed to publish this week`,
      detail: "Check the error, fix the post or reconnect the account, then retry.",
      path: "/social/publishing",
      count: facts.failedPublishJobs.count,
      recordType: "organization",
      recordId: org,
      actionLabel: "Fix failed posts",
    });
  }

  for (const a of facts.brokenAccounts) {
    const label = `${a.displayName} (${SOCIAL_PLATFORM_LABELS[a.platform]})`;
    items.push({
      id: `social_account_broken:${a.id}`,
      severity: "urgent",
      reasonCode: a.status === "error" ? "social_account_error" : "social_account_reauthorize",
      title: a.status === "error" ? `${label} has a connection error` : `Reconnect ${label}`,
      detail: a.status === "token_expired" ? "Its authorization expired — nothing can publish or sync until it is reconnected." : a.status === "authorization_required" ? "Its authorization was revoked or is missing — reconnect it." : (a.lastErrorMessage ?? "The last provider call failed."),
      path: "/social/connections",
      recordType: "marketing_channel_account",
      recordId: a.id,
      actionLabel: "Open Connection Center",
    });
  }

  for (const a of facts.expiringAccounts) {
    const days = Math.max(0, Math.ceil((a.tokenExpiresAt.getTime() - now.getTime()) / DAY_MS));
    items.push({
      id: `social_account_expiring:${a.id}`,
      severity: days <= 2 ? "urgent" : "attention",
      reasonCode: "social_account_expiring",
      title: `${a.displayName} (${SOCIAL_PLATFORM_LABELS[a.platform]}) authorization expires ${days === 0 ? "today" : `in ${plural(days, "day")}`}`,
      detail: "Reconnect it before it lapses so scheduled posts keep publishing.",
      path: "/social/connections",
      recordType: "marketing_channel_account",
      recordId: a.id,
    });
  }

  if (facts.inbox.openCount > 0) {
    const old = ageHours(facts.inbox.oldestAt, now);
    items.push({
      id: "social_inbox_open",
      severity: old >= 48 ? "urgent" : "attention",
      reasonCode: "social_engagement_unanswered",
      title: `${plural(facts.inbox.openCount, "comment or message", "comments and messages")} need a reply`,
      detail: `${facts.inbox.newCount} new.${old >= 1 ? ` The oldest is ${old >= 48 ? `${Math.floor(old / 24)} days` : `${Math.floor(old)} hours`} old.` : ""}`,
      path: "/social/inbox",
      count: facts.inbox.openCount,
      recordType: "organization",
      recordId: org,
      actionLabel: "Open inbox",
    });
  }

  for (const anomaly of facts.adAnomalies) {
    items.push({
      id: `social_ad_anomaly:${anomaly.channelAccountId}:${anomaly.campaignId}:${anomaly.kind}`,
      severity: anomaly.kind === "spend_spike" || anomaly.kind === "budget_exhausted" ? "urgent" : "attention",
      reasonCode: `social_ad_${anomaly.kind}`,
      title: anomaly.kind === "spend_spike" ? `Ad spend spike: ${anomaly.name}` : anomaly.kind === "ctr_drop" ? `Click-through rate dropped: ${anomaly.name}` : anomaly.kind === "zero_impressions" ? `Active campaign with no impressions: ${anomaly.name}` : `Budget exhausted: ${anomaly.name}`,
      detail: anomaly.detail,
      path: "/social/advertising",
      recordType: "marketing_channel_account",
      recordId: anomaly.channelAccountId,
      actionLabel: "Review ads",
    });
  }

  for (const b of facts.brandsWithoutUpcoming) {
    items.push({
      id: `social_brand_no_upcoming:${b.id}`,
      severity: "attention",
      reasonCode: "social_brand_needs_content",
      title: `${b.name} needs another post`,
      detail: "Nothing is drafted or scheduled for the next 7 days.",
      path: "/social/studio",
      recordType: "marketing_brand_profile",
      recordId: b.id,
      actionLabel: `Create a post for ${b.name}`,
    });
  }

  for (const s of facts.stalePlatforms) {
    if (s.daysSinceLastPost !== null && s.daysSinceLastPost < STALE_PLATFORM_DAYS) continue;
    const label = `${s.displayName} (${SOCIAL_PLATFORM_LABELS[s.platform]})`;
    items.push({
      id: `social_platform_stale:${s.accountId}`,
      severity: s.daysSinceLastPost === null ? "info" : "attention",
      reasonCode: "social_platform_quiet",
      title: s.daysSinceLastPost === null ? `Nothing has been published to ${label} yet` : `No post on ${label} in ${plural(s.daysSinceLastPost, "day")}`,
      detail: "Consistency matters more than volume — schedule something for this week.",
      path: "/social/calendar",
      recordType: "marketing_channel_account",
      recordId: s.accountId,
    });
  }

  if (facts.scheduledToday > 0) {
    items.push({ id: "social_scheduled_today", severity: "info", reasonCode: "social_scheduled_today", title: `${plural(facts.scheduledToday, "post")} scheduled to publish today`, detail: "They publish automatically at their scheduled time.", path: "/social/calendar", count: facts.scheduledToday, recordType: "organization", recordId: org });
  }
  if (facts.publishedToday > 0) {
    items.push({ id: "social_published_today", severity: "info", reasonCode: "social_published_today", title: `${plural(facts.publishedToday, "post")} published today`, detail: "Confirmed by the platform.", path: "/social/calendar", count: facts.publishedToday, recordType: "organization", recordId: org });
  }

  if (facts.engagementTrend && (facts.engagementTrend.thisWeek > 0 || facts.engagementTrend.lastWeek > 0)) {
    const { thisWeek, lastWeek } = facts.engagementTrend;
    const pct = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : null;
    const direction = thisWeek > lastWeek ? "up" : thisWeek < lastWeek ? "down" : "flat";
    items.push({
      id: "social_engagement_trend",
      severity: "info",
      reasonCode: "social_engagement_trend",
      title: direction === "flat" ? "Engagement is flat this week" : `Engagement is ${direction}${pct !== null ? ` ${Math.abs(pct)}%` : ""} this week`,
      detail: `${plural(thisWeek, "comment or mention", "comments and mentions")} in the last 7 days vs ${lastWeek} the week before.`,
      path: "/social/analytics",
      recordType: "organization",
      recordId: org,
    });
  }

  if (facts.aiBudget && facts.aiBudget.budgetUsd > 0 && facts.aiBudget.spentUsd > 0) {
    const ratio = facts.aiBudget.spentUsd / facts.aiBudget.budgetUsd;
    items.push({
      id: "social_ai_budget",
      severity: ratio >= 1 ? "urgent" : ratio >= 0.8 ? "attention" : "info",
      reasonCode: "social_ai_budget",
      title: ratio >= 1 ? "Today's AI media budget is used up" : `AI media spend today: $${facts.aiBudget.spentUsd.toFixed(2)} of $${facts.aiBudget.budgetUsd.toFixed(2)}`,
      detail: ratio >= 1 ? "New image/video generations are blocked until tomorrow." : `${Math.round(ratio * 100)}% of the daily budget.`,
      path: "/social/studio",
      recordType: "organization",
      recordId: org,
    });
  }

  return items.sort((a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity]);
}

/** Primary actions (deduped by path) from the items that carry one. Pure. */
export function attentionActions(items: SocialAttentionItem[]): { label: string; path: string }[] {
  const seen = new Set<string>();
  const out: { label: string; path: string }[] = [];
  for (const i of items) {
    if (!i.actionLabel || seen.has(`${i.path}|${i.actionLabel}`)) continue;
    seen.add(`${i.path}|${i.actionLabel}`);
    out.push({ label: i.actionLabel, path: i.path });
  }
  return out.slice(0, 6);
}

// ---------------------------------------------------------------------------
// Fact gathering
// ---------------------------------------------------------------------------

function asPlatform(value: string): SocialPlatform | null {
  const p = socialPlatformSchema.safeParse(value);
  return p.success ? p.data : null;
}

function toDate(v: unknown): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function gatherSocialAttentionFacts(db: Db, input: { organizationId: string; brandProfileId?: string | null; now: Date; deps?: SocialServiceDeps }): Promise<SocialAttentionFacts> {
  const { organizationId, now } = input;
  const brandId = input.brandProfileId ?? null;
  const { start, end } = localDayBounds(now);

  const variantBase = (extra: ReturnType<typeof eq>[]) => {
    const c = [eq(socialContentVariants.organizationId, organizationId), isNull(socialContentVariants.archivedAt), ...extra];
    if (brandId) c.push(eq(marketingContentItems.brandProfileId, brandId));
    return and(...c);
  };
  const itemJoin = and(eq(marketingContentItems.id, socialContentVariants.contentItemId), eq(marketingContentItems.organizationId, socialContentVariants.organizationId));

  const [review] = await db.select({ n: count(), oldest: min(socialContentVariants.updatedAt) }).from(socialContentVariants).innerJoin(marketingContentItems, itemJoin).where(variantBase([eq(socialContentVariants.status, "ready_for_review")]));
  const [scheduled] = await db
    .select({ n: count() })
    .from(socialContentVariants)
    .innerJoin(marketingContentItems, itemJoin)
    .where(variantBase([eq(socialContentVariants.status, "scheduled"), gte(socialContentVariants.scheduledFor, start), lt(socialContentVariants.scheduledFor, end)]));
  const [published] = await db
    .select({ n: count() })
    .from(socialContentVariants)
    .innerJoin(marketingContentItems, itemJoin)
    .where(variantBase([eq(socialContentVariants.status, "published"), gte(socialContentVariants.publishedAt, start), lt(socialContentVariants.publishedAt, end)]));

  const jobConditions = [eq(socialPublishJobs.organizationId, organizationId), eq(socialPublishJobs.status, "failed"), gte(socialPublishJobs.failedAt, new Date(now.getTime() - 7 * DAY_MS))];
  if (brandId) jobConditions.push(eq(marketingContentItems.brandProfileId, brandId));
  const [failed] = await db
    .select({ n: count(), latest: max(socialPublishJobs.failedAt) })
    .from(socialPublishJobs)
    .innerJoin(marketingContentItems, and(eq(marketingContentItems.id, socialPublishJobs.contentItemId), eq(marketingContentItems.organizationId, socialPublishJobs.organizationId)))
    .where(and(...jobConditions));

  const inbox = await computeInboxSummary(db, { organizationId, brandProfileId: brandId });

  const accountConditions = [eq(marketingChannelAccounts.organizationId, organizationId), isNull(marketingChannelAccounts.archivedAt)];
  if (brandId) accountConditions.push(eq(marketingChannelAccounts.brandProfileId, brandId));
  const accounts = await db.select().from(marketingChannelAccounts).where(and(...accountConditions));
  const brokenAccounts: SocialAttentionFacts["brokenAccounts"] = [];
  const expiringAccounts: SocialAttentionFacts["expiringAccounts"] = [];
  const organicConnected: typeof accounts = [];
  for (const a of accounts) {
    const platform = asPlatform(a.platform);
    if (!platform) continue;
    if (a.connectionStatus === "token_expired" || a.connectionStatus === "authorization_required" || a.connectionStatus === "error") {
      brokenAccounts.push({ id: a.id, displayName: a.displayName, platform, status: a.connectionStatus, lastErrorMessage: a.lastErrorMessage });
    } else if (a.connectionStatus === "connected") {
      if (a.tokenExpiresAt && a.tokenExpiresAt.getTime() > now.getTime() && a.tokenExpiresAt.getTime() - now.getTime() <= 7 * DAY_MS) expiringAccounts.push({ id: a.id, displayName: a.displayName, platform, tokenExpiresAt: a.tokenExpiresAt });
      if (isOrganicPlatform(platform) && a.accountKind !== "paid" && SOCIAL_PLATFORM_PROVIDER[platform]) organicConnected.push(a);
    }
  }

  const lastPosts = organicConnected.length
    ? await db
        .select({ accountId: socialContentVariants.channelAccountId, last: max(socialContentVariants.publishedAt) })
        .from(socialContentVariants)
        .where(and(eq(socialContentVariants.organizationId, organizationId), eq(socialContentVariants.status, "published"), inArray(socialContentVariants.channelAccountId, organicConnected.map((a) => a.id))))
        .groupBy(socialContentVariants.channelAccountId)
    : [];
  const lastByAccount = new Map(lastPosts.map((r) => [r.accountId as string, toDate(r.last)]));
  const stalePlatforms = organicConnected.map((a) => {
    const last = lastByAccount.get(a.id) ?? null;
    return { accountId: a.id, displayName: a.displayName, platform: a.platform as SocialPlatform, daysSinceLastPost: last ? Math.floor((now.getTime() - last.getTime()) / DAY_MS) : null };
  });

  const { snapshots } = await loadAdCampaignSnapshots(db, { organizationId, brandProfileId: brandId, since: new Date(now.getTime() - 60 * DAY_MS) });
  const adAnomalies = computeAdAnomalies(snapshots);

  const brandConditions = [eq(marketingBrandProfiles.organizationId, organizationId), isNull(marketingBrandProfiles.archivedAt)];
  if (brandId) brandConditions.push(eq(marketingBrandProfiles.id, brandId));
  const brands = await db.select({ id: marketingBrandProfiles.id, name: marketingBrandProfiles.name }).from(marketingBrandProfiles).where(and(...brandConditions));
  const upcoming = brands.length
    ? await db
        .select({ brandProfileId: marketingContentItems.brandProfileId, n: count() })
        .from(socialContentVariants)
        .innerJoin(marketingContentItems, itemJoin)
        .where(
          and(
            eq(socialContentVariants.organizationId, organizationId),
            isNull(socialContentVariants.archivedAt),
            notInArray(socialContentVariants.status, ["published", "failed", "rejected", "archived"]),
            gte(socialContentVariants.scheduledFor, now),
            lt(socialContentVariants.scheduledFor, new Date(now.getTime() + 7 * DAY_MS)),
            inArray(marketingContentItems.brandProfileId, brands.map((b) => b.id)),
          ),
        )
        .groupBy(marketingContentItems.brandProfileId)
    : [];
  const withUpcoming = new Set(upcoming.filter((u) => Number(u.n) > 0).map((u) => u.brandProfileId));
  const brandsWithoutUpcoming = brands.filter((b) => !withUpcoming.has(b.id));

  const engagementConditions = [eq(socialEngagementItems.organizationId, organizationId), gte(socialEngagementItems.postedAt, new Date(now.getTime() - 14 * DAY_MS)), lt(socialEngagementItems.postedAt, now)];
  if (brandId) engagementConditions.push(eq(marketingChannelAccounts.brandProfileId, brandId));
  const weekStart = new Date(now.getTime() - 7 * DAY_MS);
  const [trend] = await db
    .select({ thisWeek: sql<number>`count(*) filter (where ${socialEngagementItems.postedAt} >= ${weekStart.toISOString()})::int`, total: count() })
    .from(socialEngagementItems)
    .innerJoin(marketingChannelAccounts, and(eq(marketingChannelAccounts.id, socialEngagementItems.channelAccountId), eq(marketingChannelAccounts.organizationId, socialEngagementItems.organizationId)))
    .where(and(...engagementConditions));
  const thisWeek = Number(trend?.thisWeek ?? 0);
  const total = Number(trend?.total ?? 0);
  const engagementTrend = total > 0 ? { thisWeek, lastWeek: total - thisWeek } : null;

  let aiBudget: SocialAttentionFacts["aiBudget"] = null;
  try {
    const env = input.deps?.aiEnv ?? (await loadSocialAiEnv());
    aiBudget = { spentUsd: await getDailyMediaSpendUsd(db, { organizationId, now }), budgetUsd: dailyBudgetUsd(env) };
  } catch {
    aiBudget = null;
  }

  return {
    organizationId,
    reviewQueue: { count: Number(review?.n ?? 0), oldestAt: toDate(review?.oldest) },
    scheduledToday: Number(scheduled?.n ?? 0),
    publishedToday: Number(published?.n ?? 0),
    failedPublishJobs: { count: Number(failed?.n ?? 0), latestAt: toDate(failed?.latest) },
    inbox: { openCount: inbox.needsReplyCount, newCount: inbox.byStatus.new, oldestAt: inbox.oldestUnansweredAt },
    brokenAccounts,
    expiringAccounts,
    stalePlatforms,
    adAnomalies,
    brandsWithoutUpcoming,
    engagementTrend,
    aiBudget,
  };
}

/**
 * The Social daily manager. With `actorUserId` the caller's `marketing_view`
 * is required; without it (automation `daily_attention`) it runs as the
 * system for the organization.
 */
export async function computeSocialAttention(db: Db, input: { organizationId: string; actorUserId?: string; brandProfileId?: string | null; now?: Date; deps?: SocialServiceDeps }): Promise<SocialAttention> {
  if (input.actorUserId) {
    const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
    await requireMarketingViewAuthority(db, ctx, "social_attention", input.brandProfileId ?? "all");
  }
  const now = input.now ?? (input.deps?.now ? input.deps.now() : new Date());
  const facts = await gatherSocialAttentionFacts(db, { organizationId: input.organizationId, brandProfileId: input.brandProfileId, now, deps: input.deps });
  const items = buildSocialAttentionItems(facts, now);
  return { greeting: greetingFor(now), items, actions: attentionActions(items), computedAt: now.toISOString() };
}

/** Founder-OS shape: `domain: "marketing"`, deterministic ids, real record references. Wire into `attention-engine.ts` (requires the caller's `marketing_view`). */
export function toFounderAttentionItems(items: SocialAttentionItem[]): AttentionItem[] {
  return items.map((i) => ({
    id: i.id,
    severity: i.severity,
    domain: "marketing",
    reasonCode: i.reasonCode,
    title: i.title,
    explanation: i.detail,
    recordType: i.recordType,
    recordId: i.recordId,
    dueAt: null,
    recommendedActionType: i.actionLabel ? i.actionLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") : "review_social",
    drilldown: { metricKey: null, recordType: i.recordType, recordId: i.recordId },
  }));
}

/** Rule-set entry for the founder attention engine: `["founder_workspace_view_marketing", () => socialAttentionRules(ctx)]`. */
export async function socialAttentionRules(ctx: { db: Db; organizationId: string; workspaceId?: string | null; actorUserId: string; now?: Date }): Promise<AttentionItem[]> {
  const attention = await computeSocialAttention(ctx.db, { organizationId: ctx.organizationId, actorUserId: ctx.actorUserId, now: ctx.now });
  // The founder brief already shows its own "posted today" style info elsewhere; only actionable items are surfaced there.
  return toFounderAttentionItems(attention.items.filter((i) => i.severity !== "info"));
}
