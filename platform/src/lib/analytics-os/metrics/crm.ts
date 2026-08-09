import "server-only";
import { and, eq, gte, lte, count, sum, isNotNull } from "drizzle-orm";
import { crmContacts, crmLeads, crmOpportunities, crmFollowUps } from "@/db/schema";
import { resolveCrmAuthContext, requireCrmViewAuthority } from "@/lib/crm/authz";
import { workspaceScopeCondition } from "../query-support";
import type { MetricHandler, MetricComputeContext, MetricComputeResult } from "./types";

/** Every CRM metric independently re-checks CRM Core's own aggregate-safe view authority — the Analytics-side `analytics_view_crm` capability (checked once by the query engine before dispatch) never substitutes for it. */
async function requireCrmAggregateAccess(ctx: MetricComputeContext): Promise<void> {
  const crmCtx = await resolveCrmAuthContext(ctx.db, { organizationId: ctx.organizationId, workspaceId: ctx.workspaceId, actorUserId: ctx.actorUserId });
  await requireCrmViewAuthority(ctx.db, crmCtx, "crm_contact", "analytics");
}

function single(value: number | null): MetricComputeResult {
  return { points: [{ value }], freshness: "live", asOf: new Date() };
}

export const crmContactsTotal: MetricHandler = {
  definition: {
    metricKey: "crm_contacts_total",
    name: "Total contacts",
    description: "Active CRM contacts as of the end of the selected range.",
    domain: "crm",
    valueType: "count",
    aggregationType: "count",
    unit: "contacts",
    classification: "actual",
    supportsTimeSeries: false,
    supportedTimeGrains: [],
    supportedDimensions: [],
    version: 1,
    nullSemantics: "0 means no active contacts exist yet — never null.",
  },
  compute: async (ctx) => {
    await requireCrmAggregateAccess(ctx);
    const [row] = await ctx.db
      .select({ value: count() })
      .from(crmContacts)
      .where(and(eq(crmContacts.organizationId, ctx.organizationId), eq(crmContacts.status, "active"), lte(crmContacts.createdAt, ctx.to), workspaceScopeCondition(crmContacts.workspaceId, ctx.workspaceId)));
    return single(row.value);
  },
};

export const crmLeadsOpen: MetricHandler = {
  definition: {
    metricKey: "crm_leads_open",
    name: "Open leads",
    description: "Leads not yet qualified, disqualified, or converted, created within the range. CRM leads carry no workspace of their own (see CRM Core's own `resolveCrmEntityWorkspaceId` precedent) — this metric is always organization-wide, even under a workspace-scoped query.",
    domain: "crm",
    valueType: "count",
    aggregationType: "count",
    unit: "leads",
    classification: "actual",
    supportsTimeSeries: true,
    supportedTimeGrains: ["day", "week", "month", "quarter"],
    supportedDimensions: ["source", "owner"],
    version: 1,
    nullSemantics: "0 means no open leads in this range — never null.",
  },
  compute: async (ctx) => {
    await requireCrmAggregateAccess(ctx);
    // CRM leads have no `workspaceId` column — organization-wide by data model, documented above.
    const base = and(eq(crmLeads.organizationId, ctx.organizationId), gte(crmLeads.createdAt, ctx.from), lte(crmLeads.createdAt, ctx.to));
    if (ctx.groupBy === "source") {
      const rows = await ctx.db.select({ value: count(), dim: crmLeads.sourceId }).from(crmLeads).where(and(base, eq(crmLeads.status, "new"))).groupBy(crmLeads.sourceId);
      return { points: rows.map((r) => ({ value: r.value, dimensionValue: r.dim ?? "none", dimensionLabel: r.dim ?? "No source" })), freshness: "live", asOf: new Date() };
    }
    const [row] = await ctx.db.select({ value: count() }).from(crmLeads).where(and(base, eq(crmLeads.status, "new")));
    return single(row.value);
  },
  computeSeries: async (ctx, grain) => {
    await requireCrmAggregateAccess(ctx);
    const { seriesByDay } = await import("../query-support");
    return seriesByDay(ctx.db, crmLeads, crmLeads.createdAt, and(eq(crmLeads.organizationId, ctx.organizationId), eq(crmLeads.status, "new"))!, ctx.from, ctx.to, grain);
  },
};

export const crmLeadsQualified: MetricHandler = {
  definition: {
    metricKey: "crm_leads_qualified",
    name: "Qualified leads",
    description: "Leads that reached qualified status, by their own qualifiedAt timestamp within the range. CRM leads carry no workspace of their own — this metric is always organization-wide, even under a workspace-scoped query.",
    domain: "crm",
    valueType: "count",
    aggregationType: "count",
    unit: "leads",
    classification: "actual",
    supportsTimeSeries: true,
    supportedTimeGrains: ["day", "week", "month", "quarter"],
    supportedDimensions: ["source"],
    version: 1,
    nullSemantics: "0 means no leads qualified in this range — never null.",
  },
  compute: async (ctx) => {
    await requireCrmAggregateAccess(ctx);
    // CRM leads have no `workspaceId` column — organization-wide by data model.
    const [row] = await ctx.db.select({ value: count() }).from(crmLeads).where(and(eq(crmLeads.organizationId, ctx.organizationId), isNotNull(crmLeads.qualifiedAt), gte(crmLeads.qualifiedAt, ctx.from), lte(crmLeads.qualifiedAt, ctx.to)));
    return single(row.value);
  },
};

export const crmOpportunitiesOpen: MetricHandler = {
  definition: {
    metricKey: "crm_opportunities_open",
    name: "Open opportunities",
    description: "Opportunities currently in an open (not won/lost) status.",
    domain: "crm",
    valueType: "count",
    aggregationType: "count",
    unit: "opportunities",
    classification: "actual",
    supportsTimeSeries: false,
    supportedTimeGrains: [],
    supportedDimensions: ["pipeline", "owner"],
    version: 1,
    nullSemantics: "0 means no open opportunities right now — never null.",
  },
  compute: async (ctx) => {
    await requireCrmAggregateAccess(ctx);
    const base = and(eq(crmOpportunities.organizationId, ctx.organizationId), eq(crmOpportunities.status, "open"), workspaceScopeCondition(crmOpportunities.workspaceId, ctx.workspaceId));
    if (ctx.groupBy === "pipeline") {
      const rows = await ctx.db.select({ value: count(), dim: crmOpportunities.pipelineId }).from(crmOpportunities).where(base).groupBy(crmOpportunities.pipelineId);
      return { points: rows.map((r) => ({ value: r.value, dimensionValue: r.dim, dimensionLabel: r.dim })), freshness: "live", asOf: new Date() };
    }
    const [row] = await ctx.db.select({ value: count() }).from(crmOpportunities).where(base);
    return single(row.value);
  },
};

export const crmOpportunitiesWon: MetricHandler = {
  definition: {
    metricKey: "crm_opportunities_won",
    name: "Won opportunities",
    description: "Opportunities marked won, by their own wonAt timestamp within the range.",
    domain: "crm",
    valueType: "count",
    aggregationType: "count",
    unit: "opportunities",
    classification: "actual",
    supportsTimeSeries: true,
    supportedTimeGrains: ["day", "week", "month", "quarter"],
    supportedDimensions: ["pipeline"],
    version: 1,
    nullSemantics: "0 means nothing won in this range — never null.",
  },
  compute: async (ctx) => {
    await requireCrmAggregateAccess(ctx);
    const [row] = await ctx.db
      .select({ value: count() })
      .from(crmOpportunities)
      .where(and(eq(crmOpportunities.organizationId, ctx.organizationId), eq(crmOpportunities.status, "won"), isNotNull(crmOpportunities.wonAt), gte(crmOpportunities.wonAt, ctx.from), lte(crmOpportunities.wonAt, ctx.to), workspaceScopeCondition(crmOpportunities.workspaceId, ctx.workspaceId)));
    return single(row.value);
  },
};

export const crmPipelineValue: MetricHandler = {
  definition: {
    metricKey: "crm_pipeline_value",
    name: "Open pipeline value",
    description: "Sum of amount across all currently open opportunities — a real recorded total, not a probability-weighted estimate.",
    domain: "crm",
    valueType: "currency",
    aggregationType: "sum",
    unit: null,
    classification: "actual",
    supportsTimeSeries: false,
    supportedTimeGrains: [],
    supportedDimensions: ["pipeline"],
    version: 1,
    nullSemantics: "0 means no open opportunities carry an amount — never null.",
  },
  compute: async (ctx) => {
    await requireCrmAggregateAccess(ctx);
    const [row] = await ctx.db
      .select({ value: sum(crmOpportunities.amount) })
      .from(crmOpportunities)
      .where(and(eq(crmOpportunities.organizationId, ctx.organizationId), eq(crmOpportunities.status, "open"), workspaceScopeCondition(crmOpportunities.workspaceId, ctx.workspaceId)));
    return single(row.value ? Number(row.value) : 0);
  },
};

export const crmWonValue: MetricHandler = {
  definition: {
    metricKey: "crm_won_value",
    name: "Won value",
    description: "Sum of amount across opportunities won within the range, by wonAt.",
    domain: "crm",
    valueType: "currency",
    aggregationType: "sum",
    unit: null,
    classification: "actual",
    supportsTimeSeries: true,
    supportedTimeGrains: ["day", "week", "month", "quarter"],
    supportedDimensions: ["pipeline"],
    version: 1,
    nullSemantics: "0 means nothing won in this range — never null.",
  },
  compute: async (ctx) => {
    await requireCrmAggregateAccess(ctx);
    const [row] = await ctx.db
      .select({ value: sum(crmOpportunities.amount) })
      .from(crmOpportunities)
      .where(
        and(
          eq(crmOpportunities.organizationId, ctx.organizationId),
          eq(crmOpportunities.status, "won"),
          isNotNull(crmOpportunities.wonAt),
          gte(crmOpportunities.wonAt, ctx.from),
          lte(crmOpportunities.wonAt, ctx.to),
          workspaceScopeCondition(crmOpportunities.workspaceId, ctx.workspaceId)
        )
      );
    return single(row.value ? Number(row.value) : 0);
  },
};

export const crmFollowupsOverdue: MetricHandler = {
  definition: {
    metricKey: "crm_followups_overdue",
    name: "Overdue follow-ups",
    description: "Open CRM follow-ups whose dueAt has already passed. CRM follow-ups carry no workspace of their own (their real scope, if any, is whichever linked contact/company/opportunity's own workspace — never denormalized onto the follow-up row) — this metric is always organization-wide, even under a workspace-scoped query.",
    domain: "crm",
    valueType: "count",
    aggregationType: "count",
    unit: "follow-ups",
    classification: "actual",
    supportsTimeSeries: false,
    supportedTimeGrains: [],
    supportedDimensions: ["owner"],
    version: 1,
    nullSemantics: "0 means no overdue follow-ups right now — never null.",
  },
  compute: async (ctx) => {
    await requireCrmAggregateAccess(ctx);
    // CRM follow-ups have no `workspaceId` column — organization-wide by data model.
    const [row] = await ctx.db.select({ value: count() }).from(crmFollowUps).where(and(eq(crmFollowUps.organizationId, ctx.organizationId), eq(crmFollowUps.status, "open"), isNotNull(crmFollowUps.dueAt), lte(crmFollowUps.dueAt, ctx.to)));
    return single(row.value);
  },
  drilldown: async (ctx) => {
    await requireCrmAggregateAccess(ctx);
    const rows = await ctx.db
      .select({ id: crmFollowUps.id })
      .from(crmFollowUps)
      .where(and(eq(crmFollowUps.organizationId, ctx.organizationId), eq(crmFollowUps.status, "open"), isNotNull(crmFollowUps.dueAt), lte(crmFollowUps.dueAt, ctx.to)))
      .limit(200);
    return { entityType: "crm_follow_up", ids: rows.map((r) => r.id), totalCount: rows.length };
  },
};

export const CRM_METRICS: MetricHandler[] = [crmContactsTotal, crmLeadsOpen, crmLeadsQualified, crmOpportunitiesOpen, crmOpportunitiesWon, crmPipelineValue, crmWonValue, crmFollowupsOverdue];
