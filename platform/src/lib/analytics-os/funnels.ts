import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { and, eq, isNotNull, ne, sql, count } from "drizzle-orm";
import { crmLeads, crmOpportunities, marketingAttributionRecords, marketingCampaigns } from "@/db/schema";
import { resolveCrmAuthContext, requireCrmViewAuthority } from "@/lib/crm/authz";
import { resolveSalesAuthContext, requireSalesViewAuthority } from "@/lib/sales-os/authz";
import { resolveMarketingAuthContext, requireMarketingViewAuthority } from "@/lib/marketing-os/authz";
import { workspaceScopeCondition } from "./query-support";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
}

export interface FunnelStep {
  fromStageKey: string;
  toStageKey: string;
  conversionRatePercent: number | null;
}

export interface FunnelResult {
  funnelKey: string;
  name: string;
  description: string;
  stages: FunnelStage[];
  steps: FunnelStep[];
}

function buildSteps(stages: FunnelStage[]): FunnelStep[] {
  const steps: FunnelStep[] = [];
  for (let i = 0; i < stages.length - 1; i++) {
    const from = stages[i];
    const to = stages[i + 1];
    steps.push({ fromStageKey: from.key, toStageKey: to.key, conversionRatePercent: from.count === 0 ? null : Math.round((to.count / from.count) * 1000) / 10 });
  }
  return steps;
}

interface FunnelContext {
  db: Db;
  organizationId: string;
  workspaceId: string | null;
  from: Date;
  to: Date;
  actorUserId: string;
}

/**
 * ============================================================================
 * Funnels — Module 17
 * ============================================================================
 * Deterministic stage counts only, built from a real cohort of records
 * created (or, for Marketing, first-attributed) within the query range,
 * followed forward through their own real canonical fields
 * (`qualifiedAt`, `convertedOpportunityId`, opportunity `status`/`wonAt`).
 * No causal attribution beyond those real links — a lead that qualified for
 * reasons unrelated to the campaign that first touched it is still counted,
 * exactly as the source module itself would count it.
 *
 * Workspace scope: CRM leads carry no `workspaceId` of their own (see
 * `metrics/crm.ts`'s own documented exception), so the lead-based stages in
 * every funnel below (created/assigned/qualification-started/qualified)
 * are always organization-wide, even under a workspace-scoped query — a
 * real, disclosed limitation of the underlying schema, not an oversight.
 * The "opportunity created"/"won" stages DO carry a real `workspaceId`
 * (via `crmOpportunities`) and are filtered by it whenever one is
 * requested. This can only ever shrink a later stage further — it never
 * leaks another workspace's opportunities in, and a later stage can never
 * exceed an earlier one as a result.
 */
export async function computeCrmFunnel(ctx: FunnelContext): Promise<FunnelResult> {
  const crmCtx = await resolveCrmAuthContext(ctx.db, { organizationId: ctx.organizationId, workspaceId: ctx.workspaceId, actorUserId: ctx.actorUserId });
  await requireCrmViewAuthority(ctx.db, crmCtx, "crm_lead", "analytics_funnel");

  const cohort = and(eq(crmLeads.organizationId, ctx.organizationId), sql`${crmLeads.createdAt} >= ${ctx.from} AND ${crmLeads.createdAt} <= ${ctx.to}`);
  const opportunityWorkspace = workspaceScopeCondition(crmOpportunities.workspaceId, ctx.workspaceId);

  const [created] = await ctx.db.select({ value: count() }).from(crmLeads).where(cohort);
  const [qualified] = await ctx.db.select({ value: count() }).from(crmLeads).where(and(cohort, isNotNull(crmLeads.qualifiedAt)));
  const [converted] = await ctx.db
    .select({ value: count() })
    .from(crmLeads)
    .innerJoin(crmOpportunities, eq(crmOpportunities.id, crmLeads.convertedOpportunityId))
    .where(and(cohort, isNotNull(crmLeads.convertedOpportunityId), opportunityWorkspace));
  const [won] = await ctx.db
    .select({ value: count() })
    .from(crmLeads)
    .innerJoin(crmOpportunities, eq(crmOpportunities.id, crmLeads.convertedOpportunityId))
    .where(and(cohort, isNotNull(crmLeads.convertedOpportunityId), eq(crmOpportunities.status, "won"), opportunityWorkspace));

  const stages: FunnelStage[] = [
    { key: "lead_created", label: "Lead created", count: created.value },
    { key: "lead_qualified", label: "Lead qualified", count: qualified.value },
    { key: "opportunity_created", label: "Opportunity created", count: converted.value },
    { key: "opportunity_won", label: "Opportunity won", count: won.value },
  ];
  return { funnelKey: "crm_lead_to_won", name: "CRM: Lead to Won", description: "Leads created in the range, followed through qualification and conversion to a won opportunity.", stages, steps: buildSteps(stages) };
}

export async function computeSalesFunnel(ctx: FunnelContext): Promise<FunnelResult> {
  const salesCtx = await resolveSalesAuthContext(ctx.db, { organizationId: ctx.organizationId, actorUserId: ctx.actorUserId });
  await requireSalesViewAuthority(ctx.db, salesCtx, "crm_lead", "analytics_funnel");

  const cohort = and(eq(crmLeads.organizationId, ctx.organizationId), sql`${crmLeads.createdAt} >= ${ctx.from} AND ${crmLeads.createdAt} <= ${ctx.to}`);
  const opportunityWorkspace = workspaceScopeCondition(crmOpportunities.workspaceId, ctx.workspaceId);

  const [total] = await ctx.db.select({ value: count() }).from(crmLeads).where(cohort);
  const [assigned] = await ctx.db.select({ value: count() }).from(crmLeads).where(and(cohort, isNotNull(crmLeads.ownerUserId)));
  const [qualificationStarted] = await ctx.db.select({ value: count() }).from(crmLeads).where(and(cohort, ne(crmLeads.status, "new")));
  const [qualified] = await ctx.db.select({ value: count() }).from(crmLeads).where(and(cohort, isNotNull(crmLeads.qualifiedAt)));
  const [converted] = await ctx.db
    .select({ value: count() })
    .from(crmLeads)
    .innerJoin(crmOpportunities, eq(crmOpportunities.id, crmLeads.convertedOpportunityId))
    .where(and(cohort, isNotNull(crmLeads.convertedOpportunityId), opportunityWorkspace));
  const [won] = await ctx.db
    .select({ value: count() })
    .from(crmLeads)
    .innerJoin(crmOpportunities, eq(crmOpportunities.id, crmLeads.convertedOpportunityId))
    .where(and(cohort, isNotNull(crmLeads.convertedOpportunityId), eq(crmOpportunities.status, "won"), opportunityWorkspace));

  const stages: FunnelStage[] = [
    { key: "lead_created", label: "Lead created", count: total.value },
    { key: "lead_assigned", label: "Assigned", count: assigned.value },
    { key: "qualification_started", label: "Qualification started", count: qualificationStarted.value },
    { key: "lead_qualified", label: "Qualified", count: qualified.value },
    { key: "opportunity_created", label: "Opportunity created", count: converted.value },
    { key: "opportunity_won", label: "Won", count: won.value },
  ];
  return { funnelKey: "sales_assigned_to_won", name: "Sales: Assigned to Won", description: "Leads created in the range, followed through assignment, qualification, and conversion to a won opportunity.", stages, steps: buildSteps(stages) };
}

export async function computeMarketingFunnel(ctx: FunnelContext): Promise<FunnelResult> {
  const marketingCtx = await resolveMarketingAuthContext(ctx.db, { organizationId: ctx.organizationId, actorUserId: ctx.actorUserId });
  await requireMarketingViewAuthority(ctx.db, marketingCtx, "marketing_campaign", "analytics_funnel");

  const attributionCohort = and(
    eq(marketingAttributionRecords.organizationId, ctx.organizationId),
    eq(marketingAttributionRecords.touchType, "first_touch"),
    isNotNull(marketingAttributionRecords.campaignId),
    isNotNull(marketingAttributionRecords.crmLeadId),
    sql`${marketingAttributionRecords.capturedAt} >= ${ctx.from} AND ${marketingAttributionRecords.capturedAt} <= ${ctx.to}`,
    workspaceScopeCondition(marketingCampaigns.workspaceId, ctx.workspaceId)
  );

  const [sourced] = await ctx.db
    .select({ value: sql<number>`count(distinct ${marketingAttributionRecords.crmLeadId})::int` })
    .from(marketingAttributionRecords)
    .innerJoin(marketingCampaigns, eq(marketingCampaigns.id, marketingAttributionRecords.campaignId))
    .where(attributionCohort);

  const [qualified] = await ctx.db
    .select({ value: sql<number>`count(distinct ${crmLeads.id})::int` })
    .from(marketingAttributionRecords)
    .innerJoin(marketingCampaigns, eq(marketingCampaigns.id, marketingAttributionRecords.campaignId))
    .innerJoin(crmLeads, eq(crmLeads.id, marketingAttributionRecords.crmLeadId))
    .where(and(attributionCohort, isNotNull(crmLeads.qualifiedAt)));

  const [converted] = await ctx.db
    .select({ value: sql<number>`count(distinct ${crmLeads.id})::int` })
    .from(marketingAttributionRecords)
    .innerJoin(marketingCampaigns, eq(marketingCampaigns.id, marketingAttributionRecords.campaignId))
    .innerJoin(crmLeads, eq(crmLeads.id, marketingAttributionRecords.crmLeadId))
    .where(and(attributionCohort, isNotNull(crmLeads.convertedOpportunityId)));

  const [won] = await ctx.db
    .select({ value: sql<number>`count(distinct ${crmLeads.id})::int` })
    .from(marketingAttributionRecords)
    .innerJoin(marketingCampaigns, eq(marketingCampaigns.id, marketingAttributionRecords.campaignId))
    .innerJoin(crmLeads, eq(crmLeads.id, marketingAttributionRecords.crmLeadId))
    .innerJoin(crmOpportunities, eq(crmOpportunities.id, crmLeads.convertedOpportunityId))
    .where(and(attributionCohort, isNotNull(crmLeads.convertedOpportunityId), eq(crmOpportunities.status, "won"), workspaceScopeCondition(crmOpportunities.workspaceId, ctx.workspaceId)));

  const stages: FunnelStage[] = [
    { key: "campaign_sourced_lead", label: "Campaign-sourced lead", count: sourced.value },
    { key: "lead_qualified", label: "Qualified", count: qualified.value },
    { key: "opportunity_created", label: "Opportunity created", count: converted.value },
    { key: "opportunity_won", label: "Won", count: won.value },
  ];
  return {
    funnelKey: "marketing_campaign_to_won",
    name: "Marketing: Campaign-sourced lead to Won",
    description: "Leads with a real first-touch campaign attribution captured in the range, followed through qualification and conversion to a won opportunity — real canonical links only, never inferred.",
    stages,
    steps: buildSteps(stages),
  };
}

export async function computeAllFunnels(ctx: FunnelContext): Promise<FunnelResult[]> {
  return Promise.all([computeCrmFunnel(ctx), computeSalesFunnel(ctx), computeMarketingFunnel(ctx)]);
}
