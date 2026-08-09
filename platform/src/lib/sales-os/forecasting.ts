import "server-only";
import { and, eq, gte, lte, isNotNull, inArray } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { crmOpportunities, crmPipelineStages, salesOpportunityForecasts } from "@/db/schema";
import { getOpportunityForUser } from "@/lib/crm/opportunities";
import { recordAuditEvent } from "@/lib/audit";
import { resolveSalesAuthContext, requireSalesViewAuthority, requireSalesOpportunityWorkAuthority } from "./authz";
import type { SalesForecastCategory } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * Deterministic pipeline math only — `weightedValue` is always labeled as
 * an estimate derived from each opportunity's own pipeline-stage
 * `probability`, never presented as guaranteed revenue or a predictive
 * model output.
 */
export interface SalesForecast {
  periodStart: Date | null;
  periodEnd: Date | null;
  openPipelineValue: number;
  weightedPipelineValueEstimate: number;
  wonValue: number;
  lostValue: number;
  openOpportunityCount: number;
  byForecastCategory: Record<SalesForecastCategory, { count: number; value: number }>;
  currency: string | null;
}

const EMPTY_CATEGORY_TOTALS = (): Record<SalesForecastCategory, { count: number; value: number }> => ({
  pipeline: { count: 0, value: 0 },
  best_case: { count: 0, value: 0 },
  commit: { count: 0, value: 0 },
  closed: { count: 0, value: 0 },
});

export async function computeForecast(db: Db, input: { organizationId: string; workspaceId?: string | null; pipelineId?: string; periodStart?: Date; periodEnd?: Date; actorUserId: string }): Promise<SalesForecast> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesViewAuthority(db, ctx, "sales_forecast", "org");

  const openConditions = [eq(crmOpportunities.organizationId, input.organizationId), eq(crmOpportunities.status, "open")];
  if (input.workspaceId) openConditions.push(eq(crmOpportunities.workspaceId, input.workspaceId));
  if (input.pipelineId) openConditions.push(eq(crmOpportunities.pipelineId, input.pipelineId));

  const openOpportunities = await db
    .select({ id: crmOpportunities.id, amount: crmOpportunities.amount, currency: crmOpportunities.currency, stageId: crmOpportunities.stageId })
    .from(crmOpportunities)
    .where(and(...openConditions));

  const stageIds = [...new Set(openOpportunities.map((o) => o.stageId))];
  const stages = stageIds.length
    ? await db.select({ id: crmPipelineStages.id, probability: crmPipelineStages.probability }).from(crmPipelineStages).where(and(eq(crmPipelineStages.organizationId, input.organizationId), inArray(crmPipelineStages.id, stageIds)))
    : [];
  const probabilityByStage = new Map(stages.map((s) => [s.id, s.probability ?? 0]));

  const forecastCategoryRows = await db.select().from(salesOpportunityForecasts).where(eq(salesOpportunityForecasts.organizationId, input.organizationId));
  const categoryByOpportunity = new Map(forecastCategoryRows.map((r) => [r.opportunityId, r.forecastCategory]));

  let openPipelineValue = 0;
  let weightedPipelineValueEstimate = 0;
  const byForecastCategory = EMPTY_CATEGORY_TOTALS();
  let currency: string | null = null;

  for (const opp of openOpportunities) {
    const amount = opp.amount ? Number(opp.amount) : 0;
    openPipelineValue += amount;
    const probability = probabilityByStage.get(opp.stageId) ?? 0;
    weightedPipelineValueEstimate += amount * (probability / 100);
    const category = categoryByOpportunity.get(opp.id) ?? "pipeline";
    byForecastCategory[category].count += 1;
    byForecastCategory[category].value += amount;
    if (!currency && opp.currency) currency = opp.currency;
  }

  const wonConditions = [eq(crmOpportunities.organizationId, input.organizationId), eq(crmOpportunities.status, "won"), isNotNull(crmOpportunities.wonAt)];
  if (input.periodStart) wonConditions.push(gte(crmOpportunities.wonAt, input.periodStart));
  if (input.periodEnd) wonConditions.push(lte(crmOpportunities.wonAt, input.periodEnd));
  const wonOpportunities = await db.select({ amount: crmOpportunities.amount }).from(crmOpportunities).where(and(...wonConditions));
  const wonValue = wonOpportunities.reduce((sum, o) => sum + (o.amount ? Number(o.amount) : 0), 0);

  const lostConditions = [eq(crmOpportunities.organizationId, input.organizationId), eq(crmOpportunities.status, "lost"), isNotNull(crmOpportunities.lostAt)];
  if (input.periodStart) lostConditions.push(gte(crmOpportunities.lostAt, input.periodStart));
  if (input.periodEnd) lostConditions.push(lte(crmOpportunities.lostAt, input.periodEnd));
  const lostOpportunities = await db.select({ amount: crmOpportunities.amount }).from(crmOpportunities).where(and(...lostConditions));
  const lostValue = lostOpportunities.reduce((sum, o) => sum + (o.amount ? Number(o.amount) : 0), 0);

  return {
    periodStart: input.periodStart ?? null,
    periodEnd: input.periodEnd ?? null,
    openPipelineValue,
    weightedPipelineValueEstimate,
    wonValue,
    lostValue,
    openOpportunityCount: openOpportunities.length,
    byForecastCategory,
    currency,
  };
}

/** The one bounded, rep-settable forecast field — never an automatic AI classification. Upserted: one row per opportunity. */
export async function setOpportunityForecastCategory(db: Db, input: { organizationId: string; opportunityId: string; forecastCategory: SalesForecastCategory; actorUserId: string }): Promise<void> {
  const opportunity = await getOpportunityForUser(db, { organizationId: input.organizationId, opportunityId: input.opportunityId, actorUserId: input.actorUserId });
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesOpportunityWorkAuthority(db, ctx, opportunity);

  const [existing] = await db.select().from(salesOpportunityForecasts).where(and(eq(salesOpportunityForecasts.organizationId, input.organizationId), eq(salesOpportunityForecasts.opportunityId, opportunity.id)));
  if (existing) {
    await db.update(salesOpportunityForecasts).set({ forecastCategory: input.forecastCategory, setByUserId: input.actorUserId, revision: existing.revision + 1, updatedAt: new Date() }).where(eq(salesOpportunityForecasts.id, existing.id));
  } else {
    await db.insert(salesOpportunityForecasts).values({ organizationId: input.organizationId, opportunityId: opportunity.id, forecastCategory: input.forecastCategory, setByUserId: input.actorUserId });
  }

  await recordAuditEvent(db, { eventType: "sales_forecast_category_set", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "crm_opportunity", targetId: opportunity.id, metadata: { forecastCategory: input.forecastCategory } });
}
