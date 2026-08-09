import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { crmLeads, crmFollowUps, crmOpportunities, salesLeadQualificationRuns, salesOpportunityPlaybookRuns, salesPlaybookSteps, salesApprovalLinks, agentApprovalRequests } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { resolveSalesAuthContext, requireSalesViewAuthority } from "./authz";
import { resolveEffectiveSalesConfiguration } from "./configuration";
import { computeOpportunityHealthForMany } from "./health";
import type { CrmOpportunity } from "@/lib/crm/opportunities";
import type { SalesNextActionType } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Next-best-action engine — deterministic, never LLM reasoning
 * ============================================================================
 * Every recommendation is produced by a plain boolean/threshold check
 * against real CRM/Sales OS data, carries a closed reason code, a bounded
 * template-generated explanation string, and the exact source signals that
 * produced it. No probability, no free-text AI generation, nothing an
 * agent invented at runtime.
 */
export interface NextBestAction {
  actionType: SalesNextActionType;
  recordType: "crm_lead" | "crm_opportunity";
  recordId: string;
  reasonCode: string;
  explanation: string;
  priority: number; // higher = more urgent
  dueAt: Date | null;
  sourceSignals: Record<string, unknown>;
}

function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
}

export async function computeNextBestActionsForUser(db: Db, input: { organizationId: string; workspaceId?: string | null; forUserId: string; actorUserId: string }): Promise<NextBestAction[]> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesViewAuthority(db, ctx, "sales_next_action", input.forUserId);

  const config = await resolveEffectiveSalesConfiguration(db, input.organizationId, input.workspaceId ?? null);
  const actions: NextBestAction[] = [];

  const leads = await db
    .select()
    .from(crmLeads)
    .where(and(eq(crmLeads.organizationId, input.organizationId), eq(crmLeads.ownerUserId, input.forUserId), inArray(crmLeads.status, ["new", "contacted", "engaged"])));

  const leadFollowUps = await db.select().from(crmFollowUps).where(and(eq(crmFollowUps.organizationId, input.organizationId), eq(crmFollowUps.status, "open")));
  const openFollowUpByLead = new Map<string, (typeof leadFollowUps)[number]>();
  for (const f of leadFollowUps) if (f.leadId) openFollowUpByLead.set(f.leadId, f);

  const activeQualificationRuns = await db
    .select()
    .from(salesLeadQualificationRuns)
    .where(and(eq(salesLeadQualificationRuns.organizationId, input.organizationId), eq(salesLeadQualificationRuns.assignedUserId, input.forUserId), inArray(salesLeadQualificationRuns.status, ["in_progress", "waiting"])));
  const activeRunByLead = new Map(activeQualificationRuns.map((r) => [r.leadId, r]));

  for (const lead of leads) {
    const followUp = openFollowUpByLead.get(lead.id);
    if (!followUp) {
      actions.push({
        actionType: "contact_lead",
        recordType: "crm_lead",
        recordId: lead.id,
        reasonCode: "no_scheduled_contact",
        explanation: `Lead has status "${lead.status}" with no scheduled follow-up — contact this lead next.`,
        priority: 60,
        dueAt: null,
        sourceSignals: { leadStatus: lead.status, hasOpenFollowUp: false },
      });
    } else if (followUp.dueAt && followUp.dueAt < new Date()) {
      actions.push({
        actionType: "schedule_follow_up",
        recordType: "crm_lead",
        recordId: lead.id,
        reasonCode: "follow_up_overdue",
        explanation: `A follow-up for this lead is overdue by ${daysSince(followUp.dueAt)} day(s).`,
        priority: 80,
        dueAt: followUp.dueAt,
        sourceSignals: { followUpId: followUp.id, dueAt: followUp.dueAt.toISOString() },
      });
    }

    const run = activeRunByLead.get(lead.id);
    if (run && Array.isArray(run.missingInformation) && run.missingInformation.length > 0) {
      actions.push({
        actionType: "complete_qualification_field",
        recordType: "crm_lead",
        recordId: lead.id,
        reasonCode: "missing_qualification_fields",
        explanation: `${run.missingInformation.length} required qualification step(s) still incomplete.`,
        priority: 50,
        dueAt: null,
        sourceSignals: { runId: run.id, missingInformation: run.missingInformation },
      });
    }
  }

  const staleLeadThreshold = new Date(Date.now() - config.staleLeadThresholdDays * 24 * 60 * 60 * 1000);
  for (const lead of leads) {
    if (lead.updatedAt < staleLeadThreshold) {
      actions.push({
        actionType: "review_stale_opportunity",
        recordType: "crm_lead",
        recordId: lead.id,
        reasonCode: "lead_stale",
        explanation: `No update on this lead in ${daysSince(lead.updatedAt)} day(s) — review or disqualify.`,
        priority: 40,
        dueAt: null,
        sourceSignals: { updatedAt: lead.updatedAt.toISOString(), staleThresholdDays: config.staleLeadThresholdDays },
      });
    }
  }

  const opportunities = (await db.select().from(crmOpportunities).where(and(eq(crmOpportunities.organizationId, input.organizationId), eq(crmOpportunities.ownerUserId, input.forUserId), eq(crmOpportunities.status, "open")))) as unknown as CrmOpportunity[];

  const healthByOpportunity = await computeOpportunityHealthForMany(db, { organizationId: input.organizationId, workspaceId: input.workspaceId, opportunities });

  const activeOppRuns = opportunities.length
    ? await db
        .select()
        .from(salesOpportunityPlaybookRuns)
        .where(and(eq(salesOpportunityPlaybookRuns.organizationId, input.organizationId), eq(salesOpportunityPlaybookRuns.status, "active"), inArray(salesOpportunityPlaybookRuns.opportunityId, opportunities.map((o) => o.id))))
    : [];
  const activeRunByOpportunity = new Map(activeOppRuns.map((r) => [r.opportunityId, r]));

  for (const opportunity of opportunities) {
    const health = healthByOpportunity.get(opportunity.id);
    if (health && health.status !== "healthy") {
      actions.push({
        actionType: "review_stale_opportunity",
        recordType: "crm_opportunity",
        recordId: opportunity.id,
        reasonCode: health.status,
        explanation: `Opportunity health is "${health.status}": ${health.reasons.join(", ")}.`,
        priority: health.status === "at_risk" ? 90 : 55,
        dueAt: null,
        sourceSignals: { healthStatus: health.status, reasons: health.reasons },
      });
    }

    const run = activeRunByOpportunity.get(opportunity.id);
    if (run?.currentStepId) {
      const [step] = await db.select().from(salesPlaybookSteps).where(eq(salesPlaybookSteps.id, run.currentStepId));
      if (step?.stepType === "stage_recommendation") {
        actions.push({
          actionType: "move_opportunity",
          recordType: "crm_opportunity",
          recordId: opportunity.id,
          reasonCode: "playbook_recommends_stage_move",
          explanation: `The "${step.name}" playbook step recommends reviewing this opportunity's stage.`,
          priority: 65,
          dueAt: null,
          sourceSignals: { runId: run.id, stepId: step.id },
        });
      } else if (step?.stepType === "artifact_required") {
        actions.push({
          actionType: "review_proposal",
          recordType: "crm_opportunity",
          recordId: opportunity.id,
          reasonCode: "artifact_review_pending",
          explanation: `The "${step.name}" playbook step requires reviewing a required artifact.`,
          priority: 55,
          dueAt: null,
          sourceSignals: { runId: run.id, stepId: step.id },
        });
      }
    }
  }

  const pendingApprovalLinks = await db
    .select({ link: salesApprovalLinks, approval: agentApprovalRequests })
    .from(salesApprovalLinks)
    .innerJoin(agentApprovalRequests, eq(agentApprovalRequests.id, salesApprovalLinks.approvalRequestId))
    .where(and(eq(salesApprovalLinks.organizationId, input.organizationId), eq(agentApprovalRequests.status, "pending")));

  const opportunityIdSet = new Set(opportunities.map((o) => o.id));
  const leadIdSet = new Set(leads.map((l) => l.id));
  for (const row of pendingApprovalLinks) {
    const isMine = (row.link.linkedEntityType === "opportunity" && opportunityIdSet.has(row.link.linkedEntityId)) || (row.link.linkedEntityType === "lead" && leadIdSet.has(row.link.linkedEntityId));
    if (!isMine) continue;
    actions.push({
      actionType: "resolve_pending_approval",
      recordType: row.link.linkedEntityType === "opportunity" ? "crm_opportunity" : "crm_lead",
      recordId: row.link.linkedEntityId,
      reasonCode: "pending_approval",
      explanation: `"${row.approval.requestedAction}" is awaiting an approval decision.`,
      priority: 85,
      dueAt: row.approval.expiresAt,
      sourceSignals: { approvalRequestId: row.approval.id, riskLevel: row.approval.riskLevel },
    });
  }

  actions.sort((a, b) => b.priority - a.priority);

  await recordAuditEvent(db, {
    eventType: "sales_next_action_generated",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    targetType: "sales_next_action",
    targetId: null,
    metadata: { forUserId: input.forUserId, count: actions.length },
  });

  return actions;
}
