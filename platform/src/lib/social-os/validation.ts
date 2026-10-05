import { z } from "zod";

/**
 * Module 19 — Social Command Center. The closed vocabularies every service,
 * route, worker and page in `social-os` validates against. Each `as const`
 * array mirrors a `pgEnum` in `src/db/schema.ts` exactly; the zod schemas
 * are the only way untrusted input (forms, JSON bodies, provider payloads,
 * LLM output) becomes a typed value.
 */

export const SOCIAL_PLATFORMS = ["facebook", "instagram", "linkedin", "tiktok", "youtube", "x", "meta_ads", "google_ads", "linkedin_ads"] as const;
export const socialPlatformSchema = z.enum(SOCIAL_PLATFORMS);
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

/** Organic publishing platforms (the ones a content variant can target). */
export const SOCIAL_ORGANIC_PLATFORMS = ["facebook", "instagram", "linkedin", "tiktok", "youtube", "x"] as const satisfies readonly SocialPlatform[];
export const socialOrganicPlatformSchema = z.enum(SOCIAL_ORGANIC_PLATFORMS);
export type SocialOrganicPlatform = (typeof SOCIAL_ORGANIC_PLATFORMS)[number];

/** Advertising platforms (ad accounts). */
export const SOCIAL_AD_PLATFORMS = ["meta_ads", "google_ads", "linkedin_ads"] as const satisfies readonly SocialPlatform[];
export const socialAdPlatformSchema = z.enum(SOCIAL_AD_PLATFORMS);
export type SocialAdPlatform = (typeof SOCIAL_AD_PLATFORMS)[number];

/** Which OAuth provider (an `integration_connections.provider`) owns each platform. */
export const SOCIAL_PLATFORM_PROVIDER: Record<SocialPlatform, "meta" | "linkedin" | "google_ads" | null> = {
  facebook: "meta",
  instagram: "meta",
  meta_ads: "meta",
  linkedin: "linkedin",
  linkedin_ads: "linkedin",
  google_ads: "google_ads",
  tiktok: null,
  youtube: null,
  x: null,
};

export const SOCIAL_PLATFORM_LABELS: Record<SocialPlatform, string> = {
  facebook: "Facebook Page",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X",
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  linkedin_ads: "LinkedIn Ads",
};

/**
 * Honest account connection states. `manual` is the pre-Module-19 default
 * (tracked by hand). The UI shows exactly these — never "Connected" because
 * a row exists.
 */
export const SOCIAL_ACCOUNT_CONNECTION_STATUSES = ["manual", "connected", "authorization_required", "token_expired", "missing_configuration", "error", "not_supported", "disconnected"] as const;
export const socialAccountConnectionStatusSchema = z.enum(SOCIAL_ACCOUNT_CONNECTION_STATUSES);
export type SocialAccountConnectionStatus = (typeof SOCIAL_ACCOUNT_CONNECTION_STATUSES)[number];

export const SOCIAL_ACCOUNT_KINDS = ["organic", "paid"] as const;
export const socialAccountKindSchema = z.enum(SOCIAL_ACCOUNT_KINDS);
export type SocialAccountKind = (typeof SOCIAL_ACCOUNT_KINDS)[number];

export const SOCIAL_VARIANT_STATUSES = ["draft", "generating", "ready_for_review", "changes_requested", "approved", "scheduled", "publishing", "published", "failed", "rejected", "archived"] as const;
export const socialVariantStatusSchema = z.enum(SOCIAL_VARIANT_STATUSES);
export type SocialVariantStatus = (typeof SOCIAL_VARIANT_STATUSES)[number];

/** Calendar/approval states, in the order the product talks about them. */
export const SOCIAL_CALENDAR_STATES = ["idea", "draft", "generating", "ready_for_review", "changes_requested", "approved", "scheduled", "publishing", "published", "failed"] as const;
export type SocialCalendarState = (typeof SOCIAL_CALENDAR_STATES)[number];

export const SOCIAL_PUBLISH_JOB_STATUSES = ["queued", "processing", "published", "failed", "retrying", "cancelled"] as const;
export const socialPublishJobStatusSchema = z.enum(SOCIAL_PUBLISH_JOB_STATUSES);
export type SocialPublishJobStatus = (typeof SOCIAL_PUBLISH_JOB_STATUSES)[number];

export const SOCIAL_ASSET_TYPES = ["image", "video", "logo", "brand_file", "thumbnail", "document"] as const;
export const socialAssetTypeSchema = z.enum(SOCIAL_ASSET_TYPES);
export type SocialAssetType = (typeof SOCIAL_ASSET_TYPES)[number];

export const SOCIAL_ASSET_SOURCES = ["uploaded", "generated", "rendered", "external"] as const;
export const socialAssetSourceSchema = z.enum(SOCIAL_ASSET_SOURCES);
export type SocialAssetSource = (typeof SOCIAL_ASSET_SOURCES)[number];

export const SOCIAL_GENERATION_TYPES = ["text", "image", "video", "strategy", "plan", "reply_draft", "analysis", "manager_task"] as const;
export const socialGenerationTypeSchema = z.enum(SOCIAL_GENERATION_TYPES);
export type SocialGenerationType = (typeof SOCIAL_GENERATION_TYPES)[number];

export const SOCIAL_GENERATION_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export const socialGenerationStatusSchema = z.enum(SOCIAL_GENERATION_STATUSES);
export type SocialGenerationStatus = (typeof SOCIAL_GENERATION_STATUSES)[number];

export const SOCIAL_ENGAGEMENT_TYPES = ["comment", "mention", "direct_message", "review"] as const;
export const socialEngagementTypeSchema = z.enum(SOCIAL_ENGAGEMENT_TYPES);
export type SocialEngagementType = (typeof SOCIAL_ENGAGEMENT_TYPES)[number];

export const SOCIAL_ENGAGEMENT_STATUSES = ["new", "needs_reply", "reply_drafted", "replied", "ignored", "hidden", "escalated"] as const;
export const socialEngagementStatusSchema = z.enum(SOCIAL_ENGAGEMENT_STATUSES);
export type SocialEngagementStatus = (typeof SOCIAL_ENGAGEMENT_STATUSES)[number];

export const SOCIAL_SENTIMENTS = ["positive", "neutral", "negative", "mixed"] as const;
export const socialSentimentSchema = z.enum(SOCIAL_SENTIMENTS);
export const SOCIAL_ENGAGEMENT_CATEGORIES = ["question", "praise", "complaint", "lead", "spam", "other"] as const;
export const socialEngagementCategorySchema = z.enum(SOCIAL_ENGAGEMENT_CATEGORIES);

export const SOCIAL_AD_CHANGE_TYPES = ["create_campaign", "update_budget", "pause_campaign", "resume_campaign", "update_targeting", "create_ad_set", "create_ad"] as const;
export const socialAdChangeTypeSchema = z.enum(SOCIAL_AD_CHANGE_TYPES);
export type SocialAdChangeType = (typeof SOCIAL_AD_CHANGE_TYPES)[number];

export const SOCIAL_AD_CHANGE_STATUSES = ["proposed", "pending_approval", "approved", "rejected", "executing", "executed", "failed", "cancelled"] as const;
export const socialAdChangeStatusSchema = z.enum(SOCIAL_AD_CHANGE_STATUSES);
export type SocialAdChangeStatus = (typeof SOCIAL_AD_CHANGE_STATUSES)[number];

export const SOCIAL_AUTOMATION_KINDS = ["weekly_plan", "daily_attention", "metrics_sync", "engagement_sync", "token_watch", "reply_drafts"] as const;
export const socialAutomationKindSchema = z.enum(SOCIAL_AUTOMATION_KINDS);
export type SocialAutomationKind = (typeof SOCIAL_AUTOMATION_KINDS)[number];

/** Default cadence and human description for each automation kind. Intervals are bounded so a rule can never hammer a provider. */
export const SOCIAL_AUTOMATION_DEFAULTS: Record<SocialAutomationKind, { label: string; description: string; intervalMinutes: number; minIntervalMinutes: number }> = {
  weekly_plan: { label: "Weekly draft calendar", description: "Every week, prepare next week's draft posts for approval. Never publishes.", intervalMinutes: 10080, minIntervalMinutes: 1440 },
  daily_attention: { label: "Daily attention check", description: "Every morning, compute what needs attention and record it for the daily brief.", intervalMinutes: 1440, minIntervalMinutes: 360 },
  metrics_sync: { label: "Performance sync", description: "Pull account and post performance from connected platforms.", intervalMinutes: 360, minIntervalMinutes: 60 },
  engagement_sync: { label: "Engagement sync", description: "Pull new comments and mentions into the inbox.", intervalMinutes: 60, minIntervalMinutes: 15 },
  token_watch: { label: "Token expiry watch", description: "Flag accounts whose authorization expires soon and record an attention item.", intervalMinutes: 1440, minIntervalMinutes: 360 },
  reply_drafts: { label: "Suggested replies", description: "Draft a suggested reply for new engagement items. Never sends.", intervalMinutes: 120, minIntervalMinutes: 30 },
};

export const SOCIAL_MANAGER_MESSAGE_ROLES = ["user", "assistant", "tool", "system"] as const;
export type SocialManagerMessageRole = (typeof SOCIAL_MANAGER_MESSAGE_ROLES)[number];

// ---------------------------------------------------------------------------
// Variant formats and per-platform constraints (official platform limits;
// enforced before approval so a reviewer never approves something the
// platform will reject).
// ---------------------------------------------------------------------------

export const SOCIAL_VARIANT_FORMATS = ["text", "image", "carousel", "story", "reel", "short_video", "video", "article", "link"] as const;
export const socialVariantFormatSchema = z.enum(SOCIAL_VARIANT_FORMATS);
export type SocialVariantFormat = (typeof SOCIAL_VARIANT_FORMATS)[number];

export interface SocialPlatformRules {
  maxBodyLength: number;
  maxHashtags: number;
  formats: readonly SocialVariantFormat[];
  /** Formats that need at least one media asset. */
  mediaRequiredFormats: readonly SocialVariantFormat[];
  maxCarouselItems: number;
  /** Platform scheduling rules: Facebook Pages can schedule natively; the rest are scheduled by our queue. */
  nativeScheduling: boolean;
  /** Min/max lead time (minutes) for a scheduled publish. Facebook's native window is 10 min–30 days; our queue accepts up to a year. */
  minScheduleLeadMinutes: number;
  maxScheduleLeadMinutes: number;
  imageContentTypes: readonly string[];
}

export const SOCIAL_PLATFORM_RULES: Record<SocialOrganicPlatform, SocialPlatformRules> = {
  facebook: { maxBodyLength: 63206, maxHashtags: 30, formats: ["text", "image", "carousel", "video", "link"], mediaRequiredFormats: ["image", "carousel", "video"], maxCarouselItems: 10, nativeScheduling: true, minScheduleLeadMinutes: 10, maxScheduleLeadMinutes: 60 * 24 * 30, imageContentTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"] },
  instagram: { maxBodyLength: 2200, maxHashtags: 30, formats: ["image", "carousel", "story", "reel"], mediaRequiredFormats: ["image", "carousel", "story", "reel"], maxCarouselItems: 10, nativeScheduling: false, minScheduleLeadMinutes: 1, maxScheduleLeadMinutes: 60 * 24 * 365, imageContentTypes: ["image/jpeg"] },
  linkedin: { maxBodyLength: 3000, maxHashtags: 30, formats: ["text", "image", "carousel", "video", "article", "link"], mediaRequiredFormats: ["image", "carousel", "video"], maxCarouselItems: 20, nativeScheduling: false, minScheduleLeadMinutes: 1, maxScheduleLeadMinutes: 60 * 24 * 365, imageContentTypes: ["image/jpeg", "image/png", "image/gif"] },
  tiktok: { maxBodyLength: 2200, maxHashtags: 30, formats: ["short_video"], mediaRequiredFormats: ["short_video"], maxCarouselItems: 1, nativeScheduling: false, minScheduleLeadMinutes: 1, maxScheduleLeadMinutes: 60 * 24 * 365, imageContentTypes: [] },
  youtube: { maxBodyLength: 5000, maxHashtags: 15, formats: ["short_video", "video"], mediaRequiredFormats: ["short_video", "video"], maxCarouselItems: 1, nativeScheduling: true, minScheduleLeadMinutes: 1, maxScheduleLeadMinutes: 60 * 24 * 365, imageContentTypes: ["image/jpeg", "image/png"] },
  x: { maxBodyLength: 280, maxHashtags: 5, formats: ["text", "image", "video", "link"], mediaRequiredFormats: ["image", "video"], maxCarouselItems: 4, nativeScheduling: false, minScheduleLeadMinutes: 1, maxScheduleLeadMinutes: 60 * 24 * 365, imageContentTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"] },
};

// ---------------------------------------------------------------------------
// Brand profile
// ---------------------------------------------------------------------------

export const brandColorSchema = z.object({ name: z.string().trim().min(1).max(40), hex: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/), role: z.string().trim().max(40).default("") }).strict();
export const brandVisualIdentitySchema = z
  .object({
    colors: z.array(brandColorSchema).max(12).default([]),
    typography: z.object({ heading: z.string().trim().max(80).default(""), body: z.string().trim().max(80).default("") }).strict().default({ heading: "", body: "" }),
    logoAssetIds: z.array(z.string().uuid()).max(10).default([]),
    notes: z.string().trim().max(2000).default(""),
  })
  .strict();
export type BrandVisualIdentity = z.infer<typeof brandVisualIdentitySchema>;

const shortStringList = (max: number, itemMax = 200) => z.array(z.string().trim().min(1).max(itemMax)).max(max);

export const brandObjectiveSchema = z.object({ key: z.string().trim().min(1).max(60), description: z.string().trim().min(1).max(300), target: z.string().trim().max(120).default("") }).strict();

export const brandProfileInputSchema = z
  .object({
    brandKey: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, "lowercase letters, digits and hyphens"),
    name: z.string().trim().min(1).max(120),
    positioning: z.string().trim().max(4000).default(""),
    audience: z.string().trim().max(4000).default(""),
    voice: z.string().trim().max(4000).default(""),
    visualRules: z.string().trim().max(4000).default(""),
    productContext: z.string().trim().max(6000).default(""),
    claimsGuardrails: z.string().trim().max(4000).default(""),
    callsToAction: shortStringList(20).default([]),
    approvedExamples: shortStringList(20, 2000).default([]),
    companyInfo: z.string().trim().max(6000).default(""),
    brandStory: z.string().trim().max(6000).default(""),
    writingStyle: z.string().trim().max(4000).default(""),
    visualIdentity: brandVisualIdentitySchema.default({ colors: [], typography: { heading: "", body: "" }, logoAssetIds: [], notes: "" }),
    websites: z.array(z.string().trim().url().max(300)).max(10).default([]),
    competitors: shortStringList(20).default([]),
    contentPillars: shortStringList(12).default([]),
    preferredPlatforms: z.array(socialPlatformSchema).max(SOCIAL_PLATFORMS.length).default([]),
    prohibitedLanguage: shortStringList(50).default([]),
    neverClaim: shortStringList(50).default([]),
    geographicMarket: z.string().trim().max(300).default(""),
    objectives: z.array(brandObjectiveSchema).max(10).default([]),
  })
  .strict();
export type BrandProfileInput = z.infer<typeof brandProfileInputSchema>;
export const brandProfileUpdateSchema = brandProfileInputSchema.partial().omit({ brandKey: true }).strict();
export type BrandProfileUpdate = z.infer<typeof brandProfileUpdateSchema>;

// ---------------------------------------------------------------------------
// Content brief (shared across variants) and variants
// ---------------------------------------------------------------------------

export const SOCIAL_CONTENT_OBJECTIVES = ["awareness", "engagement", "leads", "education", "announcement", "recruitment", "community", "promotion", "founder_voice", "case_study", "client_success", "other"] as const;
export const socialContentObjectiveSchema = z.enum(SOCIAL_CONTENT_OBJECTIVES);

export const SOCIAL_CONTENT_KINDS = ["text_post", "image_post", "carousel", "story", "short_video_concept", "video_script", "generated_video", "promotional", "educational", "founder_post", "product_announcement", "case_study", "client_success", "engagement_post", "ad_copy", "ad_creative_concept"] as const;
export const socialContentKindSchema = z.enum(SOCIAL_CONTENT_KINDS);
export type SocialContentKind = (typeof SOCIAL_CONTENT_KINDS)[number];

export const socialShotSchema = z.object({ timing: z.string().trim().max(40), visual: z.string().trim().max(600), onScreenText: z.string().trim().max(200).default(""), audio: z.string().trim().max(300).default("") }).strict();

export const socialContentBriefSchema = z
  .object({
    kind: socialContentKindSchema.default("text_post"),
    objective: socialContentObjectiveSchema.default("engagement"),
    audience: z.string().trim().max(1000).default(""),
    topic: z.string().trim().max(2000).default(""),
    tone: z.string().trim().max(200).default(""),
    callToAction: z.string().trim().max(300).default(""),
    creativeDirection: z.string().trim().max(3000).default(""),
    hook: z.string().trim().max(400).default(""),
    script: z.string().trim().max(8000).default(""),
    shots: z.array(socialShotSchema).max(24).default([]),
    sourceText: z.string().trim().max(12000).default(""),
    keyPoints: shortStringList(12, 400).default([]),
    researchNotes: z.string().trim().max(6000).default(""),
  })
  .strict();
export type SocialContentBrief = z.infer<typeof socialContentBriefSchema>;

export const socialVariantMediaSchema = z.array(z.object({ assetId: z.string().uuid(), position: z.number().int().min(0).max(49), role: z.enum(["primary", "carousel_item", "cover", "thumbnail"]).default("primary") }).strict()).max(50);
export type SocialVariantMedia = z.infer<typeof socialVariantMediaSchema>;

export const socialVariantPlatformOptionsSchema = z
  .object({
    firstComment: z.string().trim().max(2200).optional(),
    title: z.string().trim().max(100).optional(),
    altText: z.string().trim().max(1000).optional(),
    shareToFeed: z.boolean().optional(),
    linkTitle: z.string().trim().max(200).optional(),
    visibility: z.enum(["public", "connections", "unlisted", "private"]).optional(),
  })
  .strict();
export type SocialVariantPlatformOptions = z.infer<typeof socialVariantPlatformOptionsSchema>;

export const socialVariantInputSchema = z
  .object({
    platform: socialOrganicPlatformSchema,
    channelAccountId: z.string().uuid().nullable().optional(),
    format: socialVariantFormatSchema.default("text"),
    hook: z.string().trim().max(400).default(""),
    body: z.string().trim().max(63206).default(""),
    hashtags: z.array(z.string().trim().regex(/^#?[\p{L}\p{N}_]{1,100}$/u)).max(30).default([]),
    callToAction: z.string().trim().max(300).default(""),
    linkUrl: z.string().trim().url().max(2000).nullable().optional(),
    media: socialVariantMediaSchema.default([]),
    platformOptions: socialVariantPlatformOptionsSchema.default({}),
    scheduledFor: z.coerce.date().nullable().optional(),
  })
  .strict();
export type SocialVariantInput = z.infer<typeof socialVariantInputSchema>;
export const socialVariantUpdateSchema = socialVariantInputSchema.partial().omit({ platform: true }).strict();
export type SocialVariantUpdate = z.infer<typeof socialVariantUpdateSchema>;

export const socialWarningSchema = z.object({ code: z.string().min(1).max(60), message: z.string().min(1).max(400), severity: z.enum(["info", "warning", "blocking"]) }).strict();
export type SocialWarning = z.infer<typeof socialWarningSchema>;

// ---------------------------------------------------------------------------
// Content creation request (Content Studio)
// ---------------------------------------------------------------------------

export const socialCreateRequestSchema = z
  .object({
    brandProfileId: z.string().uuid(),
    campaignId: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(1).max(200),
    platforms: z.array(socialOrganicPlatformSchema).min(1).max(SOCIAL_ORGANIC_PLATFORMS.length),
    brief: socialContentBriefSchema,
    scheduledFor: z.coerce.date().nullable().optional(),
    generate: z.boolean().default(true),
  })
  .strict();
export type SocialCreateRequest = z.infer<typeof socialCreateRequestSchema>;

export const SOCIAL_REGENERATE_PARTS = ["hook", "caption", "image", "scene", "voiceover", "video", "cta", "hashtags"] as const;
export const socialRegeneratePartSchema = z.enum(SOCIAL_REGENERATE_PARTS);
export type SocialRegeneratePart = (typeof SOCIAL_REGENERATE_PARTS)[number];

// ---------------------------------------------------------------------------
// Ads
// ---------------------------------------------------------------------------

const minorUnits = z.number().int().min(0).max(1_000_000_000);

export const socialAdChangePayloadSchemas = {
  create_campaign: z.object({ name: z.string().trim().min(1).max(200), objective: z.string().trim().min(1).max(60), dailyBudgetMinor: minorUnits.optional(), lifetimeBudgetMinor: minorUnits.optional(), currency: z.string().trim().length(3), startPaused: z.literal(true).default(true), channelType: z.string().trim().max(40).optional(), specialAdCategories: z.array(z.string().trim().max(60)).max(5).default([]) }).strict(),
  update_budget: z.object({ externalCampaignId: z.string().trim().min(1).max(100), dailyBudgetMinor: minorUnits.optional(), lifetimeBudgetMinor: minorUnits.optional(), currency: z.string().trim().length(3) }).strict().refine((v) => v.dailyBudgetMinor !== undefined || v.lifetimeBudgetMinor !== undefined, { message: "a daily or lifetime budget is required" }),
  pause_campaign: z.object({ externalCampaignId: z.string().trim().min(1).max(100) }).strict(),
  resume_campaign: z.object({ externalCampaignId: z.string().trim().min(1).max(100) }).strict(),
  update_targeting: z.object({ externalCampaignId: z.string().trim().min(1).max(100), externalAdSetId: z.string().trim().max(100).optional(), targeting: z.record(z.string(), z.unknown()) }).strict(),
  create_ad_set: z.object({ externalCampaignId: z.string().trim().min(1).max(100), name: z.string().trim().min(1).max(200), dailyBudgetMinor: minorUnits.optional(), currency: z.string().trim().length(3), targeting: z.record(z.string(), z.unknown()).default({}), startPaused: z.literal(true).default(true) }).strict(),
  create_ad: z.object({ externalAdSetId: z.string().trim().min(1).max(100), name: z.string().trim().min(1).max(200), creative: z.record(z.string(), z.unknown()), startPaused: z.literal(true).default(true) }).strict(),
} as const satisfies Record<SocialAdChangeType, z.ZodTypeAny>;

export function parseAdChangePayload(changeType: SocialAdChangeType, payload: unknown) {
  return socialAdChangePayloadSchemas[changeType].parse(payload);
}

/** Change types that move money or materially change delivery — always require approval, never auto-executed. */
export const SOCIAL_AD_CHANGE_TYPES_REQUIRING_APPROVAL: readonly SocialAdChangeType[] = SOCIAL_AD_CHANGE_TYPES;

// ---------------------------------------------------------------------------
// Automation config
// ---------------------------------------------------------------------------

export const socialAutomationConfigSchema = z
  .object({
    postsPerWeek: z.number().int().min(1).max(21).optional(),
    platforms: z.array(socialOrganicPlatformSchema).max(SOCIAL_ORGANIC_PLATFORMS.length).optional(),
    lookbackDays: z.number().int().min(1).max(90).optional(),
    expiryWarningDays: z.number().int().min(1).max(30).optional(),
    maxDraftsPerRun: z.number().int().min(1).max(50).optional(),
  })
  .strict();
export type SocialAutomationConfig = z.infer<typeof socialAutomationConfigSchema>;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function normalizeHashtag(raw: string): string {
  const trimmed = raw.trim().replace(/^#+/, "");
  return trimmed ? `#${trimmed}` : "";
}

export function isOrganicPlatform(platform: SocialPlatform): platform is SocialOrganicPlatform {
  return (SOCIAL_ORGANIC_PLATFORMS as readonly string[]).includes(platform);
}

export function isAdPlatform(platform: SocialPlatform): platform is SocialAdPlatform {
  return (SOCIAL_AD_PLATFORMS as readonly string[]).includes(platform);
}
