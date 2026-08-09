import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { and, eq, gte, lte, count } from "drizzle-orm";
import { marketingCampaigns, marketingContentItems } from "@/db/schema";
import { resolveMarketingAuthContext, requireMarketingViewAuthority } from "@/lib/marketing-os/authz";
import { runAnalyticsQuery, type AnalyticsMetricResult } from "@/lib/analytics-os/query";
import { workspaceScopeCondition } from "@/lib/analytics-os/query-support";
import { resolveFounderAuthContext, requireFounderViewAuthority, hasFounderCapability } from "./authz";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface ExecutiveMarketingView {
  metrics: AnalyticsMetricResult[];
  upcomingLaunches: { id: string; name: string; startDate: string }[];
  pendingContentApprovals: number;
}

/**
 * ============================================================================
 * Executive Marketing view — Module 18
 * ============================================================================
 * Every count/lead/won-value figure is one of Analytics OS's own already-
 * registered Marketing metrics (never a duplicated query) — including
 * `marketing_manual_spend`, always returned with `classification: "manual"`
 * by Analytics OS itself. No impressions/CTR/ROAS are shown, because no
 * such metric exists in the registry — there is no ad-platform integration
 * to source them from.
 */
export async function computeExecutiveMarketingView(db: Db, input: { organizationId: string; workspaceId: string | null; actorUserId: string }): Promise<ExecutiveMarketingView> {
  const founderCtx = await resolveFounderAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireFounderViewAuthority(db, founderCtx, "founder_marketing_view", input.organizationId);
  if (!hasFounderCapability(founderCtx, "founder_workspace_view_marketing")) return { metrics: [], upcomingLaunches: [], pendingContentApprovals: 0 };

  const canSeeFinancials = hasFounderCapability(founderCtx, "founder_workspace_view_financial");
  const allKeys = ["marketing_campaigns_active", "marketing_content_overdue", "marketing_campaign_sourced_leads", "marketing_campaign_qualified_leads", "marketing_campaign_sourced_won_value", "marketing_planned_budget", "marketing_manual_spend"];
  const metricKeys = canSeeFinancials ? allKeys : allKeys.filter((k) => !["marketing_campaign_sourced_won_value", "marketing_planned_budget", "marketing_manual_spend"].includes(k));

  const [result, marketingCtx] = await Promise.all([
    runAnalyticsQuery(db, { organizationId: input.organizationId, workspaceId: input.workspaceId, actorUserId: input.actorUserId, metricKeys, recordAudit: false }),
    resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId }),
  ]);
  await requireMarketingViewAuthority(db, marketingCtx, "marketing_campaign", "founder_marketing_view");

  const now = new Date();
  const soonWindow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const upcoming = await db
    .select({ id: marketingCampaigns.id, name: marketingCampaigns.name, startDate: marketingCampaigns.startDate })
    .from(marketingCampaigns)
    .where(and(eq(marketingCampaigns.organizationId, input.organizationId), gte(marketingCampaigns.startDate, now), lte(marketingCampaigns.startDate, soonWindow), workspaceScopeCondition(marketingCampaigns.workspaceId, input.workspaceId)))
    .limit(10);

  const [pendingContentRow] = await db
    .select({ value: count() })
    .from(marketingContentItems)
    .innerJoin(marketingCampaigns, eq(marketingCampaigns.id, marketingContentItems.campaignId))
    .where(and(eq(marketingContentItems.organizationId, input.organizationId), eq(marketingContentItems.status, "review"), workspaceScopeCondition(marketingCampaigns.workspaceId, input.workspaceId)));

  return {
    metrics: result.metrics,
    upcomingLaunches: upcoming.filter((c) => c.startDate).map((c) => ({ id: c.id, name: c.name, startDate: c.startDate!.toISOString() })),
    pendingContentApprovals: pendingContentRow.value,
  };
}
