import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { agentApprovalRequests, marketingBrandProfiles, marketingConfigurations, marketingContentItems, socialAiGenerations, socialContentVariants } from "@/db/schema";
import { resolveMarketingAuthContext, requireMarketingViewAuthority } from "@/lib/marketing-os/authz";
import { SOCIAL_PLATFORM_LABELS, socialOrganicPlatformSchema, type SocialOrganicPlatform } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * Module 19 — small read-only helpers the Social pages need that the
 * domain services do not expose. Every function either resolves the
 * actor's marketing authority itself (view) or reads non-sensitive org
 * configuration only; every query is tenant-scoped. No writes here.
 */

const DEFAULT_TIMEZONE = "America/Toronto";

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The organization's business timezone for displaying and entering social times (same rule as the studio planner: unset/"UTC" → Toronto). */
export async function getSocialTimezone(db: Db, organizationId: string): Promise<string> {
  const [config] = await db.select({ tz: marketingConfigurations.businessTimezone }).from(marketingConfigurations).where(eq(marketingConfigurations.organizationId, organizationId)).limit(1);
  const tz = config?.tz?.trim();
  return tz && tz !== "UTC" && isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE;
}

export interface SocialDecidedApproval {
  variantId: string;
  contentItemId: string;
  title: string;
  brandName: string | null;
  platform: SocialOrganicPlatform;
  platformLabel: string;
  variantStatus: string;
  decision: "approved" | "rejected" | "revision_requested";
  decisionNote: string | null;
  decidedAt: Date | null;
}

/** The most recent human decisions on social posts (via the runtime approval each variant points at). */
export async function listRecentlyDecidedVariants(db: Db, input: { organizationId: string; actorUserId: string; brandProfileId?: string; limit?: number }): Promise<SocialDecidedApproval[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "social_content_variant", "approvals");
  const conditions = [
    eq(socialContentVariants.organizationId, input.organizationId),
    isNull(socialContentVariants.archivedAt),
    inArray(agentApprovalRequests.status, ["approved", "rejected", "revision_requested"]),
  ];
  if (input.brandProfileId) conditions.push(eq(marketingContentItems.brandProfileId, input.brandProfileId));
  const rows = await db
    .select({
      variantId: socialContentVariants.id,
      contentItemId: socialContentVariants.contentItemId,
      platform: socialContentVariants.platform,
      variantStatus: socialContentVariants.status,
      title: marketingContentItems.title,
      brandName: marketingBrandProfiles.name,
      decision: agentApprovalRequests.status,
      decisionNote: agentApprovalRequests.decisionNote,
      decidedAt: agentApprovalRequests.decidedAt,
    })
    .from(socialContentVariants)
    .innerJoin(marketingContentItems, and(eq(marketingContentItems.id, socialContentVariants.contentItemId), eq(marketingContentItems.organizationId, socialContentVariants.organizationId)))
    .innerJoin(agentApprovalRequests, and(eq(agentApprovalRequests.id, socialContentVariants.approvalRequestId), eq(agentApprovalRequests.organizationId, socialContentVariants.organizationId)))
    .leftJoin(marketingBrandProfiles, and(eq(marketingBrandProfiles.id, marketingContentItems.brandProfileId), eq(marketingBrandProfiles.organizationId, marketingContentItems.organizationId)))
    .where(and(...conditions))
    .orderBy(desc(agentApprovalRequests.decidedAt))
    .limit(Math.min(Math.max(input.limit ?? 10, 1), 50));
  return rows.flatMap((r) => {
    const platform = socialOrganicPlatformSchema.safeParse(r.platform);
    if (!platform.success) return [];
    return [{
      variantId: r.variantId,
      contentItemId: r.contentItemId,
      title: r.title,
      brandName: r.brandName,
      platform: platform.data,
      platformLabel: SOCIAL_PLATFORM_LABELS[platform.data],
      variantStatus: r.variantStatus,
      decision: r.decision as SocialDecidedApproval["decision"],
      decisionNote: r.decisionNote,
      decidedAt: r.decidedAt,
    }];
  });
}

export interface SocialGenerationSummary {
  id: string;
  provider: string;
  model: string;
  generationType: string;
  status: string;
}

/** Provider/model for a set of generation ids (e.g. each pending post's `lastGenerationId`). */
export async function getGenerationSummaries(db: Db, input: { organizationId: string; actorUserId: string; generationIds: string[] }): Promise<Map<string, SocialGenerationSummary>> {
  const ids = [...new Set(input.generationIds.filter(Boolean))].slice(0, 200);
  if (!ids.length) return new Map();
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "social_ai_generation", "list");
  const rows = await db
    .select({ id: socialAiGenerations.id, provider: socialAiGenerations.provider, model: socialAiGenerations.model, generationType: socialAiGenerations.generationType, status: socialAiGenerations.status })
    .from(socialAiGenerations)
    .where(and(eq(socialAiGenerations.organizationId, input.organizationId), inArray(socialAiGenerations.id, ids)));
  return new Map(rows.map((r) => [r.id, r]));
}

export interface SocialPublishedContentOption {
  contentItemId: string;
  title: string;
  platform: SocialOrganicPlatform;
  platformLabel: string;
  channelAccountId: string | null;
  publishedAt: Date | null;
}

/** Published posts (any date) for the "record results manually" picker — one row per published platform version, newest first. */
export async function listPublishedSocialContent(db: Db, input: { organizationId: string; actorUserId: string; brandProfileId?: string; limit?: number }): Promise<SocialPublishedContentOption[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "social_content_variant", "published");
  const conditions = [eq(socialContentVariants.organizationId, input.organizationId), eq(socialContentVariants.status, "published"), isNull(socialContentVariants.archivedAt)];
  if (input.brandProfileId) conditions.push(eq(marketingContentItems.brandProfileId, input.brandProfileId));
  const rows = await db
    .select({ contentItemId: socialContentVariants.contentItemId, title: marketingContentItems.title, platform: socialContentVariants.platform, channelAccountId: socialContentVariants.channelAccountId, publishedAt: socialContentVariants.publishedAt })
    .from(socialContentVariants)
    .innerJoin(marketingContentItems, and(eq(marketingContentItems.id, socialContentVariants.contentItemId), eq(marketingContentItems.organizationId, socialContentVariants.organizationId)))
    .where(and(...conditions))
    .orderBy(desc(socialContentVariants.publishedAt))
    .limit(Math.min(Math.max(input.limit ?? 100, 1), 200));
  return rows.flatMap((r) => {
    const platform = socialOrganicPlatformSchema.safeParse(r.platform);
    if (!platform.success) return [];
    return [{ contentItemId: r.contentItemId, title: r.title, platform: platform.data, platformLabel: SOCIAL_PLATFORM_LABELS[platform.data], channelAccountId: r.channelAccountId, publishedAt: r.publishedAt }];
  });
}
