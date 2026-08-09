import "server-only";
import { and, eq, lt, isNull, isNotNull, count, sql } from "drizzle-orm";
import { crmOpportunities, crmPipelineStages, crmLeads } from "@/db/schema";
import { resolveSalesAuthContext, requireSalesViewAuthority } from "@/lib/sales-os/authz";
import { workspaceScopeCondition } from "../query-support";
import type { MetricHandler, MetricComputeContext, MetricComputeResult } from "./types";

/** Every Sales metric independently re-checks Sales OS's own aggregate-safe view authority — the Analytics-side `analytics_view_sales` capability never substitutes for it. */
async function requireSalesAggregateAccess(ctx: MetricComputeContext): Promise<void> {
  const salesCtx = await resolveSalesAuthContext(ctx.db, { organizationId: ctx.organizationId, actorUserId: ctx.actorUserId });
  await requireSalesViewAuthority(ctx.db, salesCtx, "crm_opportunity", "analytics");
}

function single(value: number | null): MetricComputeResult {
  return { points: [{ value }], freshness: "live", asOf: new Date() };
}

export const salesPipelineWeightedValue: MetricHandler = {
  definition: {
    metricKey: "sales_pipeline_weighted_value",
    name: "Weighted pipeline value",
    description: "Sum of amount × stage probability for open opportunities — a probability-weighted ESTIMATE, never presented as actual revenue.",
    domain: "sales",
    valueType: "currency",
    aggregationType: "sum",
    unit: null,
    classification: "estimated",
    supportsTimeSeries: false,
    supportedTimeGrains: [],
    supportedDimensions: ["pipeline"],
    version: 1,
    nullSemantics: "0 means no open opportunities carry both an amount and a stage probability — never null.",
  },
  compute: async (ctx) => {
    await requireSalesAggregateAccess(ctx);
    const [row] = await ctx.db
      .select({ value: sql<number>`coalesce(sum(${crmOpportunities.amount} * coalesce(${crmPipelineStages.probability}, 0) / 100.0), 0)::float` })
      .from(crmOpportunities)
      .innerJoin(crmPipelineStages, eq(crmPipelineStages.id, crmOpportunities.stageId))
      .where(and(eq(crmOpportunities.organizationId, ctx.organizationId), eq(crmOpportunities.status, "open"), workspaceScopeCondition(crmOpportunities.workspaceId, ctx.workspaceId)));
    return single(row.value);
  },
};

export const salesOpportunitiesAtRisk: MetricHandler = {
  definition: {
    metricKey: "sales_opportunities_at_risk",
    name: "Opportunities past expected close",
    description: "Open opportunities whose expectedCloseDate has already passed — a narrow, single-reason proxy. The full multi-reason health classification remains canonical on each opportunity's own detail page (Sales OS Module 13).",
    domain: "sales",
    valueType: "count",
    aggregationType: "count",
    unit: "opportunities",
    classification: "derived",
    supportsTimeSeries: false,
    supportedTimeGrains: [],
    supportedDimensions: ["pipeline", "owner"],
    version: 1,
    nullSemantics: "0 means no open opportunity is past its expected close date — never null.",
  },
  compute: async (ctx) => {
    await requireSalesAggregateAccess(ctx);
    const [row] = await ctx.db
      .select({ value: count() })
      .from(crmOpportunities)
      .where(and(eq(crmOpportunities.organizationId, ctx.organizationId), eq(crmOpportunities.status, "open"), isNotNull(crmOpportunities.expectedCloseDate), lt(crmOpportunities.expectedCloseDate, ctx.to), workspaceScopeCondition(crmOpportunities.workspaceId, ctx.workspaceId)));
    return single(row.value);
  },
  drilldown: async (ctx) => {
    await requireSalesAggregateAccess(ctx);
    const rows = await ctx.db
      .select({ id: crmOpportunities.id })
      .from(crmOpportunities)
      .where(and(eq(crmOpportunities.organizationId, ctx.organizationId), eq(crmOpportunities.status, "open"), isNotNull(crmOpportunities.expectedCloseDate), lt(crmOpportunities.expectedCloseDate, ctx.to), workspaceScopeCondition(crmOpportunities.workspaceId, ctx.workspaceId)))
      .limit(200);
    return { entityType: "crm_opportunity", ids: rows.map((r) => r.id), totalCount: rows.length };
  },
};

export const salesQualificationConversionRate: MetricHandler = {
  definition: {
    metricKey: "sales_qualification_conversion_rate",
    name: "Qualification conversion rate",
    description: "Of leads that reached a qualification OUTCOME (qualified or disqualified) within the range, the percentage that were qualified. CRM leads carry no workspace of their own — always organization-wide, even under a workspace-scoped query.",
    domain: "sales",
    valueType: "percentage",
    aggregationType: "ratio",
    unit: "%",
    classification: "derived",
    supportsTimeSeries: false,
    supportedTimeGrains: [],
    supportedDimensions: [],
    version: 1,
    nullSemantics: "null (not 0%) means no lead reached a qualification outcome in this range yet — a zero denominator, not a zero rate.",
  },
  compute: async (ctx) => {
    await requireSalesAggregateAccess(ctx);
    // CRM leads have no `workspaceId` column — organization-wide by data model.
    const [qualifiedRow] = await ctx.db.select({ value: count() }).from(crmLeads).where(and(eq(crmLeads.organizationId, ctx.organizationId), isNotNull(crmLeads.qualifiedAt), sql`${crmLeads.qualifiedAt} >= ${ctx.from} AND ${crmLeads.qualifiedAt} <= ${ctx.to}`));
    const [disqualifiedRow] = await ctx.db.select({ value: count() }).from(crmLeads).where(and(eq(crmLeads.organizationId, ctx.organizationId), isNotNull(crmLeads.disqualifiedAt), sql`${crmLeads.disqualifiedAt} >= ${ctx.from} AND ${crmLeads.disqualifiedAt} <= ${ctx.to}`));
    const denominator = qualifiedRow.value + disqualifiedRow.value;
    if (denominator === 0) return single(null);
    return single(Math.round((qualifiedRow.value / denominator) * 1000) / 10);
  },
};

export const salesLeadsUnassigned: MetricHandler = {
  definition: {
    metricKey: "sales_leads_unassigned",
    name: "Unassigned leads",
    description: "Open leads (new/contacted/engaged) with no owner assigned. CRM leads carry no workspace of their own — always organization-wide, even under a workspace-scoped query.",
    domain: "sales",
    valueType: "count",
    aggregationType: "count",
    unit: "leads",
    classification: "actual",
    supportsTimeSeries: false,
    supportedTimeGrains: [],
    supportedDimensions: ["source"],
    version: 1,
    nullSemantics: "0 means every open lead has an owner — never null.",
  },
  compute: async (ctx) => {
    await requireSalesAggregateAccess(ctx);
    // CRM leads have no `workspaceId` column — organization-wide by data model.
    const [row] = await ctx.db
      .select({ value: count() })
      .from(crmLeads)
      .where(and(eq(crmLeads.organizationId, ctx.organizationId), isNull(crmLeads.ownerUserId), sql`${crmLeads.status} IN ('new','contacted','engaged')`));
    return single(row.value);
  },
};

export const SALES_METRICS: MetricHandler[] = [salesPipelineWeightedValue, salesOpportunitiesAtRisk, salesQualificationConversionRate, salesLeadsUnassigned];
