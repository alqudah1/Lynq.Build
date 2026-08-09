import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { and, eq, isNotNull, desc } from "drizzle-orm";
import { crmOpportunities } from "@/db/schema";
import { computeForecast, type SalesForecast } from "@/lib/sales-os/forecasting";
import { listSalesTargets, computeTargetProgress, type SalesTarget, type TargetProgress } from "@/lib/sales-os/targets";
import { resolveSalesAuthContext, requireSalesViewAuthority } from "@/lib/sales-os/authz";
import { runAnalyticsQuery, type AnalyticsMetricResult } from "@/lib/analytics-os/query";
import { resolveFounderAuthContext, requireFounderViewAuthority, hasFounderCapability } from "./authz";
import { workspaceScopeCondition } from "@/lib/analytics-os/query-support";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface ExecutiveSalesView {
  forecast: SalesForecast | null;
  atRisk: AnalyticsMetricResult | null;
  overdueFollowUps: AnalyticsMetricResult | null;
  topOpportunities: { id: string; name: string; amount: number | null; currency: string | null }[];
  targetProgress: (TargetProgress & { target: SalesTarget })[];
}

/**
 * ============================================================================
 * Executive Sales view — Module 18
 * ============================================================================
 * Reuses Sales OS's own real `computeForecast`/`listSalesTargets`/
 * `computeTargetProgress` directly (no duplicated pipeline math) plus
 * Analytics OS's own registered metrics for at-risk/overdue-follow-up
 * counts. No predictive win probability is computed anywhere here —
 * `weightedPipelineValueEstimate` is Sales OS's own existing probability-
 * weighted total, already labeled an estimate, never a forecast of an
 * individual deal's odds.
 */
export async function computeExecutiveSalesView(db: Db, input: { organizationId: string; workspaceId: string | null; actorUserId: string }): Promise<ExecutiveSalesView> {
  const founderCtx = await resolveFounderAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireFounderViewAuthority(db, founderCtx, "founder_sales_view", input.organizationId);
  if (!hasFounderCapability(founderCtx, "founder_workspace_view_sales")) return { forecast: null, atRisk: null, overdueFollowUps: null, topOpportunities: [], targetProgress: [] };

  const canSeeFinancials = hasFounderCapability(founderCtx, "founder_workspace_view_financial");

  const [forecastRaw, metricResult, salesCtx] = await Promise.all([
    canSeeFinancials ? computeForecast(db, { organizationId: input.organizationId, workspaceId: input.workspaceId, actorUserId: input.actorUserId }) : Promise.resolve(null),
    runAnalyticsQuery(db, { organizationId: input.organizationId, workspaceId: input.workspaceId, actorUserId: input.actorUserId, metricKeys: ["sales_opportunities_at_risk", "crm_followups_overdue"], recordAudit: false }),
    resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId }),
  ]);
  await requireSalesViewAuthority(db, salesCtx, "crm_opportunity", "founder_sales_view");

  const topOpportunities = canSeeFinancials
    ? await db
        .select({ id: crmOpportunities.id, name: crmOpportunities.name, amount: crmOpportunities.amount, currency: crmOpportunities.currency })
        .from(crmOpportunities)
        .where(and(eq(crmOpportunities.organizationId, input.organizationId), eq(crmOpportunities.status, "open"), isNotNull(crmOpportunities.amount), workspaceScopeCondition(crmOpportunities.workspaceId, input.workspaceId)))
        .orderBy(desc(crmOpportunities.amount))
        .limit(10)
        .then((rows) => rows.map((r) => ({ ...r, amount: r.amount ? Number(r.amount) : null })))
    : [];

  const targets = await listSalesTargets(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  const now = new Date();
  const currentTargets = targets.filter((t) => t.periodStart <= now && t.periodEnd >= now);
  const targetProgress = canSeeFinancials
    ? await Promise.all(currentTargets.map(async (target) => ({ ...(await computeTargetProgress(db, { organizationId: input.organizationId, targetId: target.id, actorUserId: input.actorUserId })), target })))
    : [];

  return {
    forecast: forecastRaw,
    atRisk: metricResult.metrics.find((m) => m.metricKey === "sales_opportunities_at_risk") ?? null,
    overdueFollowUps: metricResult.metrics.find((m) => m.metricKey === "crm_followups_overdue") ?? null,
    topOpportunities,
    targetProgress,
  };
}
