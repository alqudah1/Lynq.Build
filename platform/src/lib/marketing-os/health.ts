import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingCampaignDestinations, marketingBudgetEntries, marketingApprovalLinks, agentApprovalRequests, marketingContentItems, marketingCampaignRuns } from "@/db/schema";
import { getCampaignForUser, type MarketingCampaign } from "./campaigns";
import { resolveEffectiveMarketingConfiguration } from "./configuration";
import type { MarketingCampaignHealthStatus } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/** A closed set of reason codes — never free text an LLM invents, and never a fabricated performance claim. */
export const CAMPAIGN_HEALTH_REASONS = [
  "start_date_near_missing_requirements",
  "overdue_content",
  "pending_approval",
  "no_audience",
  "no_destination",
  "missing_utm",
  "budget_missing",
  "workflow_stalled",
  "campaign_end_passed",
  "missing_review",
] as const;
export type CampaignHealthReason = (typeof CAMPAIGN_HEALTH_REASONS)[number];

export interface CampaignHealth {
  status: MarketingCampaignHealthStatus;
  reasons: CampaignHealthReason[];
}

/** Deterministic — every reason is a boolean signal computed from real data, never an opaque score or a fabricated performance claim. */
export function classifyCampaignHealth(reasons: CampaignHealthReason[]): MarketingCampaignHealthStatus {
  if (reasons.length === 0) return "healthy";
  if (reasons.length <= 2) return "attention";
  return "at_risk";
}

async function computeReasonsForCampaign(db: Db, organizationId: string, campaign: MarketingCampaign, staleCampaignThresholdDays: number): Promise<CampaignHealthReason[]> {
  const reasons: CampaignHealthReason[] = [];
  if (!["draft", "planning", "ready", "active", "paused"].includes(campaign.status)) return reasons;

  const now = Date.now();
  const nearThreshold = new Date(now + staleCampaignThresholdDays * 24 * 60 * 60 * 1000);

  if (!campaign.primaryAudienceId) reasons.push("no_audience");

  const [destination] = await db.select({ id: marketingCampaignDestinations.id }).from(marketingCampaignDestinations).where(and(eq(marketingCampaignDestinations.organizationId, organizationId), eq(marketingCampaignDestinations.campaignId, campaign.id), eq(marketingCampaignDestinations.isActive, true))).limit(1);
  if (!destination) reasons.push("no_destination");
  else {
    const destinations = await db.select().from(marketingCampaignDestinations).where(and(eq(marketingCampaignDestinations.organizationId, organizationId), eq(marketingCampaignDestinations.campaignId, campaign.id), eq(marketingCampaignDestinations.isActive, true)));
    if (destinations.some((d) => !d.utmSource || !d.utmMedium || !d.utmCampaign)) reasons.push("missing_utm");
  }

  const [budgetEntry] = await db.select({ id: marketingBudgetEntries.id }).from(marketingBudgetEntries).where(and(eq(marketingBudgetEntries.organizationId, organizationId), eq(marketingBudgetEntries.campaignId, campaign.id))).limit(1);
  if (!budgetEntry && campaign.budgetAmount) reasons.push("budget_missing");

  if (campaign.startDate && campaign.startDate <= nearThreshold && campaign.startDate.getTime() > now) {
    if (!campaign.primaryAudienceId || !destination) reasons.push("start_date_near_missing_requirements");
  }

  const contentItems = await db
    .select({ id: marketingContentItems.id, plannedPublishAt: marketingContentItems.plannedPublishAt, status: marketingContentItems.status })
    .from(marketingContentItems)
    .where(and(eq(marketingContentItems.organizationId, organizationId), eq(marketingContentItems.campaignId, campaign.id)));
  if (contentItems.some((c) => c.plannedPublishAt && c.plannedPublishAt.getTime() < now && !["published", "archived"].includes(c.status))) reasons.push("overdue_content");

  const [pendingApproval] = await db
    .select({ id: marketingApprovalLinks.id })
    .from(marketingApprovalLinks)
    .innerJoin(agentApprovalRequests, eq(agentApprovalRequests.id, marketingApprovalLinks.approvalRequestId))
    .innerJoin(marketingContentItems, eq(marketingContentItems.id, marketingApprovalLinks.linkedEntityId))
    .where(and(eq(marketingApprovalLinks.organizationId, organizationId), eq(marketingApprovalLinks.linkedEntityType, "content_item"), eq(marketingContentItems.campaignId, campaign.id), eq(agentApprovalRequests.status, "pending")))
    .limit(1);
  if (pendingApproval) reasons.push("pending_approval");

  const [activeRun] = await db.select({ id: marketingCampaignRuns.id }).from(marketingCampaignRuns).where(and(eq(marketingCampaignRuns.organizationId, organizationId), eq(marketingCampaignRuns.campaignId, campaign.id), eq(marketingCampaignRuns.status, "waiting"))).limit(1);
  if (activeRun) reasons.push("workflow_stalled");

  if (campaign.endDate && campaign.endDate.getTime() < now && campaign.status !== "completed") {
    reasons.push("campaign_end_passed");
    reasons.push("missing_review");
  }

  return reasons;
}

export async function computeCampaignHealth(db: Db, input: { organizationId: string; workspaceId?: string | null; campaignId: string; actorUserId: string }): Promise<CampaignHealth> {
  const campaign = await getCampaignForUser(db, { organizationId: input.organizationId, campaignId: input.campaignId, actorUserId: input.actorUserId });
  const config = await resolveEffectiveMarketingConfiguration(db, input.organizationId, input.workspaceId ?? null);
  const reasons = await computeReasonsForCampaign(db, input.organizationId, campaign, config.staleCampaignThresholdDays);
  return { status: classifyCampaignHealth(reasons), reasons };
}

export async function computeCampaignHealthForMany(db: Db, input: { organizationId: string; workspaceId?: string | null; campaigns: MarketingCampaign[] }): Promise<Map<string, CampaignHealth>> {
  const config = await resolveEffectiveMarketingConfiguration(db, input.organizationId, input.workspaceId ?? null);
  const results = new Map<string, CampaignHealth>();
  for (const campaign of input.campaigns) {
    const reasons = await computeReasonsForCampaign(db, input.organizationId, campaign, config.staleCampaignThresholdDays);
    results.set(campaign.id, { status: classifyCampaignHealth(reasons), reasons });
  }
  return results;
}
