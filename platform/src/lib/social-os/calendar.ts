import "server-only";
import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingBrandProfiles, marketingChannelAccounts, marketingContentItems, socialAssets, socialContentVariants, socialPublishJobs } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { resolveMarketingAuthContext, requireMarketingViewAuthority, requireMarketingManageContentAuthority, requireMarketingPublishAuthority } from "@/lib/marketing-os/authz";
import { toSocialBrand } from "./brands";
import { computeVariantWarnings, resolveVariantRow, scheduleWarning, type SocialVariant, getVariantForUser } from "./content";
import { cancelPublishJob, enqueuePublish } from "./publishing";
import { SOCIAL_PLATFORM_LABELS, isOrganicPlatform, socialOrganicPlatformSchema, socialVariantMediaSchema, type SocialCalendarState, type SocialOrganicPlatform, type SocialVariantStatus } from "./validation";
import { InvalidSocialTransitionError, SocialInvalidScheduleError, StaleSocialUpdateError } from "./errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * Module 19 — the content calendar. Derived, never stored: every entry is
 * a live variant placed on the day it was published, is scheduled for, or
 * is planned for (item `plannedPublishAt`). Undated ideas/drafts are listed
 * separately. Gaps are future days with nothing scheduled on one of the
 * brand's preferred organic platforms. Days are calendar days in the
 * caller's `timeZone` (the organization's social timezone), UTC when omitted.
 */

export interface SocialCalendarEntry {
  date: string;
  variantId: string;
  contentItemId: string;
  title: string;
  brandProfileId: string | null;
  brandName: string | null;
  platform: SocialOrganicPlatform;
  accountDisplayName: string | null;
  status: SocialCalendarState;
  format: string;
  scheduledFor: Date | null;
  publishedAt: Date | null;
  hasMedia: boolean;
  warningsCount: number;
  blocking: boolean;
  revision: number;
}

export interface SocialCalendarGap {
  date: string;
  platform: SocialOrganicPlatform;
  reason: string;
}

export interface SocialCalendar {
  range: { from: string; to: string; view: "day" | "week" | "month" };
  entries: SocialCalendarEntry[];
  undated: SocialCalendarEntry[];
  gaps: SocialCalendarGap[];
  countsByStatus: Partial<Record<SocialCalendarState, number>>;
}

const MAX_RANGE_DAYS = 93;
const DAY_MS = 24 * 3600 * 1000;
const FILLED_STATES: readonly SocialVariantStatus[] = ["approved", "scheduled", "publishing", "published"];

/** `YYYY-MM-DD` of an instant — in `timeZone` when given (the organization's social timezone, matching the grid the UI draws), else UTC. */
function dayKey(d: Date, timeZone?: string): string {
  if (!timeZone) return d.toISOString().slice(0, 10);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function nextKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

function calendarState(status: SocialVariantStatus, body: string, mediaCount: number): SocialCalendarState {
  if (status === "draft" && !body.trim() && mediaCount === 0) return "idea";
  if (status === "rejected") return "changes_requested";
  if (status === "archived") return "draft";
  return status;
}

export async function getSocialCalendar(
  db: Db,
  input: { organizationId: string; actorUserId: string; from: Date; to: Date; brandProfileId?: string; platform?: SocialOrganicPlatform; campaignId?: string; view: "day" | "week" | "month"; now?: Date; timeZone?: string }
): Promise<SocialCalendar> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "social_calendar", input.brandProfileId ?? "all");
  if (!(input.from instanceof Date) || Number.isNaN(input.from.getTime()) || !(input.to instanceof Date) || Number.isNaN(input.to.getTime()) || input.to <= input.from) throw new SocialInvalidScheduleError("the calendar range must end after it starts");
  if (input.to.getTime() - input.from.getTime() > MAX_RANGE_DAYS * DAY_MS) throw new SocialInvalidScheduleError(`the calendar range can be at most ${MAX_RANGE_DAYS} days`);
  const now = input.now ?? new Date();

  const dateExpr = sql<Date | null>`coalesce(${socialContentVariants.publishedAt}, ${socialContentVariants.scheduledFor}, ${marketingContentItems.plannedPublishAt})`;
  const conditions = [
    eq(socialContentVariants.organizationId, input.organizationId),
    isNull(socialContentVariants.archivedAt),
    isNull(marketingContentItems.archivedAt),
    or(and(gte(dateExpr, input.from), lt(dateExpr, input.to)), sql`${dateExpr} IS NULL`)!,
  ];
  if (input.brandProfileId) conditions.push(eq(marketingContentItems.brandProfileId, input.brandProfileId));
  if (input.platform) conditions.push(eq(socialContentVariants.platform, input.platform));
  if (input.campaignId) conditions.push(eq(marketingContentItems.campaignId, input.campaignId));

  const rows = await db
    .select({ variant: socialContentVariants, title: marketingContentItems.title, brandProfileId: marketingContentItems.brandProfileId, plannedPublishAt: marketingContentItems.plannedPublishAt, accountName: marketingChannelAccounts.displayName, account: marketingChannelAccounts })
    .from(socialContentVariants)
    .innerJoin(marketingContentItems, and(eq(marketingContentItems.id, socialContentVariants.contentItemId), eq(marketingContentItems.organizationId, socialContentVariants.organizationId)))
    .leftJoin(marketingChannelAccounts, and(eq(marketingChannelAccounts.id, socialContentVariants.channelAccountId), eq(marketingChannelAccounts.organizationId, socialContentVariants.organizationId)))
    .where(and(...conditions))
    .orderBy(desc(socialContentVariants.createdAt))
    .limit(1000);

  const assetIds = [...new Set(rows.flatMap((r) => { const m = socialVariantMediaSchema.safeParse(r.variant.media); return m.success ? m.data.map((x) => x.assetId) : []; }))];
  const assetRows = assetIds.length ? await db.select({ id: socialAssets.id, title: socialAssets.title, contentType: socialAssets.contentType, assetType: socialAssets.assetType, archivedAt: socialAssets.archivedAt }).from(socialAssets).where(and(eq(socialAssets.organizationId, input.organizationId), inArray(socialAssets.id, assetIds))) : [];
  const assetsById = new Map(assetRows.map((a) => [a.id, a]));
  const brandRows = input.brandProfileId
    ? await db.select().from(marketingBrandProfiles).where(and(eq(marketingBrandProfiles.organizationId, input.organizationId), eq(marketingBrandProfiles.id, input.brandProfileId)))
    : await db.select().from(marketingBrandProfiles).where(and(eq(marketingBrandProfiles.organizationId, input.organizationId), isNull(marketingBrandProfiles.archivedAt)));
  const brands = new Map(brandRows.map((b) => [b.id, toSocialBrand(b)]));

  const entries: SocialCalendarEntry[] = [];
  const undated: SocialCalendarEntry[] = [];
  const countsByStatus: Partial<Record<SocialCalendarState, number>> = {};
  for (const r of rows) {
    const v = r.variant;
    if (!isOrganicPlatform(v.platform)) continue;
    const media = socialVariantMediaSchema.safeParse(v.media);
    const mediaList = media.success ? media.data : [];
    const brand = r.brandProfileId ? brands.get(r.brandProfileId) ?? null : null;
    const warnings = computeVariantWarnings({
      variant: { platform: v.platform, format: v.format, status: v.status, hook: v.hook, body: v.body, hashtags: Array.isArray(v.hashtags) ? (v.hashtags as string[]) : [], callToAction: v.callToAction, linkUrl: v.linkUrl, media: mediaList, scheduledFor: v.scheduledFor, channelAccountId: v.channelAccountId },
      account: r.account ? { id: r.account.id, platform: r.account.platform as SocialOrganicPlatform, brandProfileId: r.account.brandProfileId, displayName: r.account.displayName, connectionStatus: r.account.connectionStatus as never, tokenExpiresAt: r.account.tokenExpiresAt, archivedAt: r.account.archivedAt } : null,
      assets: mediaList.map((m) => assetsById.get(m.assetId)).filter((a): a is NonNullable<typeof a> => Boolean(a)),
      brand,
      now,
    });
    const when = v.publishedAt ?? v.scheduledFor ?? r.plannedPublishAt ?? null;
    const state = calendarState(v.status, v.body, mediaList.length);
    const entry: SocialCalendarEntry = {
      date: (when ?? v.createdAt).toISOString(),
      variantId: v.id,
      contentItemId: v.contentItemId,
      title: r.title,
      brandProfileId: r.brandProfileId,
      brandName: brand?.name ?? null,
      platform: v.platform,
      accountDisplayName: r.accountName ?? null,
      status: state,
      format: v.format,
      scheduledFor: v.scheduledFor,
      publishedAt: v.publishedAt,
      hasMedia: mediaList.length > 0,
      warningsCount: warnings.length,
      blocking: warnings.some((w) => w.severity === "blocking"),
      revision: v.revision,
    };
    countsByStatus[state] = (countsByStatus[state] ?? 0) + 1;
    if (when) entries.push(entry);
    else if (undated.length < 100) undated.push(entry);
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));

  // Gaps: future days in range × the brand(s)' preferred organic platforms with nothing approved/scheduled/published.
  const preferred = new Set<SocialOrganicPlatform>();
  for (const b of brands.values()) for (const p of b.preferredPlatforms) if (isOrganicPlatform(p)) preferred.add(p);
  if (input.platform) for (const p of [...preferred]) if (p !== input.platform) preferred.delete(p);
  const filled = new Set(rows.filter((r) => FILLED_STATES.includes(r.variant.status)).map((r) => {
    const when = r.variant.publishedAt ?? r.variant.scheduledFor ?? r.plannedPublishAt;
    return when ? `${dayKey(when, input.timeZone)}|${r.variant.platform}` : "";
  }));
  // Day keys are calendar days in `input.timeZone` (UTC when absent) so a
  // 9 p.m. post fills the same day the grid shows it on.
  const gaps: SocialCalendarGap[] = [];
  const todayKey = dayKey(now, input.timeZone);
  const fromKey = dayKey(input.from, input.timeZone);
  const lastKey = dayKey(new Date(input.to.getTime() - 1), input.timeZone);
  for (let key = fromKey < todayKey ? todayKey : fromKey; key <= lastKey; key = nextKey(key)) {
    for (const p of preferred) {
      if (!filled.has(`${key}|${p}`)) gaps.push({ date: key, platform: p, reason: `Nothing approved or scheduled on ${SOCIAL_PLATFORM_LABELS[p]}` });
    }
  }

  return { range: { from: input.from.toISOString(), to: input.to.toISOString(), view: input.view }, entries, undated, gaps, countsByStatus };
}

/**
 * Moves a post on the calendar. Draft / in-review / approved posts just get
 * a new `scheduledFor`; a scheduled post's job is cancelled and a new one
 * queued for the new time (requires `marketing_publish`). Publishing or
 * published posts cannot move.
 */
export async function rescheduleVariant(db: Db, input: { organizationId: string; contentVariantId: string; actorUserId: string; expectedRevision: number; scheduledFor: Date }): Promise<SocialVariant> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageContentAuthority(db, ctx, "social_content_variant", input.contentVariantId);
  const existing = await resolveVariantRow(db, input.organizationId, input.contentVariantId);
  if (existing.archivedAt || !["draft", "changes_requested", "ready_for_review", "approved", "scheduled"].includes(existing.status)) throw new InvalidSocialTransitionError("post", existing.status, "rescheduled");
  if (existing.revision !== input.expectedRevision) throw new StaleSocialUpdateError("post");
  const platform = socialOrganicPlatformSchema.parse(existing.platform);
  const w = scheduleWarning(platform, input.scheduledFor);
  if (w) throw new SocialInvalidScheduleError(w.message);

  if (existing.status === "scheduled") {
    await requireMarketingPublishAuthority(db, ctx, "social_content_variant", existing.id);
    const active = await db
      .select({ id: socialPublishJobs.id })
      .from(socialPublishJobs)
      .where(and(eq(socialPublishJobs.organizationId, input.organizationId), eq(socialPublishJobs.contentVariantId, existing.id), inArray(socialPublishJobs.status, ["queued", "retrying"])));
    for (const job of active) await cancelPublishJob(db, { organizationId: input.organizationId, publishJobId: job.id, actorUserId: input.actorUserId, revertVariant: true });
    await enqueuePublish(db, { organizationId: input.organizationId, contentVariantId: existing.id, actorUserId: input.actorUserId, scheduledFor: input.scheduledFor });
  } else {
    const [row] = await db
      .update(socialContentVariants)
      .set({ scheduledFor: input.scheduledFor, revision: existing.revision + 1, updatedAt: new Date() })
      .where(and(eq(socialContentVariants.id, existing.id), eq(socialContentVariants.organizationId, input.organizationId), eq(socialContentVariants.revision, existing.revision)))
      .returning({ id: socialContentVariants.id });
    if (!row) throw new StaleSocialUpdateError("post");
  }
  await recordAuditEvent(db, { eventType: "social_variant_scheduled", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_content_variant", targetId: existing.id, metadata: { action: "rescheduled", from: existing.scheduledFor?.toISOString() ?? null, to: input.scheduledFor.toISOString(), status: existing.status } });
  return getVariantForUser(db, { organizationId: input.organizationId, contentVariantId: existing.id, actorUserId: input.actorUserId });
}

export interface InstagramGridTile {
  variantId: string;
  contentItemId: string;
  title: string;
  status: SocialVariantStatus;
  at: string | null;
  format: string;
  imageAssetId: string | null;
  published: boolean;
}

/**
 * How the brand's Instagram grid will read: feed posts (and reels shared to
 * the feed) newest first — planned ones on top of what LYNQ already
 * published — so the row pattern can be checked before anything goes out.
 * Posts made outside LYNQ aren't known here and sit below these.
 */
export async function getInstagramGridPreview(db: Db, input: { organizationId: string; actorUserId: string; brandProfileId: string; limit?: number }): Promise<InstagramGridTile[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "social_calendar", input.brandProfileId);
  const when = sql<Date | null>`coalesce(${socialContentVariants.publishedAt}, ${socialContentVariants.scheduledFor}, ${marketingContentItems.plannedPublishAt})`;
  const rows = await db
    .select({ variant: socialContentVariants, title: marketingContentItems.title, when })
    .from(socialContentVariants)
    .innerJoin(marketingContentItems, and(eq(marketingContentItems.id, socialContentVariants.contentItemId), eq(marketingContentItems.organizationId, socialContentVariants.organizationId)))
    .where(and(
      eq(socialContentVariants.organizationId, input.organizationId),
      eq(marketingContentItems.brandProfileId, input.brandProfileId),
      eq(socialContentVariants.platform, "instagram"),
      inArray(socialContentVariants.format, ["image", "carousel", "reel"]),
      isNull(socialContentVariants.archivedAt),
      isNull(marketingContentItems.archivedAt),
      inArray(socialContentVariants.status, ["draft", "changes_requested", "ready_for_review", "approved", "scheduled", "publishing", "published"]),
    ))
    .orderBy(sql`${when} desc nulls last`)
    .limit(Math.min(input.limit ?? 18, 60) * 2);
  const tiles: InstagramGridTile[] = [];
  for (const r of rows) {
    const v = r.variant;
    const options = (v.platformOptions ?? {}) as { shareToFeed?: boolean };
    if (v.format === "reel" && options.shareToFeed === false) continue; // reels kept off the grid
    if (!r.when && v.status !== "published") continue; // undated drafts aren't part of the planned grid
    const media = socialVariantMediaSchema.safeParse(v.media);
    tiles.push({
      variantId: v.id,
      contentItemId: v.contentItemId,
      title: r.title,
      status: v.status,
      at: r.when ? new Date(r.when).toISOString() : null,
      format: v.format,
      imageAssetId: media.success ? media.data[0]?.assetId ?? null : null,
      published: v.status === "published",
    });
    if (tiles.length >= (input.limit ?? 18)) break;
  }
  return tiles;
}
