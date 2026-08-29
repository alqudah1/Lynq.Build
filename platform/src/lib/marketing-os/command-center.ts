import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import {
  marketingBrandProfiles,
  marketingCampaigns,
  marketingChannelAccounts,
  marketingContentItems,
  marketingContentPerformanceSnapshots,
  marketingContentStudioDrafts,
} from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { requireMarketingManageContentAuthority, requireMarketingViewAuthority, resolveMarketingAuthContext } from "./authz";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export const DEFAULT_CHANNELS = [
  { platform: "instagram", accountKind: "organic", label: "Instagram" },
  { platform: "facebook", accountKind: "organic", label: "Facebook" },
  { platform: "tiktok", accountKind: "organic", label: "TikTok" },
  { platform: "youtube", accountKind: "organic", label: "YouTube" },
  { platform: "google_ads", accountKind: "paid", label: "Google Ads" },
  { platform: "meta_ads", accountKind: "paid", label: "Meta Ads" },
  { platform: "tiktok_ads", accountKind: "paid", label: "TikTok Ads" },
] as const;

export async function ensureDefaultChannelAccounts(db: Db, input: { organizationId: string; actorUserId: string }) {
  const ctx = await resolveMarketingAuthContext(db, input);
  await requireMarketingManageContentAuthority(db, ctx, "marketing_channel_accounts", "setup");
  const brands = await db.select().from(marketingBrandProfiles).where(and(eq(marketingBrandProfiles.organizationId, input.organizationId), isNull(marketingBrandProfiles.workspaceId)));
  for (const brand of brands) {
    for (const channel of DEFAULT_CHANNELS) {
      await db.insert(marketingChannelAccounts).values({
        organizationId: input.organizationId,
        brandProfileId: brand.id,
        platform: channel.platform,
        accountKind: channel.accountKind,
        displayName: `${brand.name} ${channel.label}`,
        connectionStatus: "manual",
        ownerUserId: input.actorUserId,
      }).onConflictDoNothing();
    }
  }
  await recordAuditEvent(db, { eventType: "marketing_channel_accounts_seeded", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_channel_accounts", targetId: null, metadata: { brandCount: brands.length, channelsPerBrand: DEFAULT_CHANNELS.length } });
}

export async function recordPerformanceSnapshot(db: Db, input: {
  organizationId: string;
  actorUserId: string;
  contentItemId: string;
  channelAccountId: string;
  capturedAt?: Date;
  impressions: number;
  reach: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  clicks: number;
  leads: number;
  conversions: number;
  spendAmount: string;
  revenueAmount: string;
  notes?: string;
}) {
  const ctx = await resolveMarketingAuthContext(db, input);
  await requireMarketingManageContentAuthority(db, ctx, "marketing_content_performance", input.contentItemId);
  const [[content], [account], [studio]] = await Promise.all([
    db.select({ id: marketingContentItems.id }).from(marketingContentItems).where(and(eq(marketingContentItems.id, input.contentItemId), eq(marketingContentItems.organizationId, input.organizationId))),
    db.select({ id: marketingChannelAccounts.id, brandProfileId: marketingChannelAccounts.brandProfileId }).from(marketingChannelAccounts).where(and(eq(marketingChannelAccounts.id, input.channelAccountId), eq(marketingChannelAccounts.organizationId, input.organizationId), isNull(marketingChannelAccounts.archivedAt))),
    db.select({ brandProfileId: marketingContentStudioDrafts.brandProfileId }).from(marketingContentStudioDrafts).where(and(eq(marketingContentStudioDrafts.contentItemId, input.contentItemId), eq(marketingContentStudioDrafts.organizationId, input.organizationId))),
  ]);
  if (!content || !account) throw new Error("Content or channel account is unavailable in this organization");
  if (studio && studio.brandProfileId !== account.brandProfileId) throw new Error("Choose a channel account for the same brand as this content");
  const [row] = await db.insert(marketingContentPerformanceSnapshots).values({
    organizationId: input.organizationId,
    contentItemId: content.id,
    channelAccountId: account.id,
    capturedAt: input.capturedAt ?? new Date(),
    source: "manual",
    impressions: input.impressions,
    reach: input.reach,
    views: input.views,
    likes: input.likes,
    comments: input.comments,
    shares: input.shares,
    saves: input.saves,
    clicks: input.clicks,
    leads: input.leads,
    conversions: input.conversions,
    spendAmount: input.spendAmount,
    revenueAmount: input.revenueAmount,
    notes: input.notes || null,
    recordedByUserId: input.actorUserId,
  }).returning();
  await recordAuditEvent(db, { eventType: "marketing_performance_recorded", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_content_item", targetId: content.id, metadata: { channelAccountId: account.id, source: "manual" } });
  return row;
}

export async function getMarketingCommandCenter(db: Db, input: { organizationId: string; actorUserId: string }) {
  const ctx = await resolveMarketingAuthContext(db, input);
  await requireMarketingViewAuthority(db, ctx, "marketing_command_center", "view");
  const [brands, accounts, content, drafts, snapshots, campaigns] = await Promise.all([
    db.select().from(marketingBrandProfiles).where(eq(marketingBrandProfiles.organizationId, input.organizationId)),
    db.select().from(marketingChannelAccounts).where(and(eq(marketingChannelAccounts.organizationId, input.organizationId), isNull(marketingChannelAccounts.archivedAt))),
    db.select().from(marketingContentItems).where(and(eq(marketingContentItems.organizationId, input.organizationId), isNull(marketingContentItems.archivedAt))).orderBy(desc(marketingContentItems.updatedAt)).limit(100),
    db.select({ contentItemId: marketingContentStudioDrafts.contentItemId, brandProfileId: marketingContentStudioDrafts.brandProfileId }).from(marketingContentStudioDrafts).where(eq(marketingContentStudioDrafts.organizationId, input.organizationId)),
    db.select().from(marketingContentPerformanceSnapshots).where(eq(marketingContentPerformanceSnapshots.organizationId, input.organizationId)).orderBy(desc(marketingContentPerformanceSnapshots.capturedAt)).limit(200),
    db.select({ id: marketingCampaigns.id, name: marketingCampaigns.name }).from(marketingCampaigns).where(eq(marketingCampaigns.organizationId, input.organizationId)),
  ]);
  const brandById = new Map(brands.map((row) => [row.id, row]));
  const accountById = new Map(accounts.map((row) => [row.id, row]));
  const campaignById = new Map(campaigns.map((row) => [row.id, row.name]));
  const contentById = new Map(content.map((row) => [row.id, row]));
  const brandIdByContent = new Map(drafts.filter((row) => row.contentItemId).map((row) => [row.contentItemId!, row.brandProfileId]));
  const totals = snapshots.reduce((sum, row) => ({
    impressions: sum.impressions + row.impressions,
    views: sum.views + row.views,
    engagement: sum.engagement + row.likes + row.comments + row.shares + row.saves,
    clicks: sum.clicks + row.clicks,
    leads: sum.leads + row.leads,
    conversions: sum.conversions + row.conversions,
    spend: sum.spend + Number(row.spendAmount),
    revenue: sum.revenue + Number(row.revenueAmount),
  }), { impressions: 0, views: 0, engagement: 0, clicks: 0, leads: 0, conversions: 0, spend: 0, revenue: 0 });
  return {
    brands,
    accounts: accounts.map((account) => ({ ...account, brandName: brandById.get(account.brandProfileId)?.name ?? "Unknown brand" })),
    content: content.map((item) => ({ ...item, brandName: brandById.get(brandIdByContent.get(item.id) ?? "")?.name ?? "Unassigned", campaignName: campaignById.get(item.campaignId) ?? "Campaign" })),
    snapshots: snapshots.map((snapshot) => ({ ...snapshot, accountName: accountById.get(snapshot.channelAccountId)?.displayName ?? "Channel account", contentTitle: contentById.get(snapshot.contentItemId)?.title ?? "Content" })),
    totals,
    pipeline: content.reduce<Record<string, number>>((acc, item) => ({ ...acc, [item.status]: (acc[item.status] ?? 0) + 1 }), {}),
  };
}
