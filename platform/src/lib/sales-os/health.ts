import "server-only";
import { and, eq, desc, lt } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { crmActivities, crmFollowUps, auditLogs, salesOpportunityPlaybookRuns, salesOpportunityPlaybookItems, salesApprovalLinks, agentApprovalRequests } from "@/db/schema";
import { getOpportunityForUser, type CrmOpportunity } from "@/lib/crm/opportunities";
import { resolveSalesAuthContext, requireSalesOpportunityWorkAuthority } from "./authz";
import { resolveEffectiveSalesConfiguration } from "./configuration";
import type { SalesOpportunityHealthStatus } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/** A closed set of reason codes — never free text an LLM invents, and never a numeric "win probability" claim. */
export const OPPORTUNITY_HEALTH_REASONS = [
  "stage_stalled",
  "no_recent_activity",
  "overdue_follow_up",
  "no_scheduled_follow_up",
  "expected_close_date_passed",
  "unresolved_playbook_requirements",
  "pending_approval",
  "missing_contact_or_company",
] as const;
export type OpportunityHealthReason = (typeof OPPORTUNITY_HEALTH_REASONS)[number];

export interface OpportunityHealth {
  status: SalesOpportunityHealthStatus;
  reasons: OpportunityHealthReason[];
}

/** Deterministic — every reason is a boolean signal computed from real data, never an opaque score or a win-probability claim. */
export function classifyOpportunityHealth(reasons: OpportunityHealthReason[]): SalesOpportunityHealthStatus {
  if (reasons.length === 0) return "healthy";
  if (reasons.length <= 2) return "attention";
  return "at_risk";
}

async function computeReasonsForOpportunity(db: Db, organizationId: string, opportunity: CrmOpportunity, staleOpportunityThresholdDays: number): Promise<OpportunityHealthReason[]> {
  const reasons: OpportunityHealthReason[] = [];
  if (opportunity.status !== "open") return reasons;

  const now = Date.now();
  const staleThreshold = new Date(now - staleOpportunityThresholdDays * 24 * 60 * 60 * 1000);

  const [lastStageChange] = await db
    .select({ createdAt: auditLogs.createdAt })
    .from(auditLogs)
    .where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.eventType, "crm_opportunity_stage_changed"), eq(auditLogs.targetId, opportunity.id)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(1);
  const stageEnteredAt = lastStageChange?.createdAt ?? opportunity.createdAt;
  if (stageEnteredAt < staleThreshold) reasons.push("stage_stalled");

  const [lastActivity] = await db
    .select({ occurredAt: crmActivities.occurredAt })
    .from(crmActivities)
    .where(and(eq(crmActivities.organizationId, organizationId), eq(crmActivities.opportunityId, opportunity.id)))
    .orderBy(desc(crmActivities.occurredAt))
    .limit(1);
  if (!lastActivity || lastActivity.occurredAt < staleThreshold) reasons.push("no_recent_activity");

  const [overdueFollowUp] = await db
    .select({ id: crmFollowUps.id })
    .from(crmFollowUps)
    .where(and(eq(crmFollowUps.organizationId, organizationId), eq(crmFollowUps.opportunityId, opportunity.id), eq(crmFollowUps.status, "open"), lt(crmFollowUps.dueAt, new Date(now))))
    .limit(1);
  if (overdueFollowUp) reasons.push("overdue_follow_up");

  const [openFollowUp] = await db.select({ id: crmFollowUps.id }).from(crmFollowUps).where(and(eq(crmFollowUps.organizationId, organizationId), eq(crmFollowUps.opportunityId, opportunity.id), eq(crmFollowUps.status, "open"))).limit(1);
  if (!openFollowUp) reasons.push("no_scheduled_follow_up");

  if (opportunity.expectedCloseDate && opportunity.expectedCloseDate < new Date(now)) reasons.push("expected_close_date_passed");

  const [activeRun] = await db
    .select({ id: salesOpportunityPlaybookRuns.id })
    .from(salesOpportunityPlaybookRuns)
    .where(and(eq(salesOpportunityPlaybookRuns.organizationId, organizationId), eq(salesOpportunityPlaybookRuns.opportunityId, opportunity.id), eq(salesOpportunityPlaybookRuns.status, "active")))
    .limit(1);
  if (activeRun) {
    const [pendingRequired] = await db
      .select({ id: salesOpportunityPlaybookItems.id })
      .from(salesOpportunityPlaybookItems)
      .where(and(eq(salesOpportunityPlaybookItems.organizationId, organizationId), eq(salesOpportunityPlaybookItems.opportunityPlaybookRunId, activeRun.id), eq(salesOpportunityPlaybookItems.status, "pending")))
      .limit(1);
    if (pendingRequired) reasons.push("unresolved_playbook_requirements");
  }

  const [pendingApproval] = await db
    .select({ id: salesApprovalLinks.id })
    .from(salesApprovalLinks)
    .innerJoin(agentApprovalRequests, eq(agentApprovalRequests.id, salesApprovalLinks.approvalRequestId))
    .where(and(eq(salesApprovalLinks.organizationId, organizationId), eq(salesApprovalLinks.linkedEntityType, "opportunity"), eq(salesApprovalLinks.linkedEntityId, opportunity.id), eq(agentApprovalRequests.status, "pending")))
    .limit(1);
  if (pendingApproval) reasons.push("pending_approval");

  if (!opportunity.primaryContactId && !opportunity.companyId) reasons.push("missing_contact_or_company");

  return reasons;
}

export async function computeOpportunityHealth(db: Db, input: { organizationId: string; workspaceId?: string | null; opportunityId: string; actorUserId: string }): Promise<OpportunityHealth> {
  const opportunity = await getOpportunityForUser(db, { organizationId: input.organizationId, opportunityId: input.opportunityId, actorUserId: input.actorUserId });
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesOpportunityWorkAuthority(db, ctx, opportunity);

  const config = await resolveEffectiveSalesConfiguration(db, input.organizationId, input.workspaceId ?? null);
  const reasons = await computeReasonsForOpportunity(db, input.organizationId, opportunity, config.staleOpportunityThresholdDays);
  return { status: classifyOpportunityHealth(reasons), reasons };
}

/**
 * Batched for list/dashboard views. Each opportunity still runs its own
 * bounded set of small queries — acceptable at the list sizes CRM Core
 * itself already caps at (≤200 rows); a future perf pass could replace
 * this with true aggregate queries if that ever becomes the bottleneck.
 */
export async function computeOpportunityHealthForMany(db: Db, input: { organizationId: string; workspaceId?: string | null; opportunities: CrmOpportunity[] }): Promise<Map<string, OpportunityHealth>> {
  const config = await resolveEffectiveSalesConfiguration(db, input.organizationId, input.workspaceId ?? null);
  const results = new Map<string, OpportunityHealth>();
  for (const opportunity of input.opportunities) {
    const reasons = await computeReasonsForOpportunity(db, input.organizationId, opportunity, config.staleOpportunityThresholdDays);
    results.set(opportunity.id, { status: classifyOpportunityHealth(reasons), reasons });
  }
  return results;
}
