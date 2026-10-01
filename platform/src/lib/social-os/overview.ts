import "server-only";
import { and, count, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingChannelAccounts, marketingContentItems, socialContentVariants } from "@/db/schema";
import { resolveMarketingAuthContext, requireMarketingViewAuthority } from "@/lib/marketing-os/authz";
import type { SocialServiceDeps } from "./analytics-sync";
import { computeSocialAttention, type SocialAttention } from "./attention";
import { listBrands, type SocialBrand } from "./brands";
import { getSocialCalendar, type SocialCalendarEntry } from "./calendar";
import { describeConnectionCenter } from "./connections";
import { computeInboxSummary, type InboxSummary } from "./engagement";
import { summarizeGenerationUsage, type SocialGenerationUsageSummary } from "./generation";
import { describeAiProviders, loadSocialAiEnv } from "./providers/ai/registry";
import type { AiProviderAvailability } from "./providers/ai/types";
import { SOCIAL_PLATFORM_LABELS, type SocialAccountConnectionStatus, type SocialPlatform, type SocialVariantStatus } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * Module 19 — the Social overview (home screen): brands, connection health,
 * the deterministic daily manager, the content pipeline, what is coming up,
 * what just went out, the inbox, and AI availability. Read-only; requires
 * `marketing_view`.
 */

const DAY_MS = 24 * 3600 * 1000;

export interface SocialOverview {
  brands: { id: string; name: string; brandKey: string; preferredPlatforms: SocialPlatform[] }[];
  selectedBrand: { id: string; name: string } | null;
  connectionSummary: { total: number; byStatus: Partial<Record<SocialAccountConnectionStatus, number>>; providersConfigured: number; providersTotal: number };
  attention: SocialAttention;
  pipeline: Partial<Record<SocialVariantStatus, number>>;
  upcoming: SocialCalendarEntry[];
  recentPublished: { variantId: string; contentItemId: string; title: string; platform: SocialPlatform; platformLabel: string; accountDisplayName: string | null; publishedAt: Date | null; externalPostUrl: string | null }[];
  inbox: InboxSummary;
  aiAvailability: { providers: AiProviderAvailability[]; textConfigured: boolean; imageConfigured: boolean; videoConfigured: boolean; usage: SocialGenerationUsageSummary };
}

function brief(b: SocialBrand) {
  return { id: b.id, name: b.name, brandKey: b.brandKey, preferredPlatforms: b.preferredPlatforms };
}

export async function getSocialOverview(db: Db, input: { organizationId: string; actorUserId: string; brandProfileId?: string; deps?: SocialServiceDeps }): Promise<SocialOverview> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "social_overview", input.brandProfileId ?? "all");
  const now = input.deps?.now ? input.deps.now() : new Date();

  const brands = await listBrands(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  const selected = input.brandProfileId ? (brands.find((b) => b.id === input.brandProfileId) ?? null) : brands.length === 1 ? brands[0] : null;
  const brandId = input.brandProfileId ?? selected?.id ?? null;

  const center = await describeConnectionCenter(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, deps: input.deps });
  const scopedAccounts = center.accounts.filter((a) => !brandId || a.brandProfileId === brandId);
  const byStatus: Partial<Record<SocialAccountConnectionStatus, number>> = {};
  for (const a of scopedAccounts) byStatus[a.connectionStatus] = (byStatus[a.connectionStatus] ?? 0) + 1;

  const attention = await computeSocialAttention(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, brandProfileId: brandId, now, deps: input.deps });

  const pipelineConditions = [eq(socialContentVariants.organizationId, input.organizationId), isNull(socialContentVariants.archivedAt)];
  if (brandId) pipelineConditions.push(eq(marketingContentItems.brandProfileId, brandId));
  const pipelineRows = await db
    .select({ status: socialContentVariants.status, n: count() })
    .from(socialContentVariants)
    .innerJoin(marketingContentItems, and(eq(marketingContentItems.id, socialContentVariants.contentItemId), eq(marketingContentItems.organizationId, socialContentVariants.organizationId)))
    .where(and(...pipelineConditions))
    .groupBy(socialContentVariants.status);
  const pipeline: Partial<Record<SocialVariantStatus, number>> = {};
  for (const r of pipelineRows) pipeline[r.status] = Number(r.n);

  const calendar = await getSocialCalendar(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, from: now, to: new Date(now.getTime() + 7 * DAY_MS), view: "week", brandProfileId: brandId ?? undefined, now });
  const upcoming = calendar.entries.filter((e) => e.status !== "published").slice(0, 20);

  const recentConditions = [eq(socialContentVariants.organizationId, input.organizationId), eq(socialContentVariants.status, "published"), isNotNull(socialContentVariants.publishedAt)];
  if (brandId) recentConditions.push(eq(marketingContentItems.brandProfileId, brandId));
  const recent = await db
    .select({ variant: socialContentVariants, title: marketingContentItems.title, accountDisplayName: marketingChannelAccounts.displayName })
    .from(socialContentVariants)
    .innerJoin(marketingContentItems, and(eq(marketingContentItems.id, socialContentVariants.contentItemId), eq(marketingContentItems.organizationId, socialContentVariants.organizationId)))
    .leftJoin(marketingChannelAccounts, and(eq(marketingChannelAccounts.id, socialContentVariants.channelAccountId), eq(marketingChannelAccounts.organizationId, socialContentVariants.organizationId)))
    .where(and(...recentConditions))
    .orderBy(desc(socialContentVariants.publishedAt))
    .limit(5);

  const inbox = await computeInboxSummary(db, { organizationId: input.organizationId, brandProfileId: brandId });

  const aiEnv = input.deps?.aiEnv ?? (await loadSocialAiEnv());
  const providers = describeAiProviders(aiEnv);
  const usage = await summarizeGenerationUsage(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, days: 30, env: aiEnv, now });

  return {
    brands: brands.map(brief),
    selectedBrand: selected ? { id: selected.id, name: selected.name } : null,
    connectionSummary: { total: scopedAccounts.length, byStatus, providersConfigured: center.providers.filter((p) => p.configured).length, providersTotal: center.providers.length },
    attention,
    pipeline,
    upcoming,
    recentPublished: recent.map((r) => ({
      variantId: r.variant.id,
      contentItemId: r.variant.contentItemId,
      title: r.title,
      platform: r.variant.platform,
      platformLabel: SOCIAL_PLATFORM_LABELS[r.variant.platform],
      accountDisplayName: r.accountDisplayName,
      publishedAt: r.variant.publishedAt,
      externalPostUrl: r.variant.externalPostUrl,
    })),
    inbox,
    aiAvailability: {
      providers,
      textConfigured: providers.some((p) => p.kind === "text" && p.configured),
      imageConfigured: providers.some((p) => p.kind === "image" && p.configured),
      videoConfigured: providers.some((p) => p.kind === "video" && p.configured),
      usage,
    },
  };
}
