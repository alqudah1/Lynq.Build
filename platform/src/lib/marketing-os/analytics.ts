import "server-only";
import { and, eq, inArray, count } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingCampaigns, marketingContentItems, marketingApprovalLinks, agentApprovalRequests, marketingBudgetEntries, marketingAttributionRecords, crmLeads, crmOpportunities, workflowExecutions } from "@/db/schema";
import { resolveMarketingAuthContext, requireMarketingViewAuthority } from "./authz";
import { resolveCrmAuthContext, requireCrmViewAuthority } from "@/lib/crm/authz";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Marketing OS operational analytics — Module 15
 * ============================================================================
 * Operational counts derived from real Marketing OS/CRM/Workflow data
 * only. Never fabricates impressions, reach, clicks, CPC, CTR, or ROAS —
 * this module has no real external channel integration to source those
 * from. CRM-derived figures (campaign-sourced leads, qualified leads,
 * opportunities, won value) require CRM view authority in addition to
 * Marketing view authority — the same dual-gate every other CRM-touching
 * Marketing OS read already uses.
 */
export interface MarketingAnalyticsSummary {
  campaignsByStatus: Record<string, number>;
  campaignsStartingSoon: number;
  overdueContentCount: number;
  contentByStatus: Record<string, number>;
  pendingApprovalsCount: number;
  budgetPlannedTotal: number;
  budgetRecordedSpendTotal: number;
  campaignSourcedLeadCount: number;
  qualifiedLeadCountByCampaign: Record<string, number>;
  opportunityCountByCampaignSource: Record<string, number>;
  wonValueByCampaignSource: Record<string, number>;
  workflowExecutionsByStatus: Record<string, number>;
}

export async function getMarketingAnalyticsSummary(db: Db, input: { organizationId: string; actorUserId: string; startingSoonWithinDays?: number }): Promise<MarketingAnalyticsSummary> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_analytics", "view");

  const campaigns = await db.select().from(marketingCampaigns).where(eq(marketingCampaigns.organizationId, input.organizationId));
  const campaignsByStatus: Record<string, number> = {};
  for (const c of campaigns) campaignsByStatus[c.status] = (campaignsByStatus[c.status] ?? 0) + 1;

  const startingSoonThreshold = new Date(Date.now() + (input.startingSoonWithinDays ?? 14) * 24 * 60 * 60 * 1000);
  const campaignsStartingSoon = campaigns.filter((c) => c.startDate && c.startDate.getTime() > Date.now() && c.startDate <= startingSoonThreshold).length;

  const contentItems = await db.select().from(marketingContentItems).where(eq(marketingContentItems.organizationId, input.organizationId));
  const contentByStatus: Record<string, number> = {};
  for (const c of contentItems) contentByStatus[c.status] = (contentByStatus[c.status] ?? 0) + 1;
  const overdueContentCount = contentItems.filter((c) => c.plannedPublishAt && c.plannedPublishAt.getTime() < Date.now() && !["published", "archived"].includes(c.status)).length;

  const contentItemIds = contentItems.map((c) => c.id);
  const pendingApprovalsCount = contentItemIds.length
    ? (
        await db
          .select({ id: marketingApprovalLinks.id })
          .from(marketingApprovalLinks)
          .innerJoin(agentApprovalRequests, eq(agentApprovalRequests.id, marketingApprovalLinks.approvalRequestId))
          .where(and(eq(marketingApprovalLinks.organizationId, input.organizationId), eq(marketingApprovalLinks.linkedEntityType, "content_item"), inArray(marketingApprovalLinks.linkedEntityId, contentItemIds), eq(agentApprovalRequests.status, "pending")))
      ).length
    : 0;

  const budgetEntries = await db.select().from(marketingBudgetEntries).where(eq(marketingBudgetEntries.organizationId, input.organizationId));
  const budgetPlannedTotal = budgetEntries.reduce((sum, b) => sum + (b.plannedAmount ? Number(b.plannedAmount) : 0), 0);
  const budgetRecordedSpendTotal = budgetEntries.reduce((sum, b) => sum + (b.spendAmount ? Number(b.spendAmount) : 0), 0);

  const workflowExecutionRows = campaigns.length
    ? await db
        .select({ status: workflowExecutions.status, value: count() })
        .from(workflowExecutions)
        .innerJoin(marketingCampaigns, eq(marketingCampaigns.workflowDefinitionId, workflowExecutions.workflowDefinitionId))
        .where(eq(marketingCampaigns.organizationId, input.organizationId))
        .groupBy(workflowExecutions.status)
    : [];
  const workflowExecutionsByStatus: Record<string, number> = {};
  for (const row of workflowExecutionRows) workflowExecutionsByStatus[row.status] = row.value;

  // CRM-derived figures — dual-gated (Marketing view already passed above; CRM view required here too).
  const crmCtx = await resolveCrmAuthContext(db, { organizationId: input.organizationId, workspaceId: null, actorUserId: input.actorUserId });
  await requireCrmViewAuthority(db, crmCtx, "crm_lead", "list");

  const attributionRows = await db.select().from(marketingAttributionRecords).where(and(eq(marketingAttributionRecords.organizationId, input.organizationId), eq(marketingAttributionRecords.touchType, "first_touch")));
  const leadIdsByCampaign = new Map<string, string[]>();
  for (const row of attributionRows) {
    if (!row.campaignId || !row.crmLeadId) continue;
    const list = leadIdsByCampaign.get(row.campaignId) ?? [];
    list.push(row.crmLeadId);
    leadIdsByCampaign.set(row.campaignId, list);
  }
  const allAttributedLeadIds = [...new Set(attributionRows.map((r) => r.crmLeadId).filter((id): id is string => id !== null))];
  const campaignSourcedLeadCount = allAttributedLeadIds.length;

  const qualifiedLeadCountByCampaign: Record<string, number> = {};
  if (allAttributedLeadIds.length > 0) {
    const leadRows = await db.select({ id: crmLeads.id, status: crmLeads.status }).from(crmLeads).where(and(eq(crmLeads.organizationId, input.organizationId), inArray(crmLeads.id, allAttributedLeadIds)));
    const statusByLeadId = new Map(leadRows.map((l) => [l.id, l.status]));
    for (const [campaignId, leadIds] of leadIdsByCampaign) {
      qualifiedLeadCountByCampaign[campaignId] = leadIds.filter((id) => statusByLeadId.get(id) === "qualified" || statusByLeadId.get(id) === "converted").length;
    }
  }

  const opportunityCountByCampaignSource: Record<string, number> = {};
  const wonValueByCampaignSource: Record<string, number> = {};
  const campaignsWithSource = campaigns.filter((c) => c.sourceId);
  if (campaignsWithSource.length > 0) {
    const sourceIds = campaignsWithSource.map((c) => c.sourceId!);
    const opportunityRows = await db.select({ sourceId: crmOpportunities.sourceId, status: crmOpportunities.status, amount: crmOpportunities.amount }).from(crmOpportunities).where(and(eq(crmOpportunities.organizationId, input.organizationId), inArray(crmOpportunities.sourceId, sourceIds)));
    for (const campaign of campaignsWithSource) {
      const matching = opportunityRows.filter((o) => o.sourceId === campaign.sourceId);
      opportunityCountByCampaignSource[campaign.id] = matching.length;
      wonValueByCampaignSource[campaign.id] = matching.filter((o) => o.status === "won").reduce((sum, o) => sum + (o.amount ? Number(o.amount) : 0), 0);
    }
  }

  return {
    campaignsByStatus,
    campaignsStartingSoon,
    overdueContentCount,
    contentByStatus,
    pendingApprovalsCount,
    budgetPlannedTotal,
    budgetRecordedSpendTotal,
    campaignSourcedLeadCount,
    qualifiedLeadCountByCampaign,
    opportunityCountByCampaignSource,
    wonValueByCampaignSource,
    workflowExecutionsByStatus,
  };
}
