import "server-only";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { z } from "zod";
import { marketingChannelAccounts, marketingConfigurations, marketingContentItems, marketingContentPerformanceSnapshots, socialAccountMetricSnapshots, socialAssets, socialContentVariants } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { resolveMarketingAuthContext, requireMarketingGenerateContentAuthority, requireMarketingViewAuthority, type MarketingAuthContext } from "@/lib/marketing-os/authz";
import { enqueueJob } from "@/lib/runtime/queue";
import { assembleBrandContext, buildBrandContextText, requireActiveBrand, resolveBrandById, type BrandContext, type SocialBrand } from "./brands";
import { createGeneratedAsset, resolveAssetBytes, resolveAssetRow } from "./assets";
import { computeStoredVariantWarnings, createContentItem, getContentItemForUser, getVariantForUser, normalizeHashtags, resolveVariantRow, syncContentItemStatus, updateContentItem, updateVariant, type SocialContentItem, type SocialVariant } from "./content";
import { InvalidSocialTransitionError, SocialVariantNotPublishableError } from "./errors";
import { beginGeneration, completeGeneration, errorCodeFor, errorMessageFor, failGeneration, generateTextRecorded, recordProviderTask, withPrimaryMedia, type SocialGenerationDeps } from "./generation";
import { composeCaption } from "./providers/social/http";
import { estimateImageCostUsd, loadSocialAiEnv, resolveImageProvider, resolveVideoProvider } from "./providers/ai/registry";
import type { ImageGenerationRequest, VideoGenerationRequest } from "./providers/ai/types";
import {
  SOCIAL_CONTENT_KINDS,
  SOCIAL_CONTENT_OBJECTIVES,
  SOCIAL_ENGAGEMENT_CATEGORIES,
  SOCIAL_ORGANIC_PLATFORMS,
  SOCIAL_PLATFORM_LABELS,
  SOCIAL_PLATFORM_RULES,
  SOCIAL_SENTIMENTS,
  isOrganicPlatform,
  socialContentBriefSchema,
  socialOrganicPlatformSchema,
  socialVariantPlatformOptionsSchema,
  type SocialContentBrief,
  type SocialContentKind,
  type SocialOrganicPlatform,
  type SocialRegeneratePart,
  type SocialVariantFormat,
  type SocialVariantPlatformOptions,
} from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * Module 19 — Content Studio intelligence. Every entry point requires
 * `marketing_generate_content`, grounds its prompt in the brand's assembled
 * context, its recent topics (to avoid repeats) and — only where synced or
 * recorded numbers exist — the brand's recent post performance. Nothing in
 * here invents a metric, publishes, or submits for review: outputs land as
 * drafts a human reviews.
 */

export type StudioDeps = SocialGenerationDeps;

const DRAFTABLE_STATUSES = ["draft", "generating"] as const;
const PART_EDITABLE_STATUSES = ["draft", "changes_requested", "ready_for_review", "approved"] as const;

async function requireGenerate(db: Db, input: { organizationId: string; actorUserId: string }, targetType: string, targetId: string): Promise<MarketingAuthContext> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingGenerateContentAuthority(db, ctx, targetType, targetId);
  return ctx;
}

function clip(value: unknown, max: number): string {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

// ---------------------------------------------------------------------------
// Performance evidence (real numbers only)
// ---------------------------------------------------------------------------

export interface PostPerformanceEvidence {
  contentVariantId: string;
  contentItemId: string;
  title: string;
  platform: SocialOrganicPlatform;
  publishedAt: string | null;
  excerpt: string;
  metrics: { impressions: number; reach: number; views: number; likes: number; comments: number; shares: number; saves: number; clicks: number; leads: number; engagements: number; engagementRate: number | null; source: string; capturedAt: string } | null;
}

export interface AccountPerformanceEvidence {
  channelAccountId: string;
  platform: string;
  displayName: string;
  capturedAt: string;
  periodStart: string;
  periodEnd: string;
  source: string;
  followers: number | null;
  reach: number | null;
  impressions: number | null;
  views: number | null;
  engagements: number | null;
  profileViews: number | null;
  websiteClicks: number | null;
}

export interface PerformanceEvidence {
  brandProfileId: string;
  windowDays: number;
  from: string;
  to: string;
  publishedPosts: number;
  postsWithMetrics: number;
  posts: PostPerformanceEvidence[];
  accounts: AccountPerformanceEvidence[];
}

async function loadPerformanceEvidence(db: Db, input: { organizationId: string; brandProfileId: string; days: number; now: Date; limit?: number }): Promise<PerformanceEvidence> {
  const from = new Date(input.now.getTime() - input.days * 24 * 3600 * 1000);
  const variants = await db
    .select({ id: socialContentVariants.id, contentItemId: socialContentVariants.contentItemId, platform: socialContentVariants.platform, body: socialContentVariants.body, hook: socialContentVariants.hook, publishedAt: socialContentVariants.publishedAt, title: marketingContentItems.title })
    .from(socialContentVariants)
    .innerJoin(marketingContentItems, and(eq(marketingContentItems.id, socialContentVariants.contentItemId), eq(marketingContentItems.organizationId, socialContentVariants.organizationId)))
    .where(and(eq(socialContentVariants.organizationId, input.organizationId), eq(marketingContentItems.brandProfileId, input.brandProfileId), eq(socialContentVariants.status, "published"), gte(socialContentVariants.publishedAt, from)))
    .orderBy(desc(socialContentVariants.publishedAt))
    .limit(100);
  const ids = variants.map((v) => v.id);
  const snapshots = ids.length
    ? await db
        .selectDistinctOn([marketingContentPerformanceSnapshots.contentVariantId])
        .from(marketingContentPerformanceSnapshots)
        .where(and(eq(marketingContentPerformanceSnapshots.organizationId, input.organizationId), inArray(marketingContentPerformanceSnapshots.contentVariantId, ids)))
        .orderBy(marketingContentPerformanceSnapshots.contentVariantId, desc(marketingContentPerformanceSnapshots.capturedAt))
    : [];
  const snapByVariant = new Map(snapshots.map((s) => [s.contentVariantId, s]));
  const posts: PostPerformanceEvidence[] = variants.map((v) => {
    const s = snapByVariant.get(v.id);
    const engagements = s ? s.likes + s.comments + s.shares + s.saves : 0;
    const denominator = s ? Math.max(s.reach, s.impressions) : 0;
    return {
      contentVariantId: v.id,
      contentItemId: v.contentItemId,
      title: v.title,
      platform: socialOrganicPlatformSchema.safeParse(v.platform).success ? (v.platform as SocialOrganicPlatform) : "facebook",
      publishedAt: v.publishedAt?.toISOString() ?? null,
      excerpt: clip(v.hook || v.body, 160),
      metrics: s
        ? { impressions: s.impressions, reach: s.reach, views: s.views, likes: s.likes, comments: s.comments, shares: s.shares, saves: s.saves, clicks: s.clicks, leads: s.leads, engagements, engagementRate: denominator > 0 ? Math.round((engagements / denominator) * 10000) / 10000 : null, source: s.source, capturedAt: s.capturedAt.toISOString() }
        : null,
    };
  });
  posts.sort((a, b) => (b.metrics?.engagements ?? -1) - (a.metrics?.engagements ?? -1));

  const accounts = await db
    .select({ id: marketingChannelAccounts.id, platform: marketingChannelAccounts.platform, displayName: marketingChannelAccounts.displayName })
    .from(marketingChannelAccounts)
    .where(and(eq(marketingChannelAccounts.organizationId, input.organizationId), eq(marketingChannelAccounts.brandProfileId, input.brandProfileId), isNull(marketingChannelAccounts.archivedAt)));
  const accountIds = accounts.map((a) => a.id);
  const accountSnaps = accountIds.length
    ? await db
        .selectDistinctOn([socialAccountMetricSnapshots.channelAccountId])
        .from(socialAccountMetricSnapshots)
        .where(and(eq(socialAccountMetricSnapshots.organizationId, input.organizationId), inArray(socialAccountMetricSnapshots.channelAccountId, accountIds), gte(socialAccountMetricSnapshots.capturedAt, from)))
        .orderBy(socialAccountMetricSnapshots.channelAccountId, desc(socialAccountMetricSnapshots.capturedAt))
    : [];
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const limit = input.limit ?? 30;
  return {
    brandProfileId: input.brandProfileId,
    windowDays: input.days,
    from: from.toISOString(),
    to: input.now.toISOString(),
    publishedPosts: posts.length,
    postsWithMetrics: posts.filter((p) => p.metrics).length,
    posts: posts.slice(0, limit),
    accounts: accountSnaps.map((s) => ({
      channelAccountId: s.channelAccountId,
      platform: s.platform,
      displayName: accountById.get(s.channelAccountId)?.displayName ?? s.platform,
      capturedAt: s.capturedAt.toISOString(),
      periodStart: s.periodStart.toISOString(),
      periodEnd: s.periodEnd.toISOString(),
      source: s.source,
      followers: s.followers,
      reach: s.reach,
      impressions: s.impressions,
      views: s.views,
      engagements: s.engagements,
      profileViews: s.profileViews,
      websiteClicks: s.websiteClicks,
    })),
  };
}

/** Top posts with real metrics, compact, for prompt grounding. Empty when nothing has been synced or recorded. */
function topPerformers(evidence: PerformanceEvidence, n = 5) {
  return evidence.posts
    .filter((p) => p.metrics)
    .slice(0, n)
    .map((p) => ({ title: p.title, platform: p.platform, publishedAt: p.publishedAt, excerpt: p.excerpt, ...p.metrics }));
}

/** Evidence only — no model call. Requires `marketing_view`. Used by the manager's `get_performance_summary` tool. */
export async function gatherPerformanceEvidence(db: Db, input: { organizationId: string; brandProfileId: string; actorUserId: string; days?: number; now?: Date }): Promise<PerformanceEvidence> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_brand_profile", input.brandProfileId);
  await resolveBrandById(db, input.organizationId, input.brandProfileId);
  return loadPerformanceEvidence(db, { organizationId: input.organizationId, brandProfileId: input.brandProfileId, days: clampDays(input.days), now: input.now ?? new Date() });
}

function clampDays(days: number | undefined): number {
  return Math.min(Math.max(Math.floor(days ?? 30), 1), 180);
}

// ---------------------------------------------------------------------------
// Platform conventions + output fitting (pure)
// ---------------------------------------------------------------------------

export const PLATFORM_CONVENTIONS: Record<SocialOrganicPlatform, string> = {
  linkedin: "Professional, insight-led. The first line must earn the 'see more' click. Short paragraphs separated by blank lines. At most 3 relevant hashtags — no hashtag spam. Emojis rarely, never as bullets.",
  instagram: "Hook-first: the first line stops the scroll. Scannable caption with line breaks, emojis used sparingly. End with the call to action. Return 8–15 relevant hashtags (mix of broad and niche) in `hashtags` — they are posted as a separate block, never inline. Provide `platformOptions.altText` for the visual.",
  facebook: "Conversational and community-minded, as if talking to a neighbour. A genuine question invites comments. 0–3 hashtags.",
  x: "The whole post INCLUDING hashtags must fit in 280 characters. Punchy, one idea. 0–2 hashtags.",
  tiktok: "Write for a short vertical video: `body` is the short caption plus the on-screen text lines; put the spoken script and the shot list in `videoConcept`. 3–5 hashtags.",
  youtube: "Write for a video: `platformOptions.title` (≤100 chars) is required, `body` is the description (the first two lines matter most); put the script and shot list in `videoConcept`. Up to 5 hashtags.",
};

export const generatedVariantSchema = z.object({
  platform: z.string(),
  hook: z.string().default(""),
  body: z.string().default(""),
  hashtags: z.array(z.string()).default([]),
  callToAction: z.string().default(""),
  platformOptions: z.object({ firstComment: z.string().optional().nullable(), title: z.string().optional().nullable(), altText: z.string().optional().nullable() }).partial().nullable().default({}),
  imagePrompt: z.string().optional().nullable(),
  videoConcept: z
    .object({
      hook: z.string().default(""),
      script: z.string().default(""),
      shots: z.array(z.object({ timing: z.string().default(""), visual: z.string().default(""), onScreenText: z.string().default(""), audio: z.string().default("") })).default([]),
    })
    .optional()
    .nullable(),
});
export type GeneratedVariant = z.infer<typeof generatedVariantSchema>;
export const variantGenerationOutputSchema = z.object({ variants: z.array(generatedVariantSchema).min(1).max(12) });

const SHOT_JSON_SCHEMA = { type: "object", properties: { timing: { type: "string" }, visual: { type: "string" }, onScreenText: { type: "string" }, audio: { type: "string" } }, required: ["timing", "visual"] };

export const VARIANT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    variants: {
      type: "array",
      items: {
        type: "object",
        properties: {
          platform: { type: "string", enum: [...SOCIAL_ORGANIC_PLATFORMS] },
          hook: { type: "string", description: "The opening line (≤ 400 chars)" },
          body: { type: "string", description: "The full post text, excluding hashtags" },
          hashtags: { type: "array", items: { type: "string" } },
          callToAction: { type: "string" },
          platformOptions: { type: "object", properties: { firstComment: { type: "string" }, title: { type: "string" }, altText: { type: "string" } } },
          imagePrompt: { type: "string", description: "A concrete art direction prompt for the visual, in the brand's visual identity" },
          videoConcept: { type: "object", properties: { hook: { type: "string" }, script: { type: "string" }, shots: { type: "array", items: SHOT_JSON_SCHEMA } } },
        },
        required: ["platform", "hook", "body", "hashtags", "callToAction"],
      },
    },
  },
  required: ["variants"],
};

function cleanHashtag(raw: string): string {
  return raw.replace(/[^\p{L}\p{N}_#]/gu, "");
}

function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return text.slice(0, Math.max(0, max));
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export interface FittedVariantContent {
  hook: string;
  body: string;
  hashtags: string[];
  callToAction: string;
  platformOptions: SocialVariantPlatformOptions;
}

/**
 * Enforces the platform's official limits on model output: hashtags
 * normalized/deduped and capped, the composed caption (body + hashtag
 * block) within `maxBodyLength` (hashtags trimmed first if they would eat
 * more than a third of the budget, then the body cut at a word boundary),
 * field lengths bounded. Pure.
 */
export function fitVariantToPlatform(platform: SocialOrganicPlatform, raw: { hook?: string; body?: string; hashtags?: string[]; callToAction?: string; platformOptions?: Partial<Record<"firstComment" | "title" | "altText", string | null | undefined>> | null }, existingOptions: SocialVariantPlatformOptions = {}): FittedVariantContent {
  const rules = SOCIAL_PLATFORM_RULES[platform];
  const max = rules.maxBodyLength;
  let hashtags = normalizeHashtags((raw.hashtags ?? []).map(cleanHashtag)).filter((t) => /^#[\p{L}\p{N}_]{1,100}$/u.test(t)).slice(0, Math.min(rules.maxHashtags, 30));
  while (hashtags.length && composeCaption("", hashtags).length > Math.floor(max / 3)) hashtags = hashtags.slice(0, -1);
  const tagBlock = hashtags.length ? composeCaption("", hashtags).length + 2 : 0;
  const body = truncateAtWord((raw.body ?? "").trim(), Math.max(0, max - tagBlock));
  const opts = raw.platformOptions ?? {};
  const merged: Record<string, unknown> = { ...existingOptions };
  if (opts.firstComment) merged.firstComment = clip(opts.firstComment, 2200);
  if (opts.title) merged.title = clip(opts.title, 100);
  if (opts.altText) merged.altText = clip(opts.altText, 1000);
  const parsedOptions = socialVariantPlatformOptionsSchema.safeParse(merged);
  return {
    hook: clip(raw.hook, 400),
    body,
    hashtags,
    callToAction: clip(raw.callToAction, 300),
    platformOptions: parsedOptions.success ? parsedOptions.data : existingOptions,
  };
}

// ---------------------------------------------------------------------------
// Prompt builders (pure)
// ---------------------------------------------------------------------------

export interface PromptPair {
  system: string;
  prompt: string;
}

function guardrailLines(brand: BrandContext): string[] {
  const lines = [
    "Follow the brand context literally; it overrides any general best practice.",
    "Never invent statistics, results, testimonials, client names, awards, prices or product capabilities that are not in the brand context.",
  ];
  if (brand.facts.prohibitedLanguage.length) lines.push(`Never use these words/phrases: ${brand.facts.prohibitedLanguage.map((t) => `"${t}"`).join(", ")}.`);
  if (brand.facts.neverClaim.length) lines.push(`Never claim: ${brand.facts.neverClaim.map((t) => `"${t}"`).join("; ")}.`);
  return lines;
}

function briefForPrompt(brief: SocialContentBrief): Record<string, unknown> {
  return Object.fromEntries(Object.entries(brief).filter(([, v]) => (Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v.trim().length > 0 : v !== undefined && v !== null)));
}

export function buildVariantGenerationPrompt(input: { brand: BrandContext; title: string; brief: SocialContentBrief; targets: { platform: SocialOrganicPlatform; format: string }[]; performance?: ReturnType<typeof topPerformers>; instruction?: string }): PromptPair {
  const platforms = [...new Set(input.targets.map((t) => t.platform))];
  const system = [
    `You are the senior social media copywriter for ${input.brand.name}. You write platform-native posts that a human will review before anything is published.`,
    ...guardrailLines(input.brand),
    "Each platform gets its OWN post written to that platform's conventions — never the same text reformatted. A LinkedIn post must read differently from the Instagram caption.",
    "Return JSON only.",
    "",
    input.brand.text,
  ].join("\n");
  const prompt = JSON.stringify({
    task: `Write one post per platform for the content item "${input.title}".`,
    brief: briefForPrompt(input.brief),
    platforms: input.targets.map((t) => ({ platform: t.platform, label: SOCIAL_PLATFORM_LABELS[t.platform], format: t.format, maxCaptionCharacters: SOCIAL_PLATFORM_RULES[t.platform].maxBodyLength, maxHashtags: SOCIAL_PLATFORM_RULES[t.platform].maxHashtags, conventions: PLATFORM_CONVENTIONS[t.platform] })),
    recentTopics: input.brand.recentTopics.length ? { note: "Already covered recently — take a fresh angle, do not repeat these hooks", topics: input.brand.recentTopics } : undefined,
    verifiedPastPerformance: input.performance?.length ? { note: "Real synced/recorded numbers for this brand's recent posts. Use them only to choose angles and formats; never quote or extrapolate them in copy.", posts: input.performance } : undefined,
    preferredCallsToAction: input.brand.facts.callsToAction.length ? input.brand.facts.callsToAction : undefined,
    additionalInstruction: input.instruction || undefined,
    output: `Return {"variants":[...]} with exactly one entry for each of: ${platforms.join(", ")}. Include imagePrompt for visual formats and videoConcept for video formats.`,
  });
  return { system, prompt };
}

export function buildPartPrompt(input: { brand: BrandContext; title: string; brief: SocialContentBrief; platform: SocialOrganicPlatform; current: { hook: string; body: string; hashtags: string[]; callToAction: string }; part: "hook" | "caption" | "cta" | "hashtags" | "scene" | "voiceover"; instruction?: string }): PromptPair {
  const what: Record<typeof input.part, string> = {
    hook: 'a new opening line. Return {"hook": "..."}',
    caption: 'a new caption body (excluding hashtags) that keeps the current hook as its first line. Return {"body": "..."}',
    cta: 'a new call to action. Return {"callToAction": "..."}',
    hashtags: 'a new set of hashtags. Return {"hashtags": ["#..."]}',
    scene: 'a new shot list for the video (6–10 shots). Return {"shots":[{"timing":"0-2s","visual":"...","onScreenText":"...","audio":"..."}]}',
    voiceover: 'a new word-for-word voiceover script. Return {"script": "..."}',
  };
  const system = [`You are the senior social media copywriter for ${input.brand.name}. Rewrite only the requested part; everything else stays exactly as it is.`, ...guardrailLines(input.brand), `Platform conventions (${SOCIAL_PLATFORM_LABELS[input.platform]}): ${PLATFORM_CONVENTIONS[input.platform]}`, "Return JSON only.", "", input.brand.text].join("\n");
  const prompt = JSON.stringify({ task: `For the ${SOCIAL_PLATFORM_LABELS[input.platform]} post "${input.title}", write ${what[input.part]}`, brief: briefForPrompt(input.brief), currentPost: input.current, instruction: input.instruction || undefined, maxCaptionCharacters: SOCIAL_PLATFORM_RULES[input.platform].maxBodyLength, maxHashtags: SOCIAL_PLATFORM_RULES[input.platform].maxHashtags });
  return { system, prompt };
}

export function buildIdeasPrompt(input: { brand: BrandContext; count: number; platforms: SocialOrganicPlatform[]; theme?: string; performance?: ReturnType<typeof topPerformers>; schedule?: { weekStartLocalDate: string; timezone: string; postsPerWeek: number } }): PromptPair {
  const system = [
    `You are the content strategist for ${input.brand.name}. Propose specific, producible post ideas rooted in the brand's pillars and objectives.`,
    ...guardrailLines(input.brand),
    "Every idea must be meaningfully different (angle, format and objective). Do not repeat recent topics.",
    "Return JSON only.",
    "",
    input.brand.text,
  ].join("\n");
  const prompt = JSON.stringify({
    task: input.schedule ? `Plan ${input.count} posts for the week starting ${input.schedule.weekStartLocalDate} (${input.schedule.timezone}).` : `Propose ${input.count} post ideas.`,
    theme: input.theme || undefined,
    platforms: input.platforms,
    contentPillars: input.brand.facts.contentPillars,
    allowedKinds: SOCIAL_CONTENT_KINDS,
    allowedObjectives: SOCIAL_CONTENT_OBJECTIVES,
    recentTopics: input.brand.recentTopics.length ? input.brand.recentTopics : undefined,
    verifiedPastPerformance: input.performance?.length ? { note: "Real numbers only; lean into what demonstrably worked, never quote these numbers as claims", posts: input.performance } : { note: "No performance data is available yet — do not assume any." },
    scheduling: input.schedule ? { rule: "Weekdays only (dayOffset 0 = the week start date), business hours 09:00–17:00 local time, spread across the week, at most one post per day unless the count requires more.", fields: "dayOffset (0-6) and localTime (HH:MM)" } : undefined,
    output: `Return {"ideas":[{"title","kind","objective","platforms","hook","angle","whyNow"${input.schedule ? ',"dayOffset","localTime"' : ""}}]} with exactly ${input.count} ideas.`,
  });
  return { system, prompt };
}

export function buildAnalysisPrompt(input: { brand: BrandContext; evidence: PerformanceEvidence }): PromptPair {
  const system = [
    `You are the social media analyst for ${input.brand.name}.`,
    "Analyse ONLY the numbers supplied in `evidence`. Never invent, estimate or extrapolate a metric that is not present; if the data is too thin to support a conclusion, say so plainly.",
    "Every claim in whatWorked/whatDidNot must cite the post title or account and the specific numbers from the evidence.",
    ...guardrailLines(input.brand),
    "Return JSON only.",
    "",
    input.brand.text,
  ].join("\n");
  const prompt = JSON.stringify({
    task: `Review the last ${input.evidence.windowDays} days of social performance and recommend what to do next.`,
    evidence: input.evidence,
    output: 'Return {"summary":"...","whatWorked":["..."],"whatDidNot":["..."],"recommendations":[{"title","rationale","suggestedKind","suggestedPlatforms"}]}',
    allowedKinds: SOCIAL_CONTENT_KINDS,
  });
  return { system, prompt };
}

export function buildReplyPrompt(input: { brand: BrandContext; item: { platform: string; itemType: string; authorName: string; text: string; postContext?: string } }): PromptPair {
  const isX = input.item.platform === "x";
  const system = [
    `You draft replies to social media ${input.item.itemType === "direct_message" ? "messages" : "comments"} on behalf of ${input.brand.name}. A human reviews every draft before it is sent.`,
    ...guardrailLines(input.brand),
    "Be brief, warm and specific to what the person said. Never promise prices, discounts, timelines or outcomes. If it is a complaint, acknowledge and offer to take it to a private channel. If it is spam or abusive, reply with an empty string.",
    isX ? "The reply must be ≤ 280 characters." : "Keep the reply under 600 characters.",
    "Classify sentiment and category. isLead is true only when the person explicitly signals buying interest (asks about pricing, availability, a quote, booking, or how to work together).",
    "Return JSON only.",
    "",
    input.brand.text,
  ].join("\n");
  const prompt = JSON.stringify({
    platform: input.item.platform,
    itemType: input.item.itemType,
    author: input.item.authorName,
    message: clip(input.item.text, 3000),
    postContext: input.item.postContext ? clip(input.item.postContext, 1500) : undefined,
    allowedSentiments: SOCIAL_SENTIMENTS,
    allowedCategories: SOCIAL_ENGAGEMENT_CATEGORIES,
    output: '{"reply":"...","sentiment":"...","category":"...","isLead":false}',
  });
  return { system, prompt };
}

export function buildImagePrompt(input: { brand: SocialBrand; brief: SocialContentBrief; title: string; hook: string; platform: SocialOrganicPlatform; instruction?: string }): string {
  const visual = buildBrandContextText(input.brand, ["visual"]).split("\n").slice(1).join("\n");
  // A regenerate instruction is the owner asking for a different picture, so it
  // replaces the brief's earlier art direction instead of trailing behind it
  // (image models anchor on whatever comes first).
  const instruction = input.instruction?.trim();
  const direction = instruction || input.brief.creativeDirection;
  return [
    direction ? `Art direction: ${direction}` : `A striking social media visual for "${input.title}".`,
    input.hook ? `The post's message: ${input.hook}` : "",
    visual ? `Brand visual identity:\n${visual}` : "",
    `Format: a ${SOCIAL_PLATFORM_LABELS[input.platform]} post visual. No fake logos, no fake UI text, no invented statistics. Avoid rendering long text in the image.`,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 4000);
}

// ---------------------------------------------------------------------------
// Variant writes (direct CAS updates)
// ---------------------------------------------------------------------------

type VariantRow = typeof socialContentVariants.$inferSelect;

async function setVariantStatus(db: Db, organizationId: string, row: VariantRow, from: readonly string[], to: "draft" | "generating"): Promise<VariantRow | null> {
  if (!from.includes(row.status) || row.archivedAt) return null;
  const [updated] = await db
    .update(socialContentVariants)
    .set({ status: to, revision: row.revision + 1, updatedAt: new Date() })
    .where(and(eq(socialContentVariants.id, row.id), eq(socialContentVariants.organizationId, organizationId), eq(socialContentVariants.revision, row.revision), eq(socialContentVariants.status, row.status)))
    .returning();
  return updated ?? null;
}

async function releaseVariants(db: Db, organizationId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const rows = await db.select().from(socialContentVariants).where(and(eq(socialContentVariants.organizationId, organizationId), inArray(socialContentVariants.id, ids)));
  for (const row of rows) if (row.status === "generating") await setVariantStatus(db, organizationId, row, ["generating"], "draft");
}

/** Merges generated creative direction into the item brief, filling only empty fields — a human-written brief is never overwritten. */
async function fillBriefGaps(db: Db, organizationId: string, contentItemId: string, patch: Partial<SocialContentBrief>): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const [item] = await db.select().from(marketingContentItems).where(and(eq(marketingContentItems.id, contentItemId), eq(marketingContentItems.organizationId, organizationId)));
    if (!item) return;
    const current = socialContentBriefSchema.safeParse(item.brief ?? {});
    const brief = current.success ? current.data : socialContentBriefSchema.parse({});
    const next: Record<string, unknown> = { ...brief };
    let changed = false;
    for (const [key, value] of Object.entries(patch)) {
      const existing = (brief as Record<string, unknown>)[key];
      const empty = Array.isArray(existing) ? existing.length === 0 : typeof existing === "string" ? existing.trim() === "" : existing === undefined;
      const hasValue = Array.isArray(value) ? value.length > 0 : typeof value === "string" ? value.trim() !== "" : value !== undefined;
      if (empty && hasValue) {
        next[key] = value;
        changed = true;
      }
    }
    if (!changed) return;
    const parsed = socialContentBriefSchema.safeParse(next);
    if (!parsed.success) return;
    const [row] = await db
      .update(marketingContentItems)
      .set({ brief: parsed.data, revision: item.revision + 1, updatedAt: new Date() })
      .where(and(eq(marketingContentItems.id, item.id), eq(marketingContentItems.organizationId, organizationId), eq(marketingContentItems.revision, item.revision)))
      .returning({ id: marketingContentItems.id });
    if (row) return;
  }
}

function briefPatchFrom(output: GeneratedVariant[]): Partial<SocialContentBrief> {
  const imagePrompt = output.map((v) => v.imagePrompt).find((p): p is string => typeof p === "string" && p.trim().length > 0);
  const video = output.map((v) => v.videoConcept).find((c) => c && (c.script || c.shots.length));
  const patch: Partial<SocialContentBrief> = {};
  if (imagePrompt) patch.creativeDirection = clip(imagePrompt, 3000);
  if (video) {
    if (video.hook) patch.hook = clip(video.hook, 400);
    if (video.script) patch.script = clip(video.script, 8000);
    if (video.shots.length) patch.shots = shotsFrom(video.shots);
  }
  return patch;
}

function shotsFrom(raw: { timing?: string; visual?: string; onScreenText?: string; audio?: string }[]): SocialContentBrief["shots"] {
  return raw
    .filter((s) => (s.visual ?? "").trim())
    .slice(0, 24)
    .map((s) => ({ timing: clip(s.timing || "", 40), visual: clip(s.visual, 600), onScreenText: clip(s.onScreenText, 200), audio: clip(s.audio, 300) }));
}

// ---------------------------------------------------------------------------
// generateVariantsForItem
// ---------------------------------------------------------------------------

export async function generateVariantsForItem(db: Db, input: { organizationId: string; contentItemId: string; actorUserId: string; instruction?: string; deps?: StudioDeps }): Promise<{ generationId: string; variants: SocialVariant[]; skippedPlatforms: SocialOrganicPlatform[] }> {
  await requireGenerate(db, input, "marketing_content_item", input.contentItemId);
  const item = await getContentItemForUser(db, { organizationId: input.organizationId, contentItemId: input.contentItemId, actorUserId: input.actorUserId });
  if (item.archivedAt) throw new InvalidSocialTransitionError("content item", "archived", "generated");
  if (!item.brandProfileId) throw new SocialVariantNotPublishableError(["this content item has no brand"]);
  const targetsView = item.variants.filter((v) => (DRAFTABLE_STATUSES as readonly string[]).includes(v.status) && !v.archivedAt);
  if (!targetsView.length) throw new InvalidSocialTransitionError("post", item.variants.map((v) => v.status).join("/") || "none", "generating");

  const brand = await assembleBrandContext(db, { organizationId: input.organizationId, brandProfileId: item.brandProfileId });
  const evidence = await loadPerformanceEvidence(db, { organizationId: input.organizationId, brandProfileId: item.brandProfileId, days: 90, now: input.deps?.now ?? new Date(), limit: 10 });
  const { system, prompt } = buildVariantGenerationPrompt({ brand, title: item.title, brief: item.brief, targets: targetsView.map((v) => ({ platform: v.platform, format: v.format })), performance: topPerformers(evidence), instruction: input.instruction });

  // Mark the drafts as generating (CAS) so nobody edits them mid-generation.
  const rows = await db.select().from(socialContentVariants).where(and(eq(socialContentVariants.organizationId, input.organizationId), inArray(socialContentVariants.id, targetsView.map((v) => v.id))));
  const locked: VariantRow[] = [];
  for (const row of rows) {
    const updated = await setVariantStatus(db, input.organizationId, row, DRAFTABLE_STATUSES, "generating");
    if (updated) locked.push(updated);
  }
  if (!locked.length) throw new InvalidSocialTransitionError("post", "edited concurrently", "generating");

  let result;
  try {
    result = await generateTextRecorded(db, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      scope: { brandProfileId: item.brandProfileId, contentItemId: item.id, campaignId: item.campaignId },
      generationType: "text",
      system,
      prompt,
      jsonSchema: VARIANT_JSON_SCHEMA,
      maxOutputTokens: 6000,
      parse: (json) => variantGenerationOutputSchema.parse(json),
      deps: input.deps,
    });
  } catch (err) {
    await releaseVariants(db, input.organizationId, locked.map((r) => r.id));
    throw err;
  }

  const byPlatform = new Map<string, GeneratedVariant>();
  for (const v of result.json.variants) {
    const key = v.platform.trim().toLowerCase();
    if (!byPlatform.has(key)) byPlatform.set(key, v);
  }
  const skippedPlatforms: SocialOrganicPlatform[] = [];
  for (const row of locked) {
    const platform = row.platform as SocialOrganicPlatform;
    const generated = byPlatform.get(platform);
    if (!generated) {
      skippedPlatforms.push(platform);
      await setVariantStatus(db, input.organizationId, row, ["generating"], "draft");
      continue;
    }
    const existingOptions = socialVariantPlatformOptionsSchema.safeParse(row.platformOptions ?? {});
    const fitted = fitVariantToPlatform(platform, { ...generated, platformOptions: generated.platformOptions ?? {} }, existingOptions.success ? existingOptions.data : {});
    const [updated] = await db
      .update(socialContentVariants)
      .set({ ...fitted, status: "draft", lastGenerationId: result.generationId, revision: row.revision + 1, updatedAt: new Date() })
      .where(and(eq(socialContentVariants.id, row.id), eq(socialContentVariants.organizationId, input.organizationId), eq(socialContentVariants.revision, row.revision), eq(socialContentVariants.status, "generating")))
      .returning();
    if (!updated) continue;
    const warnings = await computeStoredVariantWarnings(db, input.organizationId, updated);
    await db.update(socialContentVariants).set({ warnings }).where(and(eq(socialContentVariants.id, updated.id), eq(socialContentVariants.organizationId, input.organizationId)));
    await recordAuditEvent(db, { eventType: "social_variant_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_content_variant", targetId: updated.id, metadata: { action: "generated", generationId: result.generationId, fields: ["hook", "body", "hashtags", "callToAction", "platformOptions"] } });
  }
  await fillBriefGaps(db, input.organizationId, item.id, briefPatchFrom(result.json.variants));
  await syncContentItemStatus(db, input.organizationId, item.id);
  const fresh = await getContentItemForUser(db, { organizationId: input.organizationId, contentItemId: item.id, actorUserId: input.actorUserId });
  return { generationId: result.generationId, variants: fresh.variants, skippedPlatforms };
}

// ---------------------------------------------------------------------------
// regenerateVariantPart
// ---------------------------------------------------------------------------

/** Target aspect ratio for a generated image on a platform/format. */
export function imageAspectFor(platform: SocialOrganicPlatform, format: string): ImageGenerationRequest["aspectRatio"] {
  if (format === "story" || format === "reel" || format === "short_video") return "9:16";
  switch (platform) {
    case "instagram":
      return "4:5";
    case "tiktok":
      return "9:16";
    case "youtube":
    case "x":
      return "16:9";
    case "linkedin":
    case "facebook":
    default:
      return "1:1";
  }
}

export function videoAspectFor(platform: SocialOrganicPlatform, format: string): VideoGenerationRequest["aspectRatio"] {
  if (format === "story" || format === "reel" || format === "short_video" || platform === "tiktok" || platform === "instagram") return "9:16";
  if (platform === "youtube" || platform === "x" || platform === "linkedin" || platform === "facebook") return format === "video" ? "16:9" : "1:1";
  return "9:16";
}

function imageFormatFor(platform: SocialOrganicPlatform, current: SocialVariantFormat): SocialVariantFormat | undefined {
  if (current !== "text" && current !== "link") return undefined;
  return (SOCIAL_PLATFORM_RULES[platform].formats as readonly string[]).includes("image") ? "image" : undefined;
}

const partOutputSchemas = {
  hook: z.object({ hook: z.string().min(1) }),
  caption: z.object({ body: z.string().min(1) }),
  cta: z.object({ callToAction: z.string().min(1) }),
  hashtags: z.object({ hashtags: z.array(z.string()).min(1) }),
  scene: z.object({ shots: z.array(z.object({ timing: z.string().default(""), visual: z.string().default(""), onScreenText: z.string().default(""), audio: z.string().default("") })).min(1) }),
  voiceover: z.object({ script: z.string().min(1) }),
} as const;

const partJsonSchemas: Record<keyof typeof partOutputSchemas, Record<string, unknown>> = {
  hook: { type: "object", properties: { hook: { type: "string" } }, required: ["hook"] },
  caption: { type: "object", properties: { body: { type: "string" } }, required: ["body"] },
  cta: { type: "object", properties: { callToAction: { type: "string" } }, required: ["callToAction"] },
  hashtags: { type: "object", properties: { hashtags: { type: "array", items: { type: "string" } } }, required: ["hashtags"] },
  scene: { type: "object", properties: { shots: { type: "array", items: SHOT_JSON_SCHEMA } }, required: ["shots"] },
  voiceover: { type: "object", properties: { script: { type: "string" } }, required: ["script"] },
};

async function setLastGeneration(db: Db, organizationId: string, contentVariantId: string, generationId: string): Promise<void> {
  // A pointer, not content: no revision bump, so the client's revision stays valid.
  await db.update(socialContentVariants).set({ lastGenerationId: generationId }).where(and(eq(socialContentVariants.id, contentVariantId), eq(socialContentVariants.organizationId, organizationId)));
}

export interface RegenerateResult {
  generationId: string;
  variant: SocialVariant;
  pending: boolean;
  contentItem?: SocialContentItem;
}

export async function regenerateVariantPart(db: Db, input: { organizationId: string; contentVariantId: string; actorUserId: string; part: SocialRegeneratePart; instruction?: string; deps?: StudioDeps }): Promise<RegenerateResult> {
  await requireGenerate(db, input, "social_content_variant", input.contentVariantId);
  const variant = await getVariantForUser(db, { organizationId: input.organizationId, contentVariantId: input.contentVariantId, actorUserId: input.actorUserId });
  if (variant.archivedAt) throw new InvalidSocialTransitionError("post", "archived", "regenerated");
  const item = await getContentItemForUser(db, { organizationId: input.organizationId, contentItemId: variant.contentItemId, actorUserId: input.actorUserId });
  if (!item.brandProfileId) throw new SocialVariantNotPublishableError(["this content item has no brand"]);
  const instruction = input.instruction?.trim().slice(0, 1000) || undefined;
  const scope = { brandProfileId: item.brandProfileId, contentItemId: item.id, contentVariantId: variant.id, campaignId: item.campaignId };

  if (input.part === "image") return regenerateImage(db, { ...input, variant, item, instruction, scope });
  if (input.part === "video") return regenerateVideo(db, { ...input, variant, item, scope });

  const part = input.part;
  if ((part === "hook" || part === "caption" || part === "cta" || part === "hashtags") && !(PART_EDITABLE_STATUSES as readonly string[]).includes(variant.status)) throw new InvalidSocialTransitionError("post", variant.status, "regenerated");
  const brand = await assembleBrandContext(db, { organizationId: input.organizationId, brandProfileId: item.brandProfileId });
  const { system, prompt } = buildPartPrompt({ brand, title: item.title, brief: item.brief, platform: variant.platform, current: { hook: variant.hook, body: variant.body, hashtags: variant.hashtags, callToAction: variant.callToAction }, part, instruction });
  const schema = partOutputSchemas[part];
  const result = await generateTextRecorded(db, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    scope,
    generationType: part === "scene" || part === "voiceover" ? "strategy" : "text",
    system,
    prompt,
    jsonSchema: partJsonSchemas[part],
    maxOutputTokens: part === "scene" || part === "voiceover" ? 3000 : 1200,
    parse: (json) => schema.parse(json) as Record<string, unknown>,
    deps: input.deps,
  });
  const out = result.json;

  if (part === "scene" || part === "voiceover") {
    const changes: Partial<SocialContentBrief> = part === "scene" ? { shots: shotsFrom((out.shots as { timing?: string; visual?: string; onScreenText?: string; audio?: string }[]) ?? []) } : { script: clip(out.script, 8000) };
    const contentItem = await updateContentItem(db, { organizationId: input.organizationId, contentItemId: item.id, actorUserId: input.actorUserId, expectedRevision: item.revision, changes: { brief: changes } });
    await setLastGeneration(db, input.organizationId, variant.id, result.generationId);
    return { generationId: result.generationId, variant: { ...variant, lastGenerationId: result.generationId }, pending: false, contentItem };
  }

  const fitted = fitVariantToPlatform(variant.platform, {
    hook: part === "hook" ? String(out.hook) : variant.hook,
    body: part === "caption" ? String(out.body) : variant.body,
    hashtags: part === "hashtags" ? (out.hashtags as string[]) : variant.hashtags,
    callToAction: part === "cta" ? String(out.callToAction) : variant.callToAction,
  }, variant.platformOptions);
  const changes = part === "hook" ? { hook: fitted.hook } : part === "caption" ? { body: fitted.body } : part === "cta" ? { callToAction: fitted.callToAction } : { hashtags: fitted.hashtags, ...(fitted.body !== variant.body ? { body: fitted.body } : {}) };
  const updated = await updateVariant(db, { organizationId: input.organizationId, contentVariantId: variant.id, actorUserId: input.actorUserId, expectedRevision: variant.revision, changes });
  await setLastGeneration(db, input.organizationId, variant.id, result.generationId);
  return { generationId: result.generationId, variant: { ...updated, lastGenerationId: result.generationId }, pending: false };
}

async function regenerateImage(
  db: Db,
  input: { organizationId: string; actorUserId: string; variant: SocialVariant; item: SocialContentItem; instruction?: string; scope: { brandProfileId: string; contentItemId: string; contentVariantId: string; campaignId: string }; deps?: StudioDeps }
): Promise<RegenerateResult> {
  const { variant, item } = input;
  if (!(PART_EDITABLE_STATUSES as readonly string[]).includes(variant.status)) throw new InvalidSocialTransitionError("post", variant.status, "regenerated");
  const env = input.deps?.env ?? (await loadSocialAiEnv());
  const provider = input.deps?.imageProvider ?? resolveImageProvider(env);
  const brand = await requireActiveBrand(db, input.organizationId, input.scope.brandProfileId);
  const aspectRatio = imageAspectFor(variant.platform, variant.format);
  const prompt = buildImagePrompt({ brand, brief: item.brief, title: item.title, hook: variant.hook, platform: variant.platform, instruction: input.instruction });
  const generation = await beginGeneration(db, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    ...input.scope,
    generationType: "image",
    provider: provider.id,
    model: provider.defaultModel,
    request: { prompt, aspectRatio, contentVariantId: variant.id },
    estimatedCostUsd: estimateImageCostUsd(provider.id, aspectRatio),
    env,
    now: input.deps?.now,
  });
  let assetId: string;
  try {
    const references = await loadBrandReferences(db, input.organizationId, input.scope.brandProfileId);
    const image = await provider.generateImage({ prompt, aspectRatio, idempotencyKey: generation.id, ...(references.length ? { references } : {}) });
    const asset = await createGeneratedAsset(db, {
      organizationId: input.organizationId,
      brandProfileId: input.scope.brandProfileId,
      contentItemId: item.id,
      contentVariantId: variant.id,
      assetType: "image",
      title: `${item.title} — ${SOCIAL_PLATFORM_LABELS[variant.platform]} visual`.slice(0, 200),
      provider: image.provider,
      model: image.model,
      generationId: generation.id,
      file: { bytes: image.bytes, contentType: image.contentType, filename: image.contentType === "image/png" ? "generated.png" : "generated.jpg" },
      altText: variant.platformOptions.altText ?? clip(variant.hook || item.title, 1000),
      actorUserId: input.actorUserId,
      storage: input.deps?.storage,
    });
    assetId = asset.id;
    await completeGeneration(db, { organizationId: input.organizationId, generationId: generation.id, output: { assetId: asset.id, width: image.width ?? null, height: image.height ?? null, contentType: image.contentType }, usage: image.usage, assetId: asset.id, model: image.model });
  } catch (err) {
    await failGeneration(db, { organizationId: input.organizationId, generationId: generation.id, errorCode: errorCodeFor(err), errorMessage: errorMessageFor(err) });
    throw err;
  }
  const format = imageFormatFor(variant.platform, variant.format);
  const updated = await updateVariant(db, { organizationId: input.organizationId, contentVariantId: variant.id, actorUserId: input.actorUserId, expectedRevision: variant.revision, changes: { media: withPrimaryMedia(variant.media, assetId), ...(format ? { format } : {}) } });
  await setLastGeneration(db, input.organizationId, variant.id, generation.id);
  return { generationId: generation.id, variant: { ...updated, lastGenerationId: generation.id }, pending: false };
}

const VIDEO_DURATION_SECONDS: VideoGenerationRequest["durationSeconds"] = 5;

async function regenerateVideo(
  db: Db,
  input: { organizationId: string; actorUserId: string; variant: SocialVariant; item: SocialContentItem; instruction?: string; scope: { brandProfileId: string; contentItemId: string; contentVariantId: string; campaignId: string }; deps?: StudioDeps }
): Promise<RegenerateResult> {
  const { variant, item } = input;
  if (variant.status !== "draft" && variant.status !== "changes_requested") throw new InvalidSocialTransitionError("post", variant.status, "generating");
  const env = input.deps?.env ?? (await loadSocialAiEnv());
  const provider = input.deps?.videoProvider ?? resolveVideoProvider(env);
  const brand = await requireActiveBrand(db, input.organizationId, input.scope.brandProfileId);
  const aspectRatio = videoAspectFor(variant.platform, variant.format);
  const shots = item.brief.shots.map((s) => `${s.timing}: ${s.visual}`).join("; ");
  const visual = buildBrandContextText(brand, ["visual"]).split("\n").slice(1).join(" ");
  const prompt = [item.brief.creativeDirection || `A short social video for "${item.title}".`, variant.hook || item.brief.hook ? `Message: ${variant.hook || item.brief.hook}` : "", shots ? `Shots: ${shots}` : "", input.instruction ? `Direction: ${input.instruction}` : "", visual ? `Brand look: ${visual}` : "", "No on-screen text, no logos, no invented UI."].filter(Boolean).join("\n").slice(0, 1000);

  let promptImage: VideoGenerationRequest["promptImage"];
  const primary = variant.media.find((m) => m.role === "primary");
  if (primary && provider.id === "runway") {
    const asset = await resolveAssetRow(db, input.organizationId, primary.assetId);
    if (asset.contentType === "image/png" || asset.contentType === "image/jpeg") {
      const bytes = await resolveAssetBytes(db, { organizationId: input.organizationId, assetId: asset.id, storage: input.deps?.storage });
      promptImage = { bytes: bytes.bytes, contentType: asset.contentType };
    }
  }
  const perSecond = provider.estimatedCostPerSecondUsd();
  const generation = await beginGeneration(db, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    ...input.scope,
    generationType: "video",
    provider: provider.id,
    model: provider.defaultModel,
    request: { prompt, aspectRatio, durationSeconds: VIDEO_DURATION_SECONDS, title: `${item.title} — ${SOCIAL_PLATFORM_LABELS[variant.platform]} video`.slice(0, 200), promptImageAssetId: promptImage ? primary?.assetId : null },
    estimatedCostUsd: perSecond !== null ? Math.round(perSecond * VIDEO_DURATION_SECONDS * 1e6) / 1e6 : null,
    env,
    now: input.deps?.now,
  });
  try {
    const started = await provider.startVideo({ prompt, aspectRatio, durationSeconds: VIDEO_DURATION_SECONDS, promptImage, idempotencyKey: generation.id });
    await recordProviderTask(db, { organizationId: input.organizationId, generationId: generation.id, providerTaskId: started.taskId, model: started.model });
  } catch (err) {
    await failGeneration(db, { organizationId: input.organizationId, generationId: generation.id, errorCode: errorCodeFor(err), errorMessage: errorMessageFor(err) });
    throw err;
  }
  const row = await resolveVariantRow(db, input.organizationId, variant.id);
  await setVariantStatus(db, input.organizationId, row, ["draft", "changes_requested"], "generating");
  await db.update(socialContentVariants).set({ lastGenerationId: generation.id }).where(and(eq(socialContentVariants.id, variant.id), eq(socialContentVariants.organizationId, input.organizationId)));
  const now = input.deps?.now ?? new Date();
  await enqueueJob(db, { organizationId: input.organizationId, jobType: "social_generation_run", idempotencyKey: `social_generation_run:${generation.id}`, maxAttempts: 12, availableAt: new Date(now.getTime() + 20_000) });
  await recordAuditEvent(db, { eventType: "social_variant_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_content_variant", targetId: variant.id, metadata: { action: "video_generation_started", generationId: generation.id, provider: provider.id } });
  const fresh = await getVariantForUser(db, { organizationId: input.organizationId, contentVariantId: variant.id, actorUserId: input.actorUserId });
  return { generationId: generation.id, variant: fresh, pending: true };
}

// ---------------------------------------------------------------------------
// Ideas
// ---------------------------------------------------------------------------

export const ideaSchema = z.object({
  title: z.string().min(1),
  kind: z.string().default("text_post"),
  objective: z.string().default("engagement"),
  platforms: z.array(z.string()).default([]),
  hook: z.string().default(""),
  angle: z.string().default(""),
  whyNow: z.string().default(""),
  dayOffset: z.coerce.number().optional().nullable(),
  localTime: z.string().optional().nullable(),
});
const ideasOutputSchema = z.object({ ideas: z.array(ideaSchema).min(1).max(20) });

export interface SocialContentIdea {
  title: string;
  kind: SocialContentKind;
  objective: (typeof SOCIAL_CONTENT_OBJECTIVES)[number];
  platforms: SocialOrganicPlatform[];
  hook: string;
  angle: string;
  whyNow: string;
}

const IDEAS_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    ideas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          kind: { type: "string", enum: [...SOCIAL_CONTENT_KINDS] },
          objective: { type: "string", enum: [...SOCIAL_CONTENT_OBJECTIVES] },
          platforms: { type: "array", items: { type: "string", enum: [...SOCIAL_ORGANIC_PLATFORMS] } },
          hook: { type: "string" },
          angle: { type: "string" },
          whyNow: { type: "string" },
          dayOffset: { type: "integer", minimum: 0, maximum: 6 },
          localTime: { type: "string", pattern: "^[0-2][0-9]:[0-5][0-9]$" },
        },
        required: ["title", "kind", "objective", "platforms", "hook", "angle", "whyNow"],
      },
    },
  },
  required: ["ideas"],
};

/** Normalizes one model idea to closed vocabularies (unknown kind/objective → defaults; platforms ∩ allowed, else the allowed list). Pure. */
export function normalizeIdea(raw: z.infer<typeof ideaSchema>, allowedPlatforms: SocialOrganicPlatform[]): SocialContentIdea {
  const kind = (SOCIAL_CONTENT_KINDS as readonly string[]).includes(raw.kind) ? (raw.kind as SocialContentKind) : "text_post";
  const objective = (SOCIAL_CONTENT_OBJECTIVES as readonly string[]).includes(raw.objective) ? (raw.objective as SocialContentIdea["objective"]) : "engagement";
  const platforms = [...new Set(raw.platforms.map((p) => p.trim().toLowerCase()).filter((p): p is SocialOrganicPlatform => (allowedPlatforms as string[]).includes(p)))];
  return { title: clip(raw.title, 200), kind, objective, platforms: platforms.length ? platforms : allowedPlatforms, hook: clip(raw.hook, 400), angle: clip(raw.angle, 1000), whyNow: clip(raw.whyNow, 500) };
}

function platformsFor(brand: BrandContext, requested?: SocialOrganicPlatform[]): SocialOrganicPlatform[] {
  const req = (requested ?? []).filter((p) => socialOrganicPlatformSchema.safeParse(p).success);
  if (req.length) return [...new Set(req)];
  const preferred = brand.facts.preferredPlatforms.filter(isOrganicPlatform);
  return preferred.length ? [...new Set(preferred)] : ["instagram", "linkedin"];
}

export async function generateContentIdeas(
  db: Db,
  input: { organizationId: string; brandProfileId: string; actorUserId: string; count?: number; platforms?: SocialOrganicPlatform[]; theme?: string; deps?: StudioDeps }
): Promise<{ generationId: string; ideas: SocialContentIdea[] }> {
  await requireGenerate(db, input, "marketing_brand_profile", input.brandProfileId);
  await requireActiveBrand(db, input.organizationId, input.brandProfileId);
  const brand = await assembleBrandContext(db, { organizationId: input.organizationId, brandProfileId: input.brandProfileId });
  const count = Math.min(Math.max(Math.floor(input.count ?? 5), 1), 10);
  const platforms = platformsFor(brand, input.platforms);
  const evidence = await loadPerformanceEvidence(db, { organizationId: input.organizationId, brandProfileId: input.brandProfileId, days: 90, now: input.deps?.now ?? new Date(), limit: 10 });
  const { system, prompt } = buildIdeasPrompt({ brand, count, platforms, theme: input.theme?.trim().slice(0, 500), performance: topPerformers(evidence) });
  const result = await generateTextRecorded(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, scope: { brandProfileId: input.brandProfileId }, generationType: "strategy", system, prompt, jsonSchema: IDEAS_JSON_SCHEMA, maxOutputTokens: 3000, parse: (json) => ideasOutputSchema.parse(json), deps: input.deps });
  return { generationId: result.generationId, ideas: result.json.ideas.slice(0, count).map((i) => normalizeIdea(i, platforms)) };
}

// ---------------------------------------------------------------------------
// Week planning
// ---------------------------------------------------------------------------

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function zonedParts(date: Date, tz: string): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")), hour: Number(get("hour")) % 24, minute: Number(get("minute")), weekday: weekdays.indexOf(get("weekday")) };
}

/** Wall-clock time in `tz` → the UTC instant. Pure (Intl-based, DST-aware). */
export function zonedDateTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let utc = target;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(new Date(utc), tz);
    const asLocal = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const diff = target - asLocal;
    if (diff === 0) break;
    utc += diff;
  }
  return new Date(utc);
}

export interface PlannedSlot {
  dayOffset: number;
  hour: number;
  minute: number;
}

/**
 * Turns the model's (dayOffset, localTime) proposals into valid slots:
 * weekdays only, 09:00–17:00 local; anything invalid or colliding gets the
 * next free deterministic weekday slot (10:00, then 12:30, then 15:00).
 * Pure.
 */
export function assignWeekSlots(proposals: { dayOffset?: number | null; localTime?: string | null }[], weekdayOffsets: number[]): PlannedSlot[] {
  const used = new Set<string>();
  const fallbackTimes = [
    [10, 0],
    [12, 30],
    [15, 0],
  ];
  const fallbacks: PlannedSlot[] = [];
  for (const [h, m] of fallbackTimes) for (const d of weekdayOffsets) fallbacks.push({ dayOffset: d, hour: h, minute: m });
  return proposals.map((p, i) => {
    const m = typeof p.localTime === "string" ? /^(\d{1,2}):(\d{2})$/.exec(p.localTime.trim()) : null;
    const hour = m ? Number(m[1]) : NaN;
    const minute = m ? Number(m[2]) : NaN;
    const day = typeof p.dayOffset === "number" ? Math.floor(p.dayOffset) : NaN;
    const valid = weekdayOffsets.includes(day) && hour >= 9 && (hour < 17 || (hour === 17 && minute === 0)) && minute >= 0 && minute < 60;
    if (valid && !used.has(`${day}`)) {
      used.add(`${day}`);
      used.add(`${day}:${hour}:${minute}`);
      return { dayOffset: day, hour, minute };
    }
    // Spread: prefer an unused day at the first fallback time, then any unused slot.
    const freeDay = fallbacks.find((f) => !used.has(`${f.dayOffset}`));
    const slot = freeDay ?? fallbacks.find((f) => !used.has(`${f.dayOffset}:${f.hour}:${f.minute}`)) ?? fallbacks[i % fallbacks.length];
    used.add(`${slot.dayOffset}`);
    used.add(`${slot.dayOffset}:${slot.hour}:${slot.minute}`);
    return slot;
  });
}

async function resolveBusinessTimezone(db: Db, organizationId: string): Promise<string> {
  const [config] = await db.select({ tz: marketingConfigurations.businessTimezone }).from(marketingConfigurations).where(eq(marketingConfigurations.organizationId, organizationId)).limit(1);
  // The column defaults to "UTC" (i.e. never configured); LYNQ's market default is Toronto.
  const tz = config?.tz?.trim();
  return tz && tz !== "UTC" && isValidTimeZone(tz) ? tz : "America/Toronto";
}

export async function planWeek(
  db: Db,
  input: { organizationId: string; brandProfileId: string; actorUserId: string; weekStart: Date; postsPerWeek?: number; platforms?: SocialOrganicPlatform[]; theme?: string; deps?: StudioDeps }
): Promise<{ generationId: string; createdContentItemIds: string[]; skipped: string[]; timezone: string }> {
  await requireGenerate(db, input, "marketing_brand_profile", input.brandProfileId);
  await requireActiveBrand(db, input.organizationId, input.brandProfileId);
  if (!(input.weekStart instanceof Date) || Number.isNaN(input.weekStart.getTime())) throw new SocialVariantNotPublishableError(["a valid week start date is required"]);
  const brand = await assembleBrandContext(db, { organizationId: input.organizationId, brandProfileId: input.brandProfileId });
  const timezone = await resolveBusinessTimezone(db, input.organizationId);
  const now = input.deps?.now ?? new Date();
  const count = Math.min(Math.max(Math.floor(input.postsPerWeek ?? 3), 1), 7);
  const platforms = platformsFor(brand, input.platforms);

  const start = zonedParts(input.weekStart, timezone);
  const weekStartLocalDate = `${start.year}-${String(start.month).padStart(2, "0")}-${String(start.day).padStart(2, "0")}`;
  const weekdayOffsets = [0, 1, 2, 3, 4, 5, 6].filter((d) => {
    const wd = (start.weekday + d) % 7;
    return wd >= 1 && wd <= 5;
  });

  const evidence = await loadPerformanceEvidence(db, { organizationId: input.organizationId, brandProfileId: input.brandProfileId, days: 90, now, limit: 10 });
  const { system, prompt } = buildIdeasPrompt({ brand, count, platforms, theme: input.theme?.trim().slice(0, 500), performance: topPerformers(evidence), schedule: { weekStartLocalDate, timezone, postsPerWeek: count } });
  const result = await generateTextRecorded(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, scope: { brandProfileId: input.brandProfileId }, generationType: "plan", system, prompt, jsonSchema: IDEAS_JSON_SCHEMA, maxOutputTokens: 3000, parse: (json) => ideasOutputSchema.parse(json), deps: input.deps });

  const rawIdeas = result.json.ideas.slice(0, count);
  const slots = assignWeekSlots(rawIdeas, weekdayOffsets);
  const createdContentItemIds: string[] = [];
  const skipped: string[] = [];
  for (let i = 0; i < rawIdeas.length; i++) {
    const idea = normalizeIdea(rawIdeas[i], platforms);
    const slot = slots[i];
    const local = new Date(Date.UTC(start.year, start.month - 1, start.day + slot.dayOffset));
    const scheduledFor = zonedDateTimeToUtc(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate(), slot.hour, slot.minute, timezone);
    if (scheduledFor.getTime() < now.getTime() + 60 * 60 * 1000) {
      skipped.push(`${idea.title}: the proposed time ${scheduledFor.toISOString()} is already past`);
      continue;
    }
    const brief = socialContentBriefSchema.parse({ kind: idea.kind, objective: idea.objective, topic: clip(`${idea.angle || idea.title}${idea.whyNow ? ` — why now: ${idea.whyNow}` : ""}`, 2000), hook: idea.hook });
    const item = await createContentItem(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, brandProfileId: input.brandProfileId, title: idea.title, brief, platforms: idea.platforms, scheduledFor });
    createdContentItemIds.push(item.id);
    try {
      await generateVariantsForItem(db, { organizationId: input.organizationId, contentItemId: item.id, actorUserId: input.actorUserId, deps: input.deps });
    } catch (err) {
      skipped.push(`${idea.title}: created as an empty draft — post copy was not generated (${errorMessageFor(err).slice(0, 200)})`);
    }
  }
  return { generationId: result.generationId, createdContentItemIds, skipped, timezone };
}

// ---------------------------------------------------------------------------
// Performance analysis
// ---------------------------------------------------------------------------

const analysisOutputSchema = z.object({
  summary: z.string().min(1),
  whatWorked: z.array(z.string()).default([]),
  whatDidNot: z.array(z.string()).default([]),
  recommendations: z.array(z.object({ title: z.string().min(1), rationale: z.string().default(""), suggestedKind: z.string().default("text_post"), suggestedPlatforms: z.array(z.string()).default([]) })).default([]),
});

const ANALYSIS_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    summary: { type: "string" },
    whatWorked: { type: "array", items: { type: "string" } },
    whatDidNot: { type: "array", items: { type: "string" } },
    recommendations: { type: "array", items: { type: "object", properties: { title: { type: "string" }, rationale: { type: "string" }, suggestedKind: { type: "string", enum: [...SOCIAL_CONTENT_KINDS] }, suggestedPlatforms: { type: "array", items: { type: "string", enum: [...SOCIAL_ORGANIC_PLATFORMS] } } }, required: ["title", "rationale"] } },
  },
  required: ["summary", "whatWorked", "whatDidNot", "recommendations"],
};

export interface SocialPerformanceAnalysis {
  summary: string;
  whatWorked: string[];
  whatDidNot: string[];
  recommendations: { title: string; rationale: string; suggestedKind: SocialContentKind; suggestedPlatforms: SocialOrganicPlatform[] }[];
}

export type AnalyzePerformanceResult = { available: false; reason: string; evidence: PerformanceEvidence } | { available: true; generationId: string; analysis: SocialPerformanceAnalysis; evidence: PerformanceEvidence };

/** True when the evidence holds at least one real number to analyse. Pure. */
export function hasPerformanceData(evidence: PerformanceEvidence): boolean {
  return evidence.postsWithMetrics > 0 || evidence.accounts.length > 0;
}

export async function analyzePerformance(db: Db, input: { organizationId: string; brandProfileId: string; actorUserId: string; days?: number; deps?: StudioDeps }): Promise<AnalyzePerformanceResult> {
  await requireGenerate(db, input, "marketing_brand_profile", input.brandProfileId);
  await resolveBrandById(db, input.organizationId, input.brandProfileId);
  const days = clampDays(input.days);
  const evidence = await loadPerformanceEvidence(db, { organizationId: input.organizationId, brandProfileId: input.brandProfileId, days, now: input.deps?.now ?? new Date() });
  if (!hasPerformanceData(evidence)) {
    const reason = evidence.publishedPosts > 0 ? `${evidence.publishedPosts} post(s) were published in the last ${days} days, but no performance has been synced or recorded for them yet.` : `No posts were published and no account metrics were synced in the last ${days} days.`;
    return { available: false, reason, evidence };
  }
  const brand = await assembleBrandContext(db, { organizationId: input.organizationId, brandProfileId: input.brandProfileId });
  const { system, prompt } = buildAnalysisPrompt({ brand, evidence });
  const result = await generateTextRecorded(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, scope: { brandProfileId: input.brandProfileId }, generationType: "analysis", system, prompt, jsonSchema: ANALYSIS_JSON_SCHEMA, maxOutputTokens: 2500, temperature: 0.2, parse: (json) => analysisOutputSchema.parse(json), deps: input.deps });
  const a = result.json;
  return {
    available: true,
    generationId: result.generationId,
    evidence,
    analysis: {
      summary: clip(a.summary, 2000),
      whatWorked: a.whatWorked.slice(0, 10).map((s) => clip(s, 500)),
      whatDidNot: a.whatDidNot.slice(0, 10).map((s) => clip(s, 500)),
      recommendations: a.recommendations.slice(0, 8).map((r) => ({
        title: clip(r.title, 200),
        rationale: clip(r.rationale, 800),
        suggestedKind: (SOCIAL_CONTENT_KINDS as readonly string[]).includes(r.suggestedKind) ? (r.suggestedKind as SocialContentKind) : "text_post",
        suggestedPlatforms: r.suggestedPlatforms.filter((p): p is SocialOrganicPlatform => socialOrganicPlatformSchema.safeParse(p).success),
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Engagement reply drafts (pure helper for the engagement slice)
// ---------------------------------------------------------------------------

const replyOutputSchema = z.object({ reply: z.string().default(""), sentiment: z.string().default("neutral"), category: z.string().default("other"), isLead: z.boolean().default(false) });

export interface EngagementReplyDraft {
  generationId: string;
  reply: string;
  sentiment: (typeof SOCIAL_SENTIMENTS)[number];
  category: (typeof SOCIAL_ENGAGEMENT_CATEGORIES)[number];
  isLead: boolean;
}

export async function draftEngagementReply(
  db: Db,
  input: { organizationId: string; actorUserId: string; brandProfileId: string; item: { platform: string; itemType: string; authorName: string; text: string; postContext?: string }; deps?: StudioDeps }
): Promise<EngagementReplyDraft> {
  await requireGenerate(db, input, "marketing_brand_profile", input.brandProfileId);
  const brand = await assembleBrandContext(db, { organizationId: input.organizationId, brandProfileId: input.brandProfileId, sections: ["identity", "voice", "offer", "guardrails", "examples"] });
  const { system, prompt } = buildReplyPrompt({ brand, item: input.item });
  const result = await generateTextRecorded(db, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    scope: { brandProfileId: input.brandProfileId },
    generationType: "reply_draft",
    system,
    prompt,
    jsonSchema: { type: "object", properties: { reply: { type: "string" }, sentiment: { type: "string", enum: [...SOCIAL_SENTIMENTS] }, category: { type: "string", enum: [...SOCIAL_ENGAGEMENT_CATEGORIES] }, isLead: { type: "boolean" } }, required: ["reply", "sentiment", "category", "isLead"] },
    maxOutputTokens: 600,
    parse: (json) => replyOutputSchema.parse(json),
    deps: input.deps,
  });
  const r = result.json;
  const max = input.item.platform === "x" ? 280 : 1000;
  return {
    generationId: result.generationId,
    reply: clip(r.reply, max),
    sentiment: (SOCIAL_SENTIMENTS as readonly string[]).includes(r.sentiment) ? (r.sentiment as EngagementReplyDraft["sentiment"]) : "neutral",
    category: (SOCIAL_ENGAGEMENT_CATEGORIES as readonly string[]).includes(r.category) ? (r.category as EngagementReplyDraft["category"]) : "other",
    isLead: r.isLead === true,
  };
}

/**
 * The brand's own logo/mascot images (Brand → Logos & mascot), passed to image
 * generation as references so a mascot stays the same character in every
 * post. Best-effort: a missing or unreadable file just means no reference.
 */
async function loadBrandReferences(db: Db, organizationId: string, brandProfileId: string): Promise<{ bytes: Uint8Array; contentType: string; tag: string }[]> {
  try {
    const rows = await db
      .select({ id: socialAssets.id, contentType: socialAssets.contentType })
      .from(socialAssets)
      .where(and(eq(socialAssets.organizationId, organizationId), eq(socialAssets.brandProfileId, brandProfileId), eq(socialAssets.assetType, "logo"), isNull(socialAssets.archivedAt)))
      .orderBy(desc(socialAssets.createdAt))
      .limit(3);
    const out: { bytes: Uint8Array; contentType: string; tag: string }[] = [];
    for (const r of rows) {
      if (!/^image\/(png|jpeg|webp)$/.test(r.contentType)) continue;
      const { bytes, contentType } = await resolveAssetBytes(db, { organizationId, assetId: r.id }).catch(() => ({ bytes: new Uint8Array(), contentType: "" }));
      if (bytes.byteLength) out.push({ bytes, contentType, tag: "brand-reference" });
    }
    return out;
  } catch {
    return [];
  }
}
