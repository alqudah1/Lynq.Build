import "server-only";
import { and, eq, lt, isNotNull, count, sql } from "drizzle-orm";
import { marketingCampaigns, marketingContentItems, marketingAttributionRecords, marketingBudgetEntries, crmLeads, crmOpportunities } from "@/db/schema";
import { resolveMarketingAuthContext, requireMarketingViewAuthority } from "@/lib/marketing-os/authz";
import { workspaceScopeCondition } from "../query-support";
import type { MetricHandler, MetricComputeContext, MetricComputeResult } from "./types";

async function requireMarketingAggregateAccess(ctx: MetricComputeContext): Promise<void> {
  const marketingCtx = await resolveMarketingAuthContext(ctx.db, { organizationId: ctx.organizationId, actorUserId: ctx.actorUserId });
  await requireMarketingViewAuthority(ctx.db, marketingCtx, "marketing_campaign", "analytics");
}

function single(value: number | null): MetricComputeResult {
  return { points: [{ value }], freshness: "live", asOf: new Date() };
}

export const marketingCampaignsActive: MetricHandler = {
  definition: {
    metricKey: "marketing_campaigns_active",
    name: "Active campaigns",
    description: "Campaigns currently in active or ready status.",
    domain: "marketing",
    valueType: "count",
    aggregationType: "count",
    unit: "campaigns",
    classification: "actual",
    supportsTimeSeries: false,
    supportedTimeGrains: [],
    supportedDimensions: [],
    version: 1,
    nullSemantics: "0 means no active or ready campaigns right now — never null.",
  },
  compute: async (ctx) => {
    await requireMarketingAggregateAccess(ctx);
    const [row] = await ctx.db
      .select({ value: count() })
      .from(marketingCampaigns)
      .where(and(eq(marketingCampaigns.organizationId, ctx.organizationId), sql`${marketingCampaigns.status} IN ('active','ready')`, workspaceScopeCondition(marketingCampaigns.workspaceId, ctx.workspaceId)));
    return single(row.value);
  },
};

export const marketingContentOverdue: MetricHandler = {
  definition: {
    metricKey: "marketing_content_overdue",
    name: "Overdue content",
    description: "Content items whose plannedPublishAt has passed without reaching published or archived status. Content items carry no workspace column of their own — scoped through their own campaign's real `workspaceId` via a join, never left organization-wide when a workspace is requested.",
    domain: "marketing",
    valueType: "count",
    aggregationType: "count",
    unit: "content items",
    classification: "actual",
    supportsTimeSeries: false,
    supportedTimeGrains: [],
    supportedDimensions: [],
    version: 1,
    nullSemantics: "0 means no overdue content right now — never null.",
  },
  compute: async (ctx) => {
    await requireMarketingAggregateAccess(ctx);
    const [row] = await ctx.db
      .select({ value: count() })
      .from(marketingContentItems)
      .innerJoin(marketingCampaigns, eq(marketingCampaigns.id, marketingContentItems.campaignId))
      .where(
        and(
          eq(marketingContentItems.organizationId, ctx.organizationId),
          isNotNull(marketingContentItems.plannedPublishAt),
          lt(marketingContentItems.plannedPublishAt, ctx.to),
          sql`${marketingContentItems.status} NOT IN ('published','archived')`,
          workspaceScopeCondition(marketingCampaigns.workspaceId, ctx.workspaceId)
        )
      );
    return single(row.value);
  },
  drilldown: async (ctx) => {
    await requireMarketingAggregateAccess(ctx);
    const rows = await ctx.db
      .select({ id: marketingContentItems.id })
      .from(marketingContentItems)
      .innerJoin(marketingCampaigns, eq(marketingCampaigns.id, marketingContentItems.campaignId))
      .where(
        and(
          eq(marketingContentItems.organizationId, ctx.organizationId),
          isNotNull(marketingContentItems.plannedPublishAt),
          lt(marketingContentItems.plannedPublishAt, ctx.to),
          sql`${marketingContentItems.status} NOT IN ('published','archived')`,
          workspaceScopeCondition(marketingCampaigns.workspaceId, ctx.workspaceId)
        )
      )
      .limit(200);
    return { entityType: "marketing_content_item", ids: rows.map((r) => r.id), totalCount: rows.length };
  },
};

export const marketingCampaignSourcedLeads: MetricHandler = {
  definition: {
    metricKey: "marketing_campaign_sourced_leads",
    name: "Campaign-sourced leads",
    description: "Distinct CRM leads with a real first-touch attribution record pointing at a campaign, captured within the range. Only counts a real canonical link — never inferred. Attribution records carry no workspace column of their own — scoped through their own campaign's real workspaceId via a join.",
    domain: "marketing",
    valueType: "count",
    aggregationType: "count",
    unit: "leads",
    classification: "actual",
    supportsTimeSeries: true,
    supportedTimeGrains: ["day", "week", "month", "quarter"],
    supportedDimensions: ["campaign"],
    version: 1,
    nullSemantics: "0 means no campaign-attributed leads captured in this range — never null.",
  },
  compute: async (ctx) => {
    await requireMarketingAggregateAccess(ctx);
    const base = and(
      eq(marketingAttributionRecords.organizationId, ctx.organizationId),
      eq(marketingAttributionRecords.touchType, "first_touch"),
      isNotNull(marketingAttributionRecords.campaignId),
      isNotNull(marketingAttributionRecords.crmLeadId),
      sql`${marketingAttributionRecords.capturedAt} >= ${ctx.from} AND ${marketingAttributionRecords.capturedAt} <= ${ctx.to}`,
      workspaceScopeCondition(marketingCampaigns.workspaceId, ctx.workspaceId)
    );
    if (ctx.groupBy === "campaign") {
      const rows = await ctx.db
        .select({ value: count(), dim: marketingAttributionRecords.campaignId })
        .from(marketingAttributionRecords)
        .innerJoin(marketingCampaigns, eq(marketingCampaigns.id, marketingAttributionRecords.campaignId))
        .where(base)
        .groupBy(marketingAttributionRecords.campaignId);
      return { points: rows.map((r) => ({ value: r.value, dimensionValue: r.dim ?? "none", dimensionLabel: r.dim ?? "none" })), freshness: "live", asOf: new Date() };
    }
    const [row] = await ctx.db
      .select({ value: count() })
      .from(marketingAttributionRecords)
      .innerJoin(marketingCampaigns, eq(marketingCampaigns.id, marketingAttributionRecords.campaignId))
      .where(base);
    return single(row.value);
  },
  computeSeries: async (ctx, grain) => {
    await requireMarketingAggregateAccess(ctx);
    if (!ctx.workspaceId) {
      const { seriesByDay } = await import("../query-support");
      return seriesByDay(
        ctx.db,
        marketingAttributionRecords,
        marketingAttributionRecords.capturedAt,
        and(eq(marketingAttributionRecords.organizationId, ctx.organizationId), eq(marketingAttributionRecords.touchType, "first_touch"), isNotNull(marketingAttributionRecords.campaignId), isNotNull(marketingAttributionRecords.crmLeadId))!,
        ctx.from,
        ctx.to,
        grain
      );
    }
    // `seriesByDay` queries a single table with no join support — a workspace-scoped series needs the same
    // campaign join `compute()` above uses, so it's built directly here rather than through that shared helper.
    const { GRAIN_TO_POSTGRES_MAP } = await import("../query-support");
    const bucket = sql<string>`date_trunc(${GRAIN_TO_POSTGRES_MAP[grain]}, ${marketingAttributionRecords.capturedAt})`;
    const rows = await ctx.db
      .select({ bucket, value: sql<number>`count(*)::int` })
      .from(marketingAttributionRecords)
      .innerJoin(marketingCampaigns, eq(marketingCampaigns.id, marketingAttributionRecords.campaignId))
      .where(
        and(
          eq(marketingAttributionRecords.organizationId, ctx.organizationId),
          eq(marketingAttributionRecords.touchType, "first_touch"),
          isNotNull(marketingAttributionRecords.campaignId),
          isNotNull(marketingAttributionRecords.crmLeadId),
          sql`${marketingAttributionRecords.capturedAt} >= ${ctx.from} AND ${marketingAttributionRecords.capturedAt} <= ${ctx.to}`,
          eq(marketingCampaigns.workspaceId, ctx.workspaceId)
        )
      )
      .groupBy(bucket)
      .orderBy(bucket);
    return rows.map((r) => ({ bucketStart: new Date(r.bucket).toISOString(), value: r.value }));
  },
};

export const marketingCampaignQualifiedLeads: MetricHandler = {
  definition: {
    metricKey: "marketing_campaign_qualified_leads",
    name: "Campaign-sourced qualified leads",
    description: "Of campaign-attributed leads, the count that reached CRM's own qualified status — a real join through the canonical attribution → lead link, never inferred. Scoped through the attributing campaign's own real workspaceId via a join.",
    domain: "marketing",
    valueType: "count",
    aggregationType: "count",
    unit: "leads",
    classification: "actual",
    supportsTimeSeries: false,
    supportedTimeGrains: [],
    supportedDimensions: ["campaign"],
    version: 1,
    nullSemantics: "0 means no campaign-attributed lead has qualified — never null.",
  },
  compute: async (ctx) => {
    await requireMarketingAggregateAccess(ctx);
    const [row] = await ctx.db
      .select({ value: sql<number>`count(distinct ${crmLeads.id})::int` })
      .from(marketingAttributionRecords)
      .innerJoin(crmLeads, eq(crmLeads.id, marketingAttributionRecords.crmLeadId))
      .innerJoin(marketingCampaigns, eq(marketingCampaigns.id, marketingAttributionRecords.campaignId))
      .where(
        and(
          eq(marketingAttributionRecords.organizationId, ctx.organizationId),
          eq(marketingAttributionRecords.touchType, "first_touch"),
          isNotNull(marketingAttributionRecords.campaignId),
          eq(crmLeads.status, "qualified"),
          workspaceScopeCondition(marketingCampaigns.workspaceId, ctx.workspaceId)
        )
      );
    return single(row.value);
  },
};

export const marketingCampaignSourcedWonValue: MetricHandler = {
  definition: {
    metricKey: "marketing_campaign_sourced_won_value",
    name: "Campaign-sourced won value",
    description: "Sum of amount for won opportunities that trace back through a real first-touch campaign attribution → lead → converted-opportunity chain, won within the range. The full cross-module link (campaign → lead → opportunity → won) — only counted where every step is a real canonical reference, never inferred from timing or coincidence. Workspace scope is the won OPPORTUNITY's own real workspaceId — the deal's own actual workspace, not the originating campaign's.",
    domain: "marketing",
    valueType: "currency",
    aggregationType: "sum",
    unit: null,
    classification: "actual",
    supportsTimeSeries: false,
    supportedTimeGrains: [],
    supportedDimensions: ["campaign"],
    version: 1,
    nullSemantics: "0 means no campaign-attributed opportunity won in this range — never null.",
  },
  compute: async (ctx) => {
    await requireMarketingAggregateAccess(ctx);
    const base = and(
      eq(marketingAttributionRecords.organizationId, ctx.organizationId),
      eq(marketingAttributionRecords.touchType, "first_touch"),
      isNotNull(marketingAttributionRecords.campaignId),
      isNotNull(marketingAttributionRecords.crmLeadId),
      eq(crmOpportunities.status, "won"),
      sql`${crmOpportunities.wonAt} >= ${ctx.from} AND ${crmOpportunities.wonAt} <= ${ctx.to}`,
      workspaceScopeCondition(crmOpportunities.workspaceId, ctx.workspaceId)
    );
    const fromClause = marketingAttributionRecords.crmLeadId;
    if (ctx.groupBy === "campaign") {
      const rows = await ctx.db
        .select({ value: sql<number>`coalesce(sum(${crmOpportunities.amount}), 0)::float`, dim: marketingAttributionRecords.campaignId })
        .from(marketingAttributionRecords)
        .innerJoin(crmLeads, eq(crmLeads.id, fromClause))
        .innerJoin(crmOpportunities, eq(crmOpportunities.id, crmLeads.convertedOpportunityId))
        .where(base)
        .groupBy(marketingAttributionRecords.campaignId);
      return { points: rows.map((r) => ({ value: r.value, dimensionValue: r.dim ?? "none", dimensionLabel: r.dim ?? "none" })), freshness: "live", asOf: new Date() };
    }
    const [row] = await ctx.db
      .select({ value: sql<number>`coalesce(sum(${crmOpportunities.amount}), 0)::float` })
      .from(marketingAttributionRecords)
      .innerJoin(crmLeads, eq(crmLeads.id, fromClause))
      .innerJoin(crmOpportunities, eq(crmOpportunities.id, crmLeads.convertedOpportunityId))
      .where(base);
    return single(row.value);
  },
};

export const marketingPlannedBudget: MetricHandler = {
  definition: {
    metricKey: "marketing_planned_budget",
    name: "Planned budget",
    description: "Sum of plannedAmount across all campaign budget entries. Budget entries carry no workspace column of their own — scoped through their own campaign's real workspaceId via a join.",
    domain: "marketing",
    valueType: "currency",
    aggregationType: "sum",
    unit: null,
    classification: "actual",
    supportsTimeSeries: false,
    supportedTimeGrains: [],
    supportedDimensions: ["campaign"],
    version: 1,
    nullSemantics: "0 means no budget entries carry a planned amount — never null.",
  },
  compute: async (ctx) => {
    await requireMarketingAggregateAccess(ctx);
    const [row] = await ctx.db
      .select({ value: sql<number>`coalesce(sum(${marketingBudgetEntries.plannedAmount}), 0)::float` })
      .from(marketingBudgetEntries)
      .innerJoin(marketingCampaigns, eq(marketingCampaigns.id, marketingBudgetEntries.campaignId))
      .where(and(eq(marketingBudgetEntries.organizationId, ctx.organizationId), workspaceScopeCondition(marketingCampaigns.workspaceId, ctx.workspaceId)));
    return single(row.value);
  },
};

export const marketingManualSpend: MetricHandler = {
  definition: {
    metricKey: "marketing_manual_spend",
    name: "Manual spend recorded",
    description: "Sum of spendAmount across budget entries with spendSource = manual — explicitly NOT provider-synced spend (no ad-platform integration exists yet), labeled manual everywhere it surfaces. Budget entries carry no workspace column of their own — scoped through their own campaign's real workspaceId via a join.",
    domain: "marketing",
    valueType: "currency",
    aggregationType: "sum",
    unit: null,
    classification: "manual",
    supportsTimeSeries: false,
    supportedTimeGrains: [],
    supportedDimensions: ["campaign"],
    version: 1,
    nullSemantics: "0 means no manual spend has been recorded — never null.",
  },
  compute: async (ctx) => {
    await requireMarketingAggregateAccess(ctx);
    const [row] = await ctx.db
      .select({ value: sql<number>`coalesce(sum(${marketingBudgetEntries.spendAmount}), 0)::float` })
      .from(marketingBudgetEntries)
      .innerJoin(marketingCampaigns, eq(marketingCampaigns.id, marketingBudgetEntries.campaignId))
      .where(and(eq(marketingBudgetEntries.organizationId, ctx.organizationId), eq(marketingBudgetEntries.spendSource, "manual"), workspaceScopeCondition(marketingCampaigns.workspaceId, ctx.workspaceId)));
    return single(row.value);
  },
};

export const MARKETING_METRICS: MetricHandler[] = [
  marketingCampaignsActive,
  marketingContentOverdue,
  marketingCampaignSourcedLeads,
  marketingCampaignQualifiedLeads,
  marketingCampaignSourcedWonValue,
  marketingPlannedBudget,
  marketingManualSpend,
];
