import "server-only";
import { and, eq, gte, lte } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { salesTargets, crmOpportunities, crmLeads, crmActivities } from "@/db/schema";
import { requireTenantScopedResource } from "@/lib/authz/helpers";
import { recordAuditEvent } from "@/lib/audit";
import { resolveSalesAuthContext, requireSalesManageTargetsAuthority, requireSalesViewAuthority } from "./authz";
import { StaleSalesUpdateError, InvalidTargetScopeError } from "./errors";
import { resolveSalesTeamById, listSalesTeamMembers } from "./teams";
import type { SalesTargetScopeType, SalesTargetMetricType } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface SalesTarget {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  scopeType: SalesTargetScopeType;
  userId: string | null;
  teamId: string | null;
  metricType: SalesTargetMetricType;
  periodStart: Date;
  periodEnd: Date;
  targetValue: string;
  createdByUserId: string | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSalesTargetInput {
  organizationId: string;
  workspaceId?: string | null;
  scopeType: SalesTargetScopeType;
  userId?: string;
  teamId?: string;
  metricType: SalesTargetMetricType;
  periodStart: Date;
  periodEnd: Date;
  targetValue: number;
  actorUserId: string;
}

export async function createSalesTarget(db: Db, input: CreateSalesTargetInput): Promise<SalesTarget> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesManageTargetsAuthority(db, ctx, "sales_target", "new");

  if (input.scopeType === "individual" && !input.userId) throw new InvalidTargetScopeError("individual scope requires userId");
  if (input.scopeType === "team" && !input.teamId) throw new InvalidTargetScopeError("team scope requires teamId");
  if (input.scopeType === "team" && input.teamId) await resolveSalesTeamById(db, input.organizationId, input.teamId);

  const [row] = await db
    .insert(salesTargets)
    .values({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId ?? null,
      scopeType: input.scopeType,
      userId: input.scopeType === "individual" ? input.userId : null,
      teamId: input.scopeType === "team" ? input.teamId : null,
      metricType: input.metricType,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      targetValue: String(input.targetValue),
      createdByUserId: input.actorUserId,
    })
    .returning();

  await recordAuditEvent(db, {
    eventType: "sales_target_created",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "sales_target",
    targetId: row.id,
    metadata: { scopeType: row.scopeType, metricType: row.metricType, periodStart: row.periodStart.toISOString(), periodEnd: row.periodEnd.toISOString() },
  });

  return row as unknown as SalesTarget;
}

export async function updateSalesTarget(db: Db, input: { organizationId: string; targetId: string; expectedRevision: number; targetValue: number; actorUserId: string }): Promise<SalesTarget> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesManageTargetsAuthority(db, ctx, "sales_target", input.targetId);

  const [row] = await db
    .update(salesTargets)
    .set({ targetValue: String(input.targetValue), revision: input.expectedRevision + 1, updatedAt: new Date() })
    .where(and(eq(salesTargets.id, input.targetId), eq(salesTargets.organizationId, input.organizationId), eq(salesTargets.revision, input.expectedRevision)))
    .returning();
  if (!row) throw new StaleSalesUpdateError("sales target");

  await recordAuditEvent(db, { eventType: "sales_target_updated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "sales_target", targetId: row.id, metadata: { fields: ["targetValue"] } });
  return row as unknown as SalesTarget;
}

export async function resolveSalesTargetById(db: Db, organizationId: string, targetId: string): Promise<SalesTarget> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(salesTargets).where(and(eq(salesTargets.id, targetId), eq(salesTargets.organizationId, organizationId)));
    return row as unknown as SalesTarget | undefined;
  });
}

export async function listSalesTargets(db: Db, input: { organizationId: string; scopeType?: SalesTargetScopeType; userId?: string; teamId?: string; actorUserId: string }): Promise<SalesTarget[]> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesViewAuthority(db, ctx, "sales_target", "list");

  const conditions = [eq(salesTargets.organizationId, input.organizationId)];
  if (input.scopeType) conditions.push(eq(salesTargets.scopeType, input.scopeType));
  if (input.userId) conditions.push(eq(salesTargets.userId, input.userId));
  if (input.teamId) conditions.push(eq(salesTargets.teamId, input.teamId));
  const rows = await db.select().from(salesTargets).where(and(...conditions));
  return rows as unknown as SalesTarget[];
}

export interface TargetProgress {
  target: SalesTarget;
  actualValue: number;
  progressRatio: number;
}

/** Deterministic progress: actual metric value over the target's own period, computed straight from CRM/Sales OS records — never a stored/duplicated rollup. */
export async function computeTargetProgress(db: Db, input: { organizationId: string; targetId: string; actorUserId: string }): Promise<TargetProgress> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesViewAuthority(db, ctx, "sales_target", input.targetId);

  const target = await resolveSalesTargetById(db, input.organizationId, input.targetId);
  const userIds = target.scopeType === "individual" && target.userId ? [target.userId] : target.teamId ? (await listSalesTeamMembers(db, { organizationId: input.organizationId, teamId: target.teamId, actorUserId: input.actorUserId })).map((m) => m.userId) : [];

  let actualValue = 0;
  if (userIds.length > 0) {
    if (target.metricType === "won_revenue" || target.metricType === "opportunities_won") {
      const rows = await db
        .select({ amount: crmOpportunities.amount, ownerUserId: crmOpportunities.ownerUserId })
        .from(crmOpportunities)
        .where(and(eq(crmOpportunities.organizationId, input.organizationId), eq(crmOpportunities.status, "won"), gte(crmOpportunities.wonAt, target.periodStart), lte(crmOpportunities.wonAt, target.periodEnd)));
      const filtered = rows.filter((r) => r.ownerUserId && userIds.includes(r.ownerUserId));
      actualValue = target.metricType === "won_revenue" ? filtered.reduce((sum, r) => sum + (r.amount ? Number(r.amount) : 0), 0) : filtered.length;
    } else if (target.metricType === "leads_qualified") {
      const rows = await db
        .select({ ownerUserId: crmLeads.ownerUserId })
        .from(crmLeads)
        .where(and(eq(crmLeads.organizationId, input.organizationId), eq(crmLeads.status, "qualified"), gte(crmLeads.qualifiedAt, target.periodStart), lte(crmLeads.qualifiedAt, target.periodEnd)));
      actualValue = rows.filter((r) => r.ownerUserId && userIds.includes(r.ownerUserId)).length;
    } else if (target.metricType === "activities_completed") {
      const rows = await db
        .select({ createdByUserId: crmActivities.createdByUserId })
        .from(crmActivities)
        .where(and(eq(crmActivities.organizationId, input.organizationId), gte(crmActivities.occurredAt, target.periodStart), lte(crmActivities.occurredAt, target.periodEnd)));
      actualValue = rows.filter((r) => r.createdByUserId && userIds.includes(r.createdByUserId)).length;
    }
  }

  const targetValueNum = Number(target.targetValue);
  return { target, actualValue, progressRatio: targetValueNum > 0 ? actualValue / targetValueNum : 0 };
}
