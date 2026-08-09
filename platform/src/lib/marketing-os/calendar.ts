import "server-only";
import { and, eq, gte, lte } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingCampaigns, marketingContentItems } from "@/db/schema";
import { resolveMarketingAuthContext, requireMarketingViewAuthority } from "./authz";
import type { MarketingCampaignStatus, MarketingContentStatus } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export type MarketingCalendarEventType = "campaign_start" | "campaign_end" | "content_planned_publish";

export interface MarketingCalendarEvent {
  eventType: MarketingCalendarEventType;
  date: Date;
  campaignId: string;
  campaignName: string;
  contentItemId: string | null;
  title: string;
  status: MarketingCampaignStatus | MarketingContentStatus;
  channel: string | null;
}

/**
 * Derived entirely from `marketing_campaigns.startDate`/`endDate` and
 * `marketing_content_items.plannedPublishAt` — never a duplicate calendar
 * record when the source record already contains the date. No external
 * calendar integration in this module.
 */
export async function getMarketingCalendar(db: Db, input: { organizationId: string; actorUserId: string; from: Date; to: Date; campaignId?: string; channel?: string }): Promise<MarketingCalendarEvent[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_calendar", "view");

  const events: MarketingCalendarEvent[] = [];

  const campaignConditions = [eq(marketingCampaigns.organizationId, input.organizationId)];
  if (input.campaignId) campaignConditions.push(eq(marketingCampaigns.id, input.campaignId));
  const campaigns = await db.select().from(marketingCampaigns).where(and(...campaignConditions));
  const campaignNameById = new Map(campaigns.map((c) => [c.id, c.name]));

  for (const campaign of campaigns) {
    if (campaign.startDate && campaign.startDate >= input.from && campaign.startDate <= input.to) {
      events.push({ eventType: "campaign_start", date: campaign.startDate, campaignId: campaign.id, campaignName: campaign.name, contentItemId: null, title: `${campaign.name} — starts`, status: campaign.status, channel: null });
    }
    if (campaign.endDate && campaign.endDate >= input.from && campaign.endDate <= input.to) {
      events.push({ eventType: "campaign_end", date: campaign.endDate, campaignId: campaign.id, campaignName: campaign.name, contentItemId: null, title: `${campaign.name} — ends`, status: campaign.status, channel: null });
    }
  }

  const contentConditions = [eq(marketingContentItems.organizationId, input.organizationId), gte(marketingContentItems.plannedPublishAt, input.from), lte(marketingContentItems.plannedPublishAt, input.to)];
  if (input.campaignId) contentConditions.push(eq(marketingContentItems.campaignId, input.campaignId));
  if (input.channel) contentConditions.push(eq(marketingContentItems.intendedChannel, input.channel));
  const contentItems = await db.select().from(marketingContentItems).where(and(...contentConditions));

  for (const item of contentItems) {
    if (!item.plannedPublishAt) continue;
    events.push({
      eventType: "content_planned_publish",
      date: item.plannedPublishAt,
      campaignId: item.campaignId,
      campaignName: campaignNameById.get(item.campaignId) ?? "",
      contentItemId: item.id,
      title: item.title,
      status: item.status,
      channel: item.intendedChannel,
    });
  }

  events.sort((a, b) => a.date.getTime() - b.date.getTime());
  return events;
}
