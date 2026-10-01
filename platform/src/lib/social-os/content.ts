import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { agentApprovalRequests, marketingBrandProfiles, marketingCampaigns, marketingChannelAccounts, marketingContentItems, socialAssets, socialContentVariants, socialPublishJobs } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { DomainRuleViolationError } from "@/lib/authz/errors";
import { requireTenantScopedResource } from "@/lib/authz/helpers";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { approveRequest, rejectRequest, requestRevision } from "@/lib/agent-runtime/approvals";
import {
  resolveMarketingAuthContext,
  hasMarketingCapability,
  requireMarketingViewAuthority,
  requireMarketingManageContentAuthority,
  requireMarketingApproveContentAuthority,
  requireMarketingPublishAuthority,
} from "@/lib/marketing-os/authz";
import { resolveCampaignById } from "@/lib/marketing-os/campaigns";
import type { MarketingContentType } from "@/lib/marketing-os/validation";
import { requireActiveBrand, ensureAlwaysOnCampaign, toSocialBrand, type SocialBrand } from "./brands";
import type { SocialAccountView } from "./connections";
import { requestVariantApproval } from "./agents";
import { requireUsableAssets, assetPreviewPath } from "./assets";
import { enqueuePublish, cancelPublishJob } from "./publishing";
import { composeCaption } from "./providers/social/http";
import {
  SOCIAL_PLATFORM_LABELS,
  SOCIAL_PLATFORM_RULES,
  SOCIAL_ACCOUNT_CONNECTION_STATUSES,
  socialContentBriefSchema,
  socialVariantInputSchema,
  socialVariantUpdateSchema,
  socialVariantMediaSchema,
  socialVariantPlatformOptionsSchema,
  socialVariantFormatSchema,
  socialOrganicPlatformSchema,
  normalizeHashtag,
  type SocialContentBrief,
  type SocialContentKind,
  type SocialOrganicPlatform,
  type SocialVariantFormat,
  type SocialVariantInput,
  type SocialVariantUpdate,
  type SocialVariantMedia,
  type SocialVariantPlatformOptions,
  type SocialVariantStatus,
  type SocialWarning,
  type SocialAccountConnectionStatus,
} from "./validation";
import {
  StaleSocialUpdateError,
  InvalidSocialTransitionError,
  SocialAccountBrandMismatchError,
  SocialPlatformMismatchError,
  SocialVariantNotPublishableError,
  SocialApprovalRequiredError,
  SocialInvalidScheduleError,
} from "./errors";

type Db = NeonHttpDatabase<Record<string, unknown>>;
export type SocialVariantRow = typeof socialContentVariants.$inferSelect;
type ItemRow = typeof marketingContentItems.$inferSelect;
type AccountRow = typeof marketingChannelAccounts.$inferSelect;
type AssetRow = typeof socialAssets.$inferSelect;

/**
 * Module 19 — content items and their per-platform variants.
 *
 * A content item (`marketing_content_items`) carries the shared creative
 * brief; each `social_content_variants` row is the publishable rendering
 * for one platform + account. The variant is the unit of review, approval,
 * scheduling and publishing; the item's status is derived from its
 * variants (`syncContentItemStatus`).
 *
 * Variant lifecycle (see docs/MODULE_19_SOCIAL_COMMAND_CENTER.md §2):
 *   draft → ready_for_review → approved | changes_requested | rejected
 *   changes_requested|rejected → draft
 *   approved → scheduled (job queued) | publishing (publish now)
 *   scheduled → approved (unscheduled) | publishing → published | failed
 *   failed → publishing (retry, new job series); any non-published → archived
 *
 * Editing rules: a variant is editable in draft / changes_requested /
 * ready_for_review / approved. Editing a variant that is awaiting review or
 * already approved sends it back to `draft` and clears the approval — an
 * approval covers the exact content a human saw, never a later edit.
 * Scheduled / publishing / published variants are not editable (unschedule
 * first).
 */

export class SocialVariantExistsError extends DomainRuleViolationError {
  readonly reason = "social_variant_exists";
  constructor() {
    super("This content item already has a variant for that platform and account");
    this.name = "SocialVariantExistsError";
  }
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export type SocialVariant = Omit<SocialVariantRow, "platform" | "format" | "status" | "hashtags" | "media" | "platformOptions" | "warnings"> & {
  platform: SocialOrganicPlatform;
  format: SocialVariantFormat;
  status: SocialVariantStatus;
  hashtags: string[];
  media: SocialVariantMedia;
  platformOptions: SocialVariantPlatformOptions;
  warnings: SocialWarning[];
  accountDisplayName: string | null;
  accountStatus: SocialAccountConnectionStatus | null;
};

export type SocialContentItem = Omit<ItemRow, "brief"> & {
  brief: SocialContentBrief;
  brandName: string | null;
  campaignName: string | null;
  variants: SocialVariant[];
};

function parseBrief(value: unknown): SocialContentBrief {
  const parsed = socialContentBriefSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : socialContentBriefSchema.parse({});
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function parseMedia(value: unknown): SocialVariantMedia {
  const parsed = socialVariantMediaSchema.safeParse(value ?? []);
  return parsed.success ? parsed.data : [];
}

function parseOptions(value: unknown): SocialVariantPlatformOptions {
  const parsed = socialVariantPlatformOptionsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

function asAccountStatus(value: string): SocialAccountConnectionStatus {
  return (SOCIAL_ACCOUNT_CONNECTION_STATUSES as readonly string[]).includes(value) ? (value as SocialAccountConnectionStatus) : "error";
}

function asFormat(value: string): SocialVariantFormat {
  const parsed = socialVariantFormatSchema.safeParse(value);
  return parsed.success ? parsed.data : "text";
}

function asOrganicPlatform(value: string): SocialOrganicPlatform {
  const parsed = socialOrganicPlatformSchema.safeParse(value);
  return parsed.success ? parsed.data : "facebook";
}

function toVariant(row: SocialVariantRow, account: AccountRow | null, warnings: SocialWarning[]): SocialVariant {
  return {
    ...row,
    platform: asOrganicPlatform(row.platform),
    format: asFormat(row.format),
    status: row.status,
    hashtags: stringList(row.hashtags),
    media: parseMedia(row.media),
    platformOptions: parseOptions(row.platformOptions),
    warnings,
    accountDisplayName: account?.displayName ?? null,
    accountStatus: account ? asAccountStatus(account.connectionStatus) : null,
  };
}

// ---------------------------------------------------------------------------
// Pure rules: default formats, hashtags, warnings
// ---------------------------------------------------------------------------

const VIDEO_PLATFORMS: readonly SocialOrganicPlatform[] = ["instagram", "tiktok", "youtube", "facebook", "linkedin", "x"];

/** The default variant format for a brief kind on a platform; falls back to the platform's first supported format when the natural one is not available (e.g. a text post on Instagram becomes an image post). */
export function defaultFormatFor(kind: SocialContentKind, platform: SocialOrganicPlatform): SocialVariantFormat {
  let format: SocialVariantFormat;
  switch (kind) {
    case "carousel":
      format = "carousel";
      break;
    case "image_post":
      format = "image";
      break;
    case "story":
      format = "story";
      break;
    case "short_video_concept":
    case "generated_video":
      format = platform === "instagram" ? "reel" : platform === "tiktok" || platform === "youtube" ? "short_video" : "video";
      break;
    case "video_script":
      format = VIDEO_PLATFORMS.includes(platform) && SOCIAL_PLATFORM_RULES[platform].formats.includes("video") ? "video" : platform === "instagram" ? "reel" : platform === "tiktok" ? "short_video" : "text";
      break;
    default:
      format = "text";
  }
  const rules = SOCIAL_PLATFORM_RULES[platform];
  return rules.formats.includes(format) ? format : rules.formats[0];
}

export function normalizeHashtags(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of raw) {
    const n = normalizeHashtag(tag);
    if (!n || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    out.push(n);
  }
  return out;
}

export interface WarningVariantInput {
  platform: SocialOrganicPlatform;
  format: string;
  status?: SocialVariantStatus;
  hook?: string;
  body: string;
  hashtags: string[];
  callToAction?: string;
  linkUrl: string | null;
  media: SocialVariantMedia;
  scheduledFor: Date | null;
  channelAccountId: string | null;
}
export type WarningAccount = Pick<SocialAccountView, "id" | "platform" | "brandProfileId" | "displayName" | "connectionStatus" | "tokenExpiresAt" | "archivedAt">;
export interface WarningAsset {
  id: string;
  title?: string;
  contentType: string;
  assetType: string;
  archivedAt: Date | null;
}
export type WarningBrand = Pick<SocialBrand, "prohibitedLanguage" | "neverClaim">;

const TOKEN_WARNING_MS = 7 * 24 * 3600 * 1000;
const SCHEDULE_CHECK_STATUSES: readonly SocialVariantStatus[] = ["draft", "generating", "ready_for_review", "changes_requested", "approved", "rejected"];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsTerm(text: string, term: string): boolean {
  const t = term.trim();
  if (!t) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(t)}($|[^\\p{L}\\p{N}_])`, "iu").test(text);
}

/** The lead-window rule for a scheduled publish. Returns a blocking warning or null. */
export function scheduleWarning(platform: SocialOrganicPlatform, scheduledFor: Date, now: Date = new Date()): SocialWarning | null {
  const rules = SOCIAL_PLATFORM_RULES[platform];
  const leadMinutes = (scheduledFor.getTime() - now.getTime()) / 60000;
  if (leadMinutes < 0) return { code: "schedule_in_past", message: "The scheduled time is in the past", severity: "blocking" };
  if (leadMinutes < rules.minScheduleLeadMinutes) return { code: "schedule_too_soon", message: `${SOCIAL_PLATFORM_LABELS[platform]} needs at least ${rules.minScheduleLeadMinutes} minute(s) of lead time`, severity: "blocking" };
  if (leadMinutes > rules.maxScheduleLeadMinutes) return { code: "schedule_too_far", message: `${SOCIAL_PLATFORM_LABELS[platform]} posts can be scheduled at most ${Math.round(rules.maxScheduleLeadMinutes / 1440)} days ahead`, severity: "blocking" };
  return null;
}

export function assertScheduleWindow(platform: SocialOrganicPlatform, scheduledFor: Date, now: Date = new Date()): void {
  const w = scheduleWarning(platform, scheduledFor, now);
  if (w) throw new SocialInvalidScheduleError(w.message);
}

/**
 * Everything a reviewer should know before approving, computed from the
 * platform rules, the target account and the brand guardrails. Pure.
 * `blocking` warnings stop submission/publishing; `warning` ones are
 * shown but do not block. Schedule checks apply only while the variant is
 * still being prepared (a scheduled/published variant's time is history).
 */
export function computeVariantWarnings(input: { variant: WarningVariantInput; account: WarningAccount | null; assets: WarningAsset[]; brand: WarningBrand | null; now?: Date; checkSchedule?: boolean }): SocialWarning[] {
  const { variant, account, brand } = input;
  const now = input.now ?? new Date();
  const rules = SOCIAL_PLATFORM_RULES[variant.platform];
  const label = SOCIAL_PLATFORM_LABELS[variant.platform];
  const warnings: SocialWarning[] = [];
  const push = (code: string, message: string, severity: SocialWarning["severity"]) => warnings.push({ code, message: message.slice(0, 400), severity });
  const format = variant.format as SocialVariantFormat;

  if (!(rules.formats as readonly string[]).includes(format)) push("format_not_supported", `${label} does not support the "${variant.format}" format`, "blocking");

  const caption = composeCaption(variant.body, variant.hashtags);
  if (caption.length > rules.maxBodyLength) push("body_too_long", `The caption is ${caption.length} characters; ${label} allows ${rules.maxBodyLength}`, "blocking");
  if (variant.hashtags.length > rules.maxHashtags) push("too_many_hashtags", `${variant.hashtags.length} hashtags; ${label} allows ${rules.maxHashtags}`, "warning");
  if (format === "text" && !variant.body.trim()) push("empty_body", "The post has no text", "blocking");
  if (format === "link" && !variant.linkUrl) push("link_required", "A link post needs a link URL", "blocking");

  const assetsById = new Map(input.assets.map((a) => [a.id, a]));
  const contentMedia = variant.media.filter((m) => m.role !== "thumbnail" && m.role !== "cover");
  if ((rules.mediaRequiredFormats as readonly string[]).includes(format) && contentMedia.length === 0) push("media_required", `A ${format.replace("_", " ")} post on ${label} needs media`, "blocking");
  for (const m of variant.media) {
    const asset = assetsById.get(m.assetId);
    if (!asset) {
      push("asset_missing", "A media item no longer exists", "blocking");
      continue;
    }
    if (asset.archivedAt) push("asset_archived", `"${asset.title ?? "A media item"}" is archived`, "blocking");
    if (asset.contentType.startsWith("image/") && m.role !== "thumbnail" && m.role !== "cover" && !rules.imageContentTypes.includes(asset.contentType)) {
      push(variant.platform === "instagram" ? "instagram_requires_jpeg" : "image_type_not_supported", variant.platform === "instagram" ? `Instagram only accepts JPEG images ("${asset.title ?? asset.id}" is ${asset.contentType})` : `${label} does not accept ${asset.contentType} images`, "blocking");
    }
  }
  if (format === "carousel" && contentMedia.length > rules.maxCarouselItems) push("carousel_too_many_items", `${contentMedia.length} carousel items; ${label} allows ${rules.maxCarouselItems}`, "blocking");
  if (format === "carousel" && contentMedia.length === 1) push("carousel_single_item", "A carousel with one item will publish as a single image", "warning");

  if (!variant.channelAccountId) push("no_account", `Choose the ${label} account this post publishes to`, "blocking");
  else if (!account) push("account_missing", "The selected account no longer exists", "blocking");
  else {
    if (account.archivedAt) push("account_archived", `${account.displayName} is archived`, "blocking");
    if (account.platform !== variant.platform) push("account_platform_mismatch", `${account.displayName} is not a ${label} account`, "blocking");
    if (account.connectionStatus !== "connected") push("account_not_connected", `${account.displayName} is not connected (status: ${account.connectionStatus})`, "blocking");
    else if (account.tokenExpiresAt) {
      const left = account.tokenExpiresAt.getTime() - now.getTime();
      if (left <= 0) push("token_expired", `The authorization for ${account.displayName} has expired — reconnect it`, "blocking");
      else if (left <= TOKEN_WARNING_MS) push("token_expiring", `The authorization for ${account.displayName} expires ${account.tokenExpiresAt.toISOString().slice(0, 10)} — reconnect soon`, "warning");
    }
  }

  const checkSchedule = input.checkSchedule ?? (!variant.status || SCHEDULE_CHECK_STATUSES.includes(variant.status));
  if (checkSchedule && variant.scheduledFor) {
    const w = scheduleWarning(variant.platform, variant.scheduledFor, now);
    if (w) warnings.push(w);
  }

  if (brand) {
    const text = [variant.hook ?? "", variant.body, variant.callToAction ?? ""].join("\n");
    for (const term of brand.prohibitedLanguage) if (containsTerm(text, term)) push("prohibited_language", `Uses prohibited brand language: "${term}"`, "warning");
    for (const phrase of brand.neverClaim) if (containsTerm(text, phrase)) push("never_claim", `Makes a claim the brand never makes: "${phrase}"`, "warning");
  }
  return warnings;
}

export function blockingMessages(warnings: SocialWarning[]): string[] {
  return warnings.filter((w) => w.severity === "blocking").map((w) => w.message);
}

function toWarningAccount(row: AccountRow): WarningAccount {
  return { id: row.id, platform: row.platform as WarningAccount["platform"], brandProfileId: row.brandProfileId, displayName: row.displayName, connectionStatus: asAccountStatus(row.connectionStatus), tokenExpiresAt: row.tokenExpiresAt, archivedAt: row.archivedAt };
}

function toWarningVariant(row: SocialVariantRow, overrides: Partial<WarningVariantInput> = {}): WarningVariantInput {
  return {
    platform: asOrganicPlatform(row.platform),
    format: row.format,
    status: row.status,
    hook: row.hook,
    body: row.body,
    hashtags: stringList(row.hashtags),
    callToAction: row.callToAction,
    linkUrl: row.linkUrl,
    media: parseMedia(row.media),
    scheduledFor: row.scheduledFor,
    channelAccountId: row.channelAccountId,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Loaders (tenant-scoped)
// ---------------------------------------------------------------------------

export async function resolveVariantRow(db: Db, organizationId: string, contentVariantId: string): Promise<SocialVariantRow> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(socialContentVariants).where(and(eq(socialContentVariants.id, contentVariantId), eq(socialContentVariants.organizationId, organizationId)));
    return row;
  });
}

async function resolveItemRow(db: Db, organizationId: string, contentItemId: string): Promise<ItemRow> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(marketingContentItems).where(and(eq(marketingContentItems.id, contentItemId), eq(marketingContentItems.organizationId, organizationId)));
    return row;
  });
}

async function resolveAccountRow(db: Db, organizationId: string, channelAccountId: string): Promise<AccountRow> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(marketingChannelAccounts).where(and(eq(marketingChannelAccounts.id, channelAccountId), eq(marketingChannelAccounts.organizationId, organizationId)));
    return row;
  });
}

interface WarningContext {
  accounts: Map<string, AccountRow>;
  assets: Map<string, AssetRow>;
  brandsByItem: Map<string, SocialBrand | null>;
}

async function loadWarningContext(db: Db, organizationId: string, variants: SocialVariantRow[], items: ItemRow[]): Promise<WarningContext> {
  const accountIds = [...new Set(variants.map((v) => v.channelAccountId).filter((id): id is string => Boolean(id)))];
  const assetIds = [...new Set(variants.flatMap((v) => parseMedia(v.media).map((m) => m.assetId)))];
  const brandIds = [...new Set(items.map((i) => i.brandProfileId).filter((id): id is string => Boolean(id)))];
  const [accounts, assets, brands] = await Promise.all([
    accountIds.length ? db.select().from(marketingChannelAccounts).where(and(eq(marketingChannelAccounts.organizationId, organizationId), inArray(marketingChannelAccounts.id, accountIds))) : Promise.resolve([] as AccountRow[]),
    assetIds.length ? db.select().from(socialAssets).where(and(eq(socialAssets.organizationId, organizationId), inArray(socialAssets.id, assetIds))) : Promise.resolve([] as AssetRow[]),
    brandIds.length ? db.select().from(marketingBrandProfiles).where(and(eq(marketingBrandProfiles.organizationId, organizationId), inArray(marketingBrandProfiles.id, brandIds))) : Promise.resolve([]),
  ]);
  const brandById = new Map(brands.map((b) => [b.id, toSocialBrand(b)]));
  return {
    accounts: new Map(accounts.map((a) => [a.id, a])),
    assets: new Map(assets.map((a) => [a.id, a])),
    brandsByItem: new Map(items.map((i) => [i.id, i.brandProfileId ? (brandById.get(i.brandProfileId) ?? null) : null])),
  };
}

function warningsFor(row: SocialVariantRow, ctx: WarningContext, overrides: Partial<WarningVariantInput> = {}, options: { checkSchedule?: boolean; now?: Date } = {}): SocialWarning[] {
  const variant = toWarningVariant(row, overrides);
  const account = variant.channelAccountId ? ctx.accounts.get(variant.channelAccountId) : undefined;
  const assets = variant.media.map((m) => ctx.assets.get(m.assetId)).filter((a): a is AssetRow => Boolean(a));
  return computeVariantWarnings({ variant, account: account ? toWarningAccount(account) : null, assets, brand: ctx.brandsByItem.get(row.contentItemId) ?? null, checkSchedule: options.checkSchedule, now: options.now });
}

/** Warnings for one variant as stored right now (internal — publishing re-validates with this). */
export async function computeStoredVariantWarnings(db: Db, organizationId: string, row: SocialVariantRow, overrides: Partial<WarningVariantInput> = {}, options: { checkSchedule?: boolean; now?: Date } = {}): Promise<SocialWarning[]> {
  const item = await resolveItemRow(db, organizationId, row.contentItemId);
  const ctx = await loadWarningContext(db, organizationId, [{ ...row, ...(overrides.media ? { media: overrides.media } : {}), ...(overrides.channelAccountId !== undefined ? { channelAccountId: overrides.channelAccountId } : {}) }], [item]);
  return warningsFor(row, ctx, overrides, options);
}

async function hydrateItems(db: Db, organizationId: string, items: ItemRow[], options: { includeArchivedVariants?: boolean; variantFilter?: (v: SocialVariantRow) => boolean } = {}): Promise<SocialContentItem[]> {
  if (!items.length) return [];
  const itemIds = items.map((i) => i.id);
  const conditions = [eq(socialContentVariants.organizationId, organizationId), inArray(socialContentVariants.contentItemId, itemIds)];
  if (!options.includeArchivedVariants) conditions.push(isNull(socialContentVariants.archivedAt));
  const variants = await db.select().from(socialContentVariants).where(and(...conditions)).orderBy(asc(socialContentVariants.createdAt));
  const ctx = await loadWarningContext(db, organizationId, variants, items);
  const campaignIds = [...new Set(items.map((i) => i.campaignId))];
  const campaigns = await db.select({ id: marketingCampaigns.id, name: marketingCampaigns.name }).from(marketingCampaigns).where(and(eq(marketingCampaigns.organizationId, organizationId), inArray(marketingCampaigns.id, campaignIds)));
  const campaignNames = new Map(campaigns.map((c) => [c.id, c.name]));
  const byItem = new Map<string, SocialVariant[]>();
  for (const v of variants) {
    const list = byItem.get(v.contentItemId) ?? [];
    list.push(toVariant(v, v.channelAccountId ? (ctx.accounts.get(v.channelAccountId) ?? null) : null, warningsFor(v, ctx)));
    byItem.set(v.contentItemId, list);
  }
  return items.map((item) => {
    const { brief, ...rest } = item;
    return { ...rest, brief: parseBrief(brief), brandName: ctx.brandsByItem.get(item.id)?.name ?? null, campaignName: campaignNames.get(item.campaignId) ?? null, variants: byItem.get(item.id) ?? [] };
  });
}

async function variantView(db: Db, organizationId: string, row: SocialVariantRow): Promise<SocialVariant> {
  const item = await resolveItemRow(db, organizationId, row.contentItemId);
  const ctx = await loadWarningContext(db, organizationId, [row], [item]);
  return toVariant(row, row.channelAccountId ? (ctx.accounts.get(row.channelAccountId) ?? null) : null, warningsFor(row, ctx));
}

// ---------------------------------------------------------------------------
// Item status sync
// ---------------------------------------------------------------------------

/** Derives the item's status from its variants (the item never has a status of its own once it has variants). Does not bump the item's revision: status is derived, edits stay CAS-safe. */
export async function syncContentItemStatus(db: Db, organizationId: string, contentItemId: string): Promise<void> {
  const variants = await db.select({ status: socialContentVariants.status, archivedAt: socialContentVariants.archivedAt, publishedAt: socialContentVariants.publishedAt }).from(socialContentVariants).where(and(eq(socialContentVariants.organizationId, organizationId), eq(socialContentVariants.contentItemId, contentItemId)));
  if (!variants.length) return;
  const live = variants.filter((v) => !v.archivedAt && v.status !== "archived");
  type ItemStatus = ItemRow["status"];
  let status: ItemStatus;
  const all = (pred: (s: SocialVariantStatus) => boolean) => live.length > 0 && live.every((v) => pred(v.status));
  if (!live.length) status = "archived";
  else if (all((s) => s === "published")) status = "published";
  else if (all((s) => s === "approved")) status = "approved";
  else if (all((s) => s === "approved" || s === "scheduled" || s === "publishing" || s === "published") && live.some((v) => v.status === "scheduled" || v.status === "publishing")) status = "scheduled";
  else if (all((s) => s === "approved" || s === "published")) status = "approved";
  else if (live.some((v) => v.status === "ready_for_review")) status = "review";
  else if (all((s) => s === "rejected")) status = "rejected";
  else status = "draft";

  const publishedTimes = live.map((v) => v.publishedAt?.getTime() ?? 0).filter((t) => t > 0);
  const now = new Date();
  await db
    .update(marketingContentItems)
    .set({
      status,
      updatedAt: now,
      archivedAt: status === "archived" ? now : null,
      ...(status === "published" && publishedTimes.length ? { publishedAt: new Date(Math.max(...publishedTimes)) } : {}),
    })
    .where(and(eq(marketingContentItems.id, contentItemId), eq(marketingContentItems.organizationId, organizationId)));
}

// ---------------------------------------------------------------------------
// Account auto-pick + validation
// ---------------------------------------------------------------------------

async function autoPickAccount(db: Db, organizationId: string, brandProfileId: string, platform: SocialOrganicPlatform): Promise<string | null> {
  const rows = await db
    .select({ id: marketingChannelAccounts.id, connectionStatus: marketingChannelAccounts.connectionStatus, accountKind: marketingChannelAccounts.accountKind })
    .from(marketingChannelAccounts)
    .where(and(eq(marketingChannelAccounts.organizationId, organizationId), eq(marketingChannelAccounts.brandProfileId, brandProfileId), eq(marketingChannelAccounts.platform, platform), isNull(marketingChannelAccounts.archivedAt)));
  const organic = rows.filter((r) => r.accountKind !== "paid");
  const connected = organic.filter((r) => r.connectionStatus === "connected");
  if (connected.length === 1) return connected[0].id;
  if (organic.length === 1) return organic[0].id;
  return null;
}

async function assertAccountFor(db: Db, organizationId: string, channelAccountId: string, platform: SocialOrganicPlatform, brandProfileId: string | null): Promise<AccountRow> {
  const account = await resolveAccountRow(db, organizationId, channelAccountId);
  if (account.platform !== platform) throw new SocialPlatformMismatchError();
  if (brandProfileId && account.brandProfileId !== brandProfileId) throw new SocialAccountBrandMismatchError();
  return account;
}

// ---------------------------------------------------------------------------
// Content items
// ---------------------------------------------------------------------------

export async function createContentItem(
  db: Db,
  input: {
    organizationId: string;
    actorUserId: string;
    brandProfileId: string;
    campaignId?: string | null;
    title: string;
    brief: SocialContentBrief;
    platforms: SocialOrganicPlatform[];
    scheduledFor?: Date | null;
    contentType?: MarketingContentType;
  }
): Promise<SocialContentItem> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageContentAuthority(db, ctx, "marketing_brand_profile", input.brandProfileId);
  const brand = await requireActiveBrand(db, input.organizationId, input.brandProfileId);
  const brief = socialContentBriefSchema.parse(input.brief ?? {});
  const platforms = [...new Set(input.platforms.map((p) => socialOrganicPlatformSchema.parse(p)))];
  if (!platforms.length) throw new SocialVariantNotPublishableError(["choose at least one platform"]);
  const title = input.title.trim().slice(0, 200);
  if (!title) throw new SocialVariantNotPublishableError(["a title is required"]);
  const campaign = input.campaignId ? await resolveCampaignById(db, input.organizationId, input.campaignId) : await ensureAlwaysOnCampaign(db, { organizationId: input.organizationId, brand, actorUserId: input.actorUserId });

  const [item] = await db
    .insert(marketingContentItems)
    .values({
      organizationId: input.organizationId,
      campaignId: campaign.id,
      title,
      contentType: input.contentType ?? "social_post",
      status: "draft",
      ownerUserId: input.actorUserId,
      intendedChannel: platforms.join(",").slice(0, 100),
      plannedPublishAt: input.scheduledFor ?? null,
      brandProfileId: brand.id,
      brief,
      createdByUserId: input.actorUserId,
    })
    .returning();
  await recordAuditEvent(db, { eventType: "social_content_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_content_item", targetId: item.id, metadata: { brandProfileId: brand.id, campaignId: campaign.id, platforms, kind: brief.kind } });

  for (const platform of platforms) {
    const channelAccountId = await autoPickAccount(db, input.organizationId, brand.id, platform);
    const [variant] = await db
      .insert(socialContentVariants)
      .values({
        organizationId: input.organizationId,
        contentItemId: item.id,
        platform,
        channelAccountId,
        format: defaultFormatFor(brief.kind, platform),
        status: "draft",
        hook: brief.hook,
        callToAction: brief.callToAction,
        scheduledFor: input.scheduledFor ?? null,
        createdByUserId: input.actorUserId,
      })
      .returning();
    await recordAuditEvent(db, { eventType: "social_variant_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_content_variant", targetId: variant.id, metadata: { contentItemId: item.id, platform, channelAccountId } });
  }

  const [hydrated] = await hydrateItems(db, input.organizationId, [item]);
  return hydrated;
}

export async function getContentItemForUser(db: Db, input: { organizationId: string; contentItemId: string; actorUserId: string }): Promise<SocialContentItem> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_content_item", input.contentItemId);
  const item = await resolveItemRow(db, input.organizationId, input.contentItemId);
  const [hydrated] = await hydrateItems(db, input.organizationId, [item], { includeArchivedVariants: Boolean(item.archivedAt) });
  return hydrated;
}

export async function listContentItemsForUser(
  db: Db,
  input: { organizationId: string; actorUserId: string; brandProfileId?: string; status?: SocialVariantStatus; platform?: SocialOrganicPlatform; campaignId?: string; limit?: number; includeArchived?: boolean }
): Promise<SocialContentItem[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_content_item", "list");
  const conditions = [eq(marketingContentItems.organizationId, input.organizationId), isNotNull(marketingContentItems.brandProfileId)];
  if (input.brandProfileId) conditions.push(eq(marketingContentItems.brandProfileId, input.brandProfileId));
  if (input.campaignId) conditions.push(eq(marketingContentItems.campaignId, input.campaignId));
  if (!input.includeArchived) conditions.push(isNull(marketingContentItems.archivedAt));
  if (input.status || input.platform) {
    const vc = [eq(socialContentVariants.organizationId, input.organizationId), isNull(socialContentVariants.archivedAt)];
    if (input.status) vc.push(eq(socialContentVariants.status, input.status));
    if (input.platform) vc.push(eq(socialContentVariants.platform, input.platform));
    conditions.push(inArray(marketingContentItems.id, db.select({ id: socialContentVariants.contentItemId }).from(socialContentVariants).where(and(...vc))));
  }
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const items = await db.select().from(marketingContentItems).where(and(...conditions)).orderBy(desc(marketingContentItems.createdAt)).limit(limit);
  return hydrateItems(db, input.organizationId, items);
}

export async function updateContentItem(
  db: Db,
  input: { organizationId: string; contentItemId: string; actorUserId: string; expectedRevision: number; changes: { title?: string; brief?: Partial<SocialContentBrief>; campaignId?: string; plannedPublishAt?: Date | null } }
): Promise<SocialContentItem> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageContentAuthority(db, ctx, "marketing_content_item", input.contentItemId);
  const existing = await resolveItemRow(db, input.organizationId, input.contentItemId);
  if (existing.archivedAt) throw new InvalidSocialTransitionError("content item", "archived", "updated");
  const set: Partial<typeof marketingContentItems.$inferInsert> = { updatedAt: new Date(), revision: input.expectedRevision + 1 };
  const fields: string[] = [];
  if (input.changes.title !== undefined) {
    const title = input.changes.title.trim().slice(0, 200);
    if (!title) throw new SocialVariantNotPublishableError(["a title is required"]);
    set.title = title;
    fields.push("title");
  }
  if (input.changes.brief !== undefined) {
    set.brief = socialContentBriefSchema.parse({ ...parseBrief(existing.brief), ...input.changes.brief });
    fields.push("brief");
  }
  if (input.changes.campaignId !== undefined) {
    set.campaignId = (await resolveCampaignById(db, input.organizationId, input.changes.campaignId)).id;
    fields.push("campaignId");
  }
  if (input.changes.plannedPublishAt !== undefined) {
    set.plannedPublishAt = input.changes.plannedPublishAt;
    fields.push("plannedPublishAt");
  }
  const [row] = await db
    .update(marketingContentItems)
    .set(set)
    .where(and(eq(marketingContentItems.id, existing.id), eq(marketingContentItems.organizationId, input.organizationId), eq(marketingContentItems.revision, input.expectedRevision)))
    .returning();
  if (!row) throw new StaleSocialUpdateError("content item");
  await recordAuditEvent(db, { eventType: "social_content_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_content_item", targetId: row.id, metadata: { fields } });
  const [hydrated] = await hydrateItems(db, input.organizationId, [row]);
  return hydrated;
}

async function cancelActiveJobs(db: Db, organizationId: string, contentVariantId: string): Promise<void> {
  const active = await db
    .select({ id: socialPublishJobs.id })
    .from(socialPublishJobs)
    .where(and(eq(socialPublishJobs.organizationId, organizationId), eq(socialPublishJobs.contentVariantId, contentVariantId), inArray(socialPublishJobs.status, ["queued", "retrying"])));
  for (const job of active) await cancelPublishJob(db, { organizationId, publishJobId: job.id, actorUserId: null, revertVariant: false });
}

/** Archives the item and every variant on it; queued publish jobs are cancelled. Published variants stay published (history) but are archived from the working views. */
export async function archiveContentItem(db: Db, input: { organizationId: string; contentItemId: string; actorUserId: string; expectedRevision: number }): Promise<SocialContentItem> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageContentAuthority(db, ctx, "marketing_content_item", input.contentItemId);
  const existing = await resolveItemRow(db, input.organizationId, input.contentItemId);
  const processing = await db
    .select({ id: socialPublishJobs.id })
    .from(socialPublishJobs)
    .where(and(eq(socialPublishJobs.organizationId, input.organizationId), eq(socialPublishJobs.contentItemId, existing.id), eq(socialPublishJobs.status, "processing")));
  if (processing.length) throw new InvalidSocialTransitionError("content item", "publishing", "archived");
  const now = new Date();
  const [row] = await db
    .update(marketingContentItems)
    .set({ status: "archived", archivedAt: now, updatedAt: now, revision: input.expectedRevision + 1 })
    .where(and(eq(marketingContentItems.id, existing.id), eq(marketingContentItems.organizationId, input.organizationId), eq(marketingContentItems.revision, input.expectedRevision)))
    .returning();
  if (!row) throw new StaleSocialUpdateError("content item");

  const variants = await db.select().from(socialContentVariants).where(and(eq(socialContentVariants.organizationId, input.organizationId), eq(socialContentVariants.contentItemId, existing.id), isNull(socialContentVariants.archivedAt)));
  for (const v of variants) {
    await cancelActiveJobs(db, input.organizationId, v.id);
    await db
      .update(socialContentVariants)
      .set({ status: v.status === "published" ? "published" : "archived", archivedAt: now, updatedAt: now, revision: v.revision + 1 })
      .where(and(eq(socialContentVariants.id, v.id), eq(socialContentVariants.organizationId, input.organizationId)));
  }
  await recordAuditEvent(db, { eventType: "social_content_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_content_item", targetId: row.id, metadata: { action: "archived", variantsArchived: variants.length } });
  const [hydrated] = await hydrateItems(db, input.organizationId, [row], { includeArchivedVariants: true });
  return hydrated;
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

export async function getVariantForUser(db: Db, input: { organizationId: string; contentVariantId: string; actorUserId: string }): Promise<SocialVariant> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "social_content_variant", input.contentVariantId);
  return variantView(db, input.organizationId, await resolveVariantRow(db, input.organizationId, input.contentVariantId));
}

export async function addVariant(db: Db, input: { organizationId: string; contentItemId: string; actorUserId: string; input: SocialVariantInput }): Promise<SocialVariant> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageContentAuthority(db, ctx, "marketing_content_item", input.contentItemId);
  const item = await resolveItemRow(db, input.organizationId, input.contentItemId);
  if (item.archivedAt) throw new InvalidSocialTransitionError("content item", "archived", "edited");
  const parsed = socialVariantInputSchema.parse(input.input);
  let channelAccountId = parsed.channelAccountId ?? null;
  if (channelAccountId) await assertAccountFor(db, input.organizationId, channelAccountId, parsed.platform, item.brandProfileId);
  else if (parsed.channelAccountId === undefined && item.brandProfileId) channelAccountId = await autoPickAccount(db, input.organizationId, item.brandProfileId, parsed.platform);
  await requireUsableAssets(db, input.organizationId, parsed.media);

  let row: SocialVariantRow;
  try {
    [row] = await db
      .insert(socialContentVariants)
      .values({
        organizationId: input.organizationId,
        contentItemId: item.id,
        platform: parsed.platform,
        channelAccountId,
        format: parsed.format,
        status: "draft",
        hook: parsed.hook,
        body: parsed.body,
        hashtags: normalizeHashtags(parsed.hashtags),
        callToAction: parsed.callToAction,
        linkUrl: parsed.linkUrl ?? null,
        media: parsed.media,
        platformOptions: parsed.platformOptions,
        scheduledFor: parsed.scheduledFor ?? null,
        createdByUserId: input.actorUserId,
      })
      .returning();
  } catch (err) {
    if (isPostgresUniqueViolation(err)) throw new SocialVariantExistsError();
    throw err;
  }
  await recordAuditEvent(db, { eventType: "social_variant_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_content_variant", targetId: row.id, metadata: { contentItemId: item.id, platform: row.platform, channelAccountId } });
  await syncContentItemStatus(db, input.organizationId, item.id);
  return variantView(db, input.organizationId, row);
}

/**
 * `socialVariantUpdateSchema` is a `.partial()` of a schema with defaults,
 * and zod 4 still applies those defaults to absent keys — so a PATCH of
 * `{ body }` would otherwise reset hook/hashtags/media/format. Only the
 * keys the caller actually sent are kept.
 */
export function parseVariantChanges(raw: unknown): SocialVariantUpdate {
  const parsed = socialVariantUpdateSchema.parse(raw ?? {});
  const sent = raw && typeof raw === "object" ? new Set(Object.entries(raw as Record<string, unknown>).filter(([, v]) => v !== undefined).map(([k]) => k)) : new Set<string>();
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => sent.has(k))) as SocialVariantUpdate;
}

const EDITABLE_STATUSES: readonly SocialVariantStatus[] = ["draft", "changes_requested", "ready_for_review", "approved"];

/** Best-effort: closes the runtime approval a variant was waiting on when its content changes after submission, so no one approves a version that no longer exists. */
async function closeStaleApproval(db: Db, organizationId: string, approvalRequestId: string | null, actorUserId: string): Promise<void> {
  if (!approvalRequestId) return;
  const [approval] = await db.select({ status: agentApprovalRequests.status }).from(agentApprovalRequests).where(and(eq(agentApprovalRequests.id, approvalRequestId), eq(agentApprovalRequests.organizationId, organizationId)));
  if (approval?.status !== "pending") return;
  try {
    await requestRevision(db, { organizationId, approvalId: approvalRequestId, actorUserId, decisionNote: "The post was edited after it was submitted; it must be resubmitted." });
  } catch {
    // The editor may not hold runtime approver authority (only the submitter
    // or an org admin does); the variant itself no longer points at this
    // approval, and decideVariantApproval only honours the variant's own
    // current approvalRequestId, so a stale decision can never apply.
  }
}

export async function updateVariant(db: Db, input: { organizationId: string; contentVariantId: string; actorUserId: string; expectedRevision: number; changes: SocialVariantUpdate }): Promise<SocialVariant> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageContentAuthority(db, ctx, "social_content_variant", input.contentVariantId);
  const existing = await resolveVariantRow(db, input.organizationId, input.contentVariantId);
  if (existing.archivedAt || !EDITABLE_STATUSES.includes(existing.status)) throw new InvalidSocialTransitionError("post", existing.status, "edited");
  const changes = parseVariantChanges(input.changes);
  const item = await resolveItemRow(db, input.organizationId, existing.contentItemId);
  const platform = asOrganicPlatform(existing.platform);

  const set: Partial<typeof socialContentVariants.$inferInsert> = {};
  if (changes.channelAccountId !== undefined) {
    if (changes.channelAccountId) await assertAccountFor(db, input.organizationId, changes.channelAccountId, platform, item.brandProfileId);
    set.channelAccountId = changes.channelAccountId ?? null;
  }
  if (changes.format !== undefined) set.format = changes.format;
  if (changes.hook !== undefined) set.hook = changes.hook;
  if (changes.body !== undefined) set.body = changes.body;
  if (changes.hashtags !== undefined) set.hashtags = normalizeHashtags(changes.hashtags);
  if (changes.callToAction !== undefined) set.callToAction = changes.callToAction;
  if (changes.linkUrl !== undefined) set.linkUrl = changes.linkUrl ?? null;
  if (changes.media !== undefined) {
    await requireUsableAssets(db, input.organizationId, changes.media);
    set.media = changes.media;
  }
  if (changes.platformOptions !== undefined) set.platformOptions = changes.platformOptions;
  if (changes.scheduledFor !== undefined) set.scheduledFor = changes.scheduledFor ?? null;
  const fields = Object.keys(set);

  const resetsApproval = existing.status === "ready_for_review" || existing.status === "approved";
  const now = new Date();
  const [row] = await db
    .update(socialContentVariants)
    .set({
      ...set,
      ...(resetsApproval ? { status: "draft" as const, approvalRequestId: null, approvedByUserId: null, approvedAt: null } : {}),
      revision: input.expectedRevision + 1,
      updatedAt: now,
    })
    .where(and(eq(socialContentVariants.id, existing.id), eq(socialContentVariants.organizationId, input.organizationId), eq(socialContentVariants.revision, input.expectedRevision), eq(socialContentVariants.status, existing.status)))
    .returning();
  if (!row) throw new StaleSocialUpdateError("post");
  if (resetsApproval && existing.status === "ready_for_review") await closeStaleApproval(db, input.organizationId, existing.approvalRequestId, input.actorUserId);

  const view = await variantView(db, input.organizationId, row);
  await db.update(socialContentVariants).set({ warnings: view.warnings }).where(and(eq(socialContentVariants.id, row.id), eq(socialContentVariants.organizationId, input.organizationId)));
  await recordAuditEvent(db, { eventType: "social_variant_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_content_variant", targetId: row.id, metadata: { fields, from: existing.status, to: row.status, approvalReset: resetsApproval } });
  if (resetsApproval) await syncContentItemStatus(db, input.organizationId, row.contentItemId);
  return view;
}

export async function archiveVariant(db: Db, input: { organizationId: string; contentVariantId: string; actorUserId: string; expectedRevision: number }): Promise<SocialVariant> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageContentAuthority(db, ctx, "social_content_variant", input.contentVariantId);
  const existing = await resolveVariantRow(db, input.organizationId, input.contentVariantId);
  if (existing.archivedAt) return variantView(db, input.organizationId, existing);
  if (existing.status === "publishing") throw new InvalidSocialTransitionError("post", existing.status, "archived");
  if (existing.revision !== input.expectedRevision) throw new StaleSocialUpdateError("post");
  await cancelActiveJobs(db, input.organizationId, existing.id);
  const now = new Date();
  const [row] = await db
    .update(socialContentVariants)
    .set({ status: existing.status === "published" ? "published" : "archived", archivedAt: now, updatedAt: now, revision: existing.revision + 1 })
    .where(and(eq(socialContentVariants.id, existing.id), eq(socialContentVariants.organizationId, input.organizationId), eq(socialContentVariants.revision, existing.revision)))
    .returning();
  if (!row) throw new StaleSocialUpdateError("post");
  if (existing.status === "ready_for_review") await closeStaleApproval(db, input.organizationId, existing.approvalRequestId, input.actorUserId);
  await recordAuditEvent(db, { eventType: "social_variant_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_content_variant", targetId: row.id, metadata: { action: "archived", from: existing.status } });
  await syncContentItemStatus(db, input.organizationId, row.contentItemId);
  return variantView(db, input.organizationId, row);
}

// ---------------------------------------------------------------------------
// Lifecycle: review, decisions, scheduling
// ---------------------------------------------------------------------------

async function casVariantStatus(db: Db, organizationId: string, existing: SocialVariantRow, expectedRevision: number, fromStatuses: readonly SocialVariantStatus[], set: Partial<typeof socialContentVariants.$inferInsert>): Promise<SocialVariantRow> {
  if (!fromStatuses.includes(existing.status) || existing.archivedAt) throw new InvalidSocialTransitionError("post", existing.status, String(set.status ?? "updated"));
  const [row] = await db
    .update(socialContentVariants)
    .set({ ...set, revision: expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(socialContentVariants.id, existing.id), eq(socialContentVariants.organizationId, organizationId), eq(socialContentVariants.revision, expectedRevision), inArray(socialContentVariants.status, [...fromStatuses])))
    .returning();
  if (!row) throw new StaleSocialUpdateError("post");
  return row;
}

export async function submitVariantForReview(db: Db, input: { organizationId: string; contentVariantId: string; actorUserId: string; expectedRevision: number; summary?: string }): Promise<SocialVariant> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageContentAuthority(db, ctx, "social_content_variant", input.contentVariantId);
  const existing = await resolveVariantRow(db, input.organizationId, input.contentVariantId);
  if (!(["draft", "changes_requested"] as SocialVariantStatus[]).includes(existing.status) || existing.archivedAt) throw new InvalidSocialTransitionError("post", existing.status, "ready_for_review");
  const warnings = await computeStoredVariantWarnings(db, input.organizationId, existing, {}, { checkSchedule: true });
  const blockers = blockingMessages(warnings);
  if (blockers.length) throw new SocialVariantNotPublishableError(blockers);

  const item = await resolveItemRow(db, input.organizationId, existing.contentItemId);
  const row = await casVariantStatus(db, input.organizationId, existing, input.expectedRevision, ["draft", "changes_requested"], { status: "ready_for_review", warnings, approvalRequestId: null, approvedAt: null, approvedByUserId: null });
  const platformLabel = SOCIAL_PLATFORM_LABELS[asOrganicPlatform(row.platform)];
  const summary = (input.summary?.trim() || `${platformLabel} post for "${item.title}"${row.scheduledFor ? ` — planned for ${row.scheduledFor.toISOString()}` : ""}: ${row.body.slice(0, 280)}`).slice(0, 2000);
  try {
    await requestVariantApproval(db, { organizationId: input.organizationId, contentVariantId: row.id, summary, actorUserId: input.actorUserId });
  } catch (err) {
    // Do not leave a variant "awaiting review" with no approval behind it.
    await db.update(socialContentVariants).set({ status: existing.status, revision: row.revision + 1, updatedAt: new Date() }).where(and(eq(socialContentVariants.id, row.id), eq(socialContentVariants.organizationId, input.organizationId), eq(socialContentVariants.revision, row.revision)));
    throw err;
  }
  await recordAuditEvent(db, { eventType: "social_variant_submitted_for_review", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_content_variant", targetId: row.id, metadata: { contentItemId: row.contentItemId, platform: row.platform, warnings: warnings.length } });
  await syncContentItemStatus(db, input.organizationId, row.contentItemId);
  return variantView(db, input.organizationId, await resolveVariantRow(db, input.organizationId, row.id));
}

/**
 * The human decision on a variant awaiting review. Requires
 * `marketing_approve_content`; scheduling/publishing as part of the
 * approval additionally requires `marketing_publish`. The runtime approval
 * is decided first (same model as every other approval in LYNQ); when it
 * was already decided elsewhere (Founder Approval Center), its decision
 * must match.
 */
export async function decideVariantApproval(
  db: Db,
  input: { organizationId: string; contentVariantId: string; actorUserId: string; expectedRevision: number; decision: "approve" | "request_changes" | "reject"; note?: string; scheduledFor?: Date | null; publishNow?: boolean }
): Promise<SocialVariant> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingApproveContentAuthority(db, ctx, "social_content_variant", input.contentVariantId);
  const existing = await resolveVariantRow(db, input.organizationId, input.contentVariantId);
  if (existing.status !== "ready_for_review" || existing.archivedAt) throw new InvalidSocialTransitionError("post", existing.status, input.decision);
  if (existing.revision !== input.expectedRevision) throw new StaleSocialUpdateError("post");
  if (!existing.approvalRequestId) throw new SocialApprovalRequiredError("deciding this post (it has no approval request — resubmit it)");
  const note = input.note?.trim().slice(0, 2000) || null;
  const platform = asOrganicPlatform(existing.platform);

  const explicitSchedule = input.decision === "approve" && (input.publishNow || (input.scheduledFor !== undefined && input.scheduledFor !== null));
  if (explicitSchedule) {
    await requireMarketingPublishAuthority(db, ctx, "social_content_variant", existing.id);
    if (!input.publishNow && input.scheduledFor) assertScheduleWindow(platform, input.scheduledFor);
  }
  if (input.decision === "approve") {
    const blockers = blockingMessages(await computeStoredVariantWarnings(db, input.organizationId, existing, {}, { checkSchedule: false }));
    if (blockers.length) throw new SocialVariantNotPublishableError(blockers);
  }

  const [approval] = await db.select().from(agentApprovalRequests).where(and(eq(agentApprovalRequests.id, existing.approvalRequestId), eq(agentApprovalRequests.organizationId, input.organizationId)));
  const wanted = input.decision === "approve" ? "approved" : input.decision === "reject" ? "rejected" : "revision_requested";
  if (approval?.status === "pending") {
    const decide = { organizationId: input.organizationId, approvalId: approval.id, decisionNote: note, actorUserId: input.actorUserId };
    if (input.decision === "approve") await approveRequest(db, decide);
    else if (input.decision === "reject") await rejectRequest(db, decide);
    else await requestRevision(db, decide);
  } else if (!approval || approval.status !== wanted) {
    throw new InvalidSocialTransitionError("approval", approval?.status ?? "missing", wanted);
  }

  const now = new Date();
  let row: SocialVariantRow;
  if (input.decision === "approve") {
    row = await casVariantStatus(db, input.organizationId, existing, input.expectedRevision, ["ready_for_review"], { status: "approved", approvedByUserId: input.actorUserId, approvedAt: now, reviewNote: note, ...(input.scheduledFor ? { scheduledFor: input.scheduledFor } : {}) });
    await recordAuditEvent(db, { eventType: "social_variant_approved", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_content_variant", targetId: row.id, metadata: { approvalRequestId: approval.id, publishNow: Boolean(input.publishNow), scheduledFor: input.scheduledFor?.toISOString() ?? row.scheduledFor?.toISOString() ?? null } });

    if (input.publishNow) {
      await enqueuePublish(db, { organizationId: input.organizationId, contentVariantId: row.id, actorUserId: input.actorUserId, now: true });
    } else {
      const target = input.scheduledFor === undefined ? row.scheduledFor : input.scheduledFor;
      // An implicit schedule (the date already on the post) is applied only when it is still valid and the approver may publish; otherwise the post stays approved for someone to schedule.
      const canSchedule = target && (explicitSchedule || (hasMarketingCapability(ctx, "marketing_publish") && !scheduleWarning(platform, target)));
      if (target && canSchedule) await enqueuePublish(db, { organizationId: input.organizationId, contentVariantId: row.id, actorUserId: input.actorUserId, scheduledFor: target });
    }
  } else if (input.decision === "request_changes") {
    row = await casVariantStatus(db, input.organizationId, existing, input.expectedRevision, ["ready_for_review"], { status: "changes_requested", reviewNote: note });
    await recordAuditEvent(db, { eventType: "social_variant_changes_requested", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_content_variant", targetId: row.id, metadata: { approvalRequestId: approval.id } });
  } else {
    row = await casVariantStatus(db, input.organizationId, existing, input.expectedRevision, ["ready_for_review"], { status: "rejected", reviewNote: note });
    await recordAuditEvent(db, { eventType: "social_variant_rejected", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_content_variant", targetId: row.id, metadata: { approvalRequestId: approval.id } });
  }
  await syncContentItemStatus(db, input.organizationId, row.contentItemId);
  return variantView(db, input.organizationId, await resolveVariantRow(db, input.organizationId, row.id));
}

export async function returnVariantToDraft(db: Db, input: { organizationId: string; contentVariantId: string; actorUserId: string; expectedRevision: number }): Promise<SocialVariant> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageContentAuthority(db, ctx, "social_content_variant", input.contentVariantId);
  const existing = await resolveVariantRow(db, input.organizationId, input.contentVariantId);
  const row = await casVariantStatus(db, input.organizationId, existing, input.expectedRevision, ["rejected", "changes_requested"], { status: "draft", approvalRequestId: null, approvedAt: null, approvedByUserId: null });
  await recordAuditEvent(db, { eventType: "social_variant_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_content_variant", targetId: row.id, metadata: { action: "returned_to_draft", from: existing.status } });
  await syncContentItemStatus(db, input.organizationId, row.contentItemId);
  return variantView(db, input.organizationId, row);
}

export async function scheduleVariant(db: Db, input: { organizationId: string; contentVariantId: string; actorUserId: string; expectedRevision: number; scheduledFor: Date }): Promise<SocialVariant> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingPublishAuthority(db, ctx, "social_content_variant", input.contentVariantId);
  const existing = await resolveVariantRow(db, input.organizationId, input.contentVariantId);
  if (existing.status !== "approved" || existing.archivedAt) throw new InvalidSocialTransitionError("post", existing.status, "scheduled");
  assertScheduleWindow(asOrganicPlatform(existing.platform), input.scheduledFor);
  const row = await casVariantStatus(db, input.organizationId, existing, input.expectedRevision, ["approved"], { scheduledFor: input.scheduledFor });
  await enqueuePublish(db, { organizationId: input.organizationId, contentVariantId: row.id, actorUserId: input.actorUserId, scheduledFor: input.scheduledFor });
  return variantView(db, input.organizationId, await resolveVariantRow(db, input.organizationId, row.id));
}

export async function unscheduleVariant(db: Db, input: { organizationId: string; contentVariantId: string; actorUserId: string; expectedRevision: number }): Promise<SocialVariant> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingPublishAuthority(db, ctx, "social_content_variant", input.contentVariantId);
  const existing = await resolveVariantRow(db, input.organizationId, input.contentVariantId);
  if (existing.status !== "scheduled" || existing.archivedAt) throw new InvalidSocialTransitionError("post", existing.status, "approved");
  if (existing.revision !== input.expectedRevision) throw new StaleSocialUpdateError("post");
  await cancelActiveJobs(db, input.organizationId, existing.id);
  const fresh = await resolveVariantRow(db, input.organizationId, existing.id);
  const row = await casVariantStatus(db, input.organizationId, fresh, fresh.revision, ["scheduled"], { status: "approved" });
  await recordAuditEvent(db, { eventType: "social_variant_unscheduled", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_content_variant", targetId: row.id });
  await syncContentItemStatus(db, input.organizationId, row.contentItemId);
  return variantView(db, input.organizationId, row);
}

export async function publishVariantNow(db: Db, input: { organizationId: string; contentVariantId: string; actorUserId: string; expectedRevision: number }): Promise<SocialVariant> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingPublishAuthority(db, ctx, "social_content_variant", input.contentVariantId);
  const existing = await resolveVariantRow(db, input.organizationId, input.contentVariantId);
  if (!(["approved", "scheduled", "failed"] as SocialVariantStatus[]).includes(existing.status) || existing.archivedAt) throw new InvalidSocialTransitionError("post", existing.status, "publishing");
  if (existing.revision !== input.expectedRevision) throw new StaleSocialUpdateError("post");
  if (existing.status === "scheduled") await cancelActiveJobs(db, input.organizationId, existing.id);
  await enqueuePublish(db, { organizationId: input.organizationId, contentVariantId: existing.id, actorUserId: input.actorUserId, now: true });
  return variantView(db, input.organizationId, await resolveVariantRow(db, input.organizationId, existing.id));
}

export interface SocialPendingApproval {
  variant: SocialVariant;
  contentItemId: string;
  title: string;
  brandProfileId: string | null;
  brandName: string | null;
  brief: SocialContentBrief;
  assets: { id: string; title: string; assetType: string; contentType: string; width: number | null; height: number | null; previewUrl: string }[];
  submittedAt: Date;
}

/** Everything awaiting a human decision — for the Approval Center and the founder's phone. */
export async function listPendingApprovals(db: Db, input: { organizationId: string; actorUserId: string; brandProfileId?: string }): Promise<SocialPendingApproval[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "social_content_variant", "approvals");
  const conditions = [eq(socialContentVariants.organizationId, input.organizationId), eq(socialContentVariants.status, "ready_for_review"), isNull(socialContentVariants.archivedAt)];
  if (input.brandProfileId) conditions.push(eq(marketingContentItems.brandProfileId, input.brandProfileId));
  const rows = await db
    .select({ variant: socialContentVariants, item: marketingContentItems })
    .from(socialContentVariants)
    .innerJoin(marketingContentItems, and(eq(marketingContentItems.id, socialContentVariants.contentItemId), eq(marketingContentItems.organizationId, socialContentVariants.organizationId)))
    .where(and(...conditions))
    .orderBy(asc(socialContentVariants.updatedAt))
    .limit(200);
  const items = [...new Map(rows.map((r) => [r.item.id, r.item])).values()];
  const ctxW = await loadWarningContext(db, input.organizationId, rows.map((r) => r.variant), items);
  return rows.map(({ variant, item }) => {
    const media = parseMedia(variant.media);
    return {
      variant: toVariant(variant, variant.channelAccountId ? (ctxW.accounts.get(variant.channelAccountId) ?? null) : null, warningsFor(variant, ctxW)),
      contentItemId: item.id,
      title: item.title,
      brandProfileId: item.brandProfileId,
      brandName: ctxW.brandsByItem.get(item.id)?.name ?? null,
      brief: parseBrief(item.brief),
      assets: media
        .map((m) => ctxW.assets.get(m.assetId))
        .filter((a): a is AssetRow => Boolean(a))
        .map((a) => ({ id: a.id, title: a.title, assetType: a.assetType, contentType: a.contentType, width: a.width, height: a.height, previewUrl: assetPreviewPath(input.organizationId, a.id) })),
      submittedAt: variant.updatedAt,
    };
  });
}

// ---------------------------------------------------------------------------
// Internal: publish outcomes (called by publishing.ts)
// ---------------------------------------------------------------------------

export async function recordVariantPublished(db: Db, input: { organizationId: string; contentVariantId: string; externalPostId: string; externalPostUrl: string | null; publishedAt: Date; publishJobId?: string }): Promise<void> {
  const existing = await resolveVariantRow(db, input.organizationId, input.contentVariantId);
  await db
    .update(socialContentVariants)
    .set({ status: "published", externalPostId: input.externalPostId, externalPostUrl: input.externalPostUrl, publishedAt: input.publishedAt, revision: existing.revision + 1, updatedAt: new Date() })
    .where(and(eq(socialContentVariants.id, existing.id), eq(socialContentVariants.organizationId, input.organizationId)));
  await recordAuditEvent(db, { eventType: "social_variant_published", organizationId: input.organizationId, targetType: "social_content_variant", targetId: existing.id, metadata: { externalPostId: input.externalPostId, externalPostUrl: input.externalPostUrl, publishJobId: input.publishJobId ?? null, platform: existing.platform } });
  await syncContentItemStatus(db, input.organizationId, existing.contentItemId);
}

export async function recordVariantPublishFailed(db: Db, input: { organizationId: string; contentVariantId: string; code: string; message: string; publishJobId?: string }): Promise<void> {
  const existing = await resolveVariantRow(db, input.organizationId, input.contentVariantId);
  if (existing.status === "published" || existing.archivedAt) return;
  await db
    .update(socialContentVariants)
    .set({ status: "failed", revision: existing.revision + 1, updatedAt: new Date() })
    .where(and(eq(socialContentVariants.id, existing.id), eq(socialContentVariants.organizationId, input.organizationId)));
  await recordAuditEvent(db, { eventType: "social_variant_publish_failed", organizationId: input.organizationId, targetType: "social_content_variant", targetId: existing.id, metadata: { code: input.code, message: input.message.slice(0, 500), publishJobId: input.publishJobId ?? null, platform: existing.platform } });
  await syncContentItemStatus(db, input.organizationId, existing.contentItemId);
}
