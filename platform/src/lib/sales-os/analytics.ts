import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { crmLeads, crmOpportunities, crmFollowUps, crmPipelineStages } from "@/db/schema";
import { resolveSalesAuthContext, requireSalesViewAuthority } from "./authz";
import { CRM_LEAD_STATUSES } from "@/lib/crm/validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface SalesAnalyticsSummary {
  leadsByStatus: Record<string, number>;
  qualificationConversionRate: number | null;
  averageLeadResponseAgeDays: number | null;
  opportunitiesByStage: { stageId: string; stageName: string; count: number; value: number }[];
  openPipelineValue: number;
  wonValue: number;
  lostValue: number;
  averageOpenStageAgeDays: number | null;
  staleOpportunityCount: number;
  followUpsDue: number;
  followUpsOverdue: number;
}

/**
 * Deterministic operational summaries only — every number here is a plain
 * aggregate over real CRM/Sales OS rows, computed at read time. This is
 * Sales OS's own operational view, not the future org-wide Analytics OS.
 */
export async function computeSalesAnalytics(db: Db, input: { organizationId: string; workspaceId?: string | null; staleOpportunityThresholdDays: number; actorUserId: string }): Promise<SalesAnalyticsSummary> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesViewAuthority(db, ctx, "sales_analytics", "org");

  const leads = await db.select({ status: crmLeads.status, createdAt: crmLeads.createdAt, updatedAt: crmLeads.updatedAt }).from(crmLeads).where(eq(crmLeads.organizationId, input.organizationId));
  const leadsByStatus: Record<string, number> = Object.fromEntries(CRM_LEAD_STATUSES.map((s) => [s, 0]));
  for (const lead of leads) leadsByStatus[lead.status] = (leadsByStatus[lead.status] ?? 0) + 1;

  const totalTerminal = leadsByStatus.qualified + leadsByStatus.disqualified + leadsByStatus.converted;
  const qualificationConversionRate = totalTerminal > 0 ? (leadsByStatus.qualified + leadsByStatus.converted) / totalTerminal : null;

  const respondedLeads = leads.filter((l) => l.status !== "new");
  const averageLeadResponseAgeDays =
    respondedLeads.length > 0 ? respondedLeads.reduce((sum, l) => sum + (l.updatedAt.getTime() - l.createdAt.getTime()), 0) / respondedLeads.length / (24 * 60 * 60 * 1000) : null;

  const openOpportunities = await db
    .select({ stageId: crmOpportunities.stageId, amount: crmOpportunities.amount, updatedAt: crmOpportunities.updatedAt })
    .from(crmOpportunities)
    .where(and(eq(crmOpportunities.organizationId, input.organizationId), eq(crmOpportunities.status, "open")));

  const stages = await db.select({ id: crmPipelineStages.id, name: crmPipelineStages.name }).from(crmPipelineStages).where(eq(crmPipelineStages.organizationId, input.organizationId));
  const stageNameById = new Map(stages.map((s) => [s.id, s.name]));

  const byStage = new Map<string, { count: number; value: number }>();
  let openPipelineValue = 0;
  for (const opp of openOpportunities) {
    const amount = opp.amount ? Number(opp.amount) : 0;
    openPipelineValue += amount;
    const existing = byStage.get(opp.stageId) ?? { count: 0, value: 0 };
    existing.count += 1;
    existing.value += amount;
    byStage.set(opp.stageId, existing);
  }
  const opportunitiesByStage = [...byStage.entries()].map(([stageId, v]) => ({ stageId, stageName: stageNameById.get(stageId) ?? "Unknown stage", ...v }));

  const staleThreshold = new Date(Date.now() - input.staleOpportunityThresholdDays * 24 * 60 * 60 * 1000);
  const staleOpportunityCount = openOpportunities.filter((o) => o.updatedAt < staleThreshold).length;
  const averageOpenStageAgeDays = openOpportunities.length > 0 ? openOpportunities.reduce((sum, o) => sum + (Date.now() - o.updatedAt.getTime()), 0) / openOpportunities.length / (24 * 60 * 60 * 1000) : null;

  const wonOpportunities = await db.select({ amount: crmOpportunities.amount }).from(crmOpportunities).where(and(eq(crmOpportunities.organizationId, input.organizationId), eq(crmOpportunities.status, "won")));
  const wonValue = wonOpportunities.reduce((sum, o) => sum + (o.amount ? Number(o.amount) : 0), 0);
  const lostOpportunities = await db.select({ amount: crmOpportunities.amount }).from(crmOpportunities).where(and(eq(crmOpportunities.organizationId, input.organizationId), eq(crmOpportunities.status, "lost")));
  const lostValue = lostOpportunities.reduce((sum, o) => sum + (o.amount ? Number(o.amount) : 0), 0);

  const now = new Date();
  const openFollowUps = await db.select({ dueAt: crmFollowUps.dueAt }).from(crmFollowUps).where(and(eq(crmFollowUps.organizationId, input.organizationId), eq(crmFollowUps.status, "open")));
  const followUpsDue = openFollowUps.filter((f) => f.dueAt && f.dueAt >= now).length;
  const followUpsOverdue = openFollowUps.filter((f) => f.dueAt && f.dueAt < now).length;

  return {
    leadsByStatus,
    qualificationConversionRate,
    averageLeadResponseAgeDays,
    opportunitiesByStage,
    openPipelineValue,
    wonValue,
    lostValue,
    averageOpenStageAgeDays,
    staleOpportunityCount,
    followUpsDue,
    followUpsOverdue,
  };
}
