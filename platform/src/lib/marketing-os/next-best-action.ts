import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingCampaigns, marketingApprovalLinks, agentApprovalRequests, marketingContentItems, projectTasks } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { resolveMarketingAuthContext, requireMarketingViewAuthority } from "./authz";
import { computeCampaignHealthForMany } from "./health";
import type { MarketingCampaign } from "./campaigns";
import type { MarketingNextActionType } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Next-best-marketing-action engine — deterministic, never LLM reasoning
 * ============================================================================
 * Every recommendation is produced by a plain boolean/threshold check
 * against real Marketing OS/Projects data, carries a closed reason code, a
 * bounded template-generated explanation string, and the exact source
 * signals that produced it. No probability, no free-text AI generation,
 * nothing an agent invented at runtime.
 */
export interface MarketingNextBestAction {
  actionType: MarketingNextActionType;
  recordType: "marketing_campaign" | "marketing_content_item";
  recordId: string;
  reasonCode: string;
  explanation: string;
  priority: number; // higher = more urgent
  dueAt: Date | null;
  sourceSignals: Record<string, unknown>;
}

const HEALTH_REASON_TO_ACTION: Partial<Record<string, { actionType: MarketingNextActionType; priority: number }>> = {
  no_audience: { actionType: "define_audience", priority: 70 },
  no_destination: { actionType: "configure_utm", priority: 55 },
  missing_utm: { actionType: "configure_utm", priority: 55 },
  overdue_content: { actionType: "review_overdue_content", priority: 80 },
  pending_approval: { actionType: "resolve_pending_approval", priority: 85 },
  start_date_near_missing_requirements: { actionType: "prepare_upcoming_launch", priority: 75 },
  campaign_end_passed: { actionType: "review_completed_campaign", priority: 60 },
  missing_review: { actionType: "review_completed_campaign", priority: 60 },
  workflow_stalled: { actionType: "complete_playbook_requirement", priority: 65 },
};

export async function computeNextBestActionsForUser(db: Db, input: { organizationId: string; workspaceId?: string | null; forUserId: string; actorUserId: string }): Promise<MarketingNextBestAction[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_next_action", input.forUserId);

  const actions: MarketingNextBestAction[] = [];

  const campaigns = (await db
    .select()
    .from(marketingCampaigns)
    .where(and(eq(marketingCampaigns.organizationId, input.organizationId), eq(marketingCampaigns.ownerUserId, input.forUserId), inArray(marketingCampaigns.status, ["draft", "planning", "ready", "active", "paused"])))) as unknown as MarketingCampaign[];

  const healthByCampaign = await computeCampaignHealthForMany(db, { organizationId: input.organizationId, workspaceId: input.workspaceId, campaigns });

  for (const campaign of campaigns) {
    const health = healthByCampaign.get(campaign.id);
    if (!health) continue;
    for (const reason of health.reasons) {
      const mapped = HEALTH_REASON_TO_ACTION[reason];
      if (!mapped) continue;
      actions.push({
        actionType: mapped.actionType,
        recordType: "marketing_campaign",
        recordId: campaign.id,
        reasonCode: reason,
        explanation: `Campaign "${campaign.name}" health reason: ${reason.replace(/_/g, " ")}.`,
        priority: mapped.priority,
        dueAt: null,
        sourceSignals: { healthStatus: health.status, reason },
      });
    }

    if (!campaign.sourceId) {
      actions.push({
        actionType: "configure_lead_source",
        recordType: "marketing_campaign",
        recordId: campaign.id,
        reasonCode: "missing_lead_source",
        explanation: `Campaign "${campaign.name}" has no CRM source configured — leads attributed to it won't carry a source.`,
        priority: 45,
        dueAt: null,
        sourceSignals: { hasSource: false },
      });
    }

    if (campaign.status === "active" && !campaign.workflowDefinitionId) {
      actions.push({
        actionType: "link_workflow",
        recordType: "marketing_campaign",
        recordId: campaign.id,
        reasonCode: "no_linked_workflow",
        explanation: `Campaign "${campaign.name}" is active with no linked Workflow definition.`,
        priority: 40,
        dueAt: null,
        sourceSignals: { hasWorkflow: false },
      });
    }

    if (campaign.projectId) {
      const stalledTasks = await db
        .select({ id: projectTasks.id, status: projectTasks.status })
        .from(projectTasks)
        .where(and(eq(projectTasks.organizationId, input.organizationId), eq(projectTasks.projectId, campaign.projectId), eq(projectTasks.status, "blocked")));
      for (const task of stalledTasks) {
        actions.push({
          actionType: "resolve_stalled_project_task",
          recordType: "marketing_campaign",
          recordId: campaign.id,
          reasonCode: "stalled_project_task",
          explanation: `Campaign "${campaign.name}"'s linked project has a blocked task.`,
          priority: 50,
          dueAt: null,
          sourceSignals: { projectTaskId: task.id },
        });
      }
    }
  }

  const campaignIds = new Set(campaigns.map((c) => c.id));
  const contentOwnedByUser = await db
    .select({ id: marketingContentItems.id, title: marketingContentItems.title, campaignId: marketingContentItems.campaignId, status: marketingContentItems.status })
    .from(marketingContentItems)
    .where(and(eq(marketingContentItems.organizationId, input.organizationId), eq(marketingContentItems.ownerUserId, input.forUserId), eq(marketingContentItems.status, "draft")));

  const pendingApprovalLinks = await db
    .select({ link: marketingApprovalLinks, approval: agentApprovalRequests })
    .from(marketingApprovalLinks)
    .innerJoin(agentApprovalRequests, eq(agentApprovalRequests.id, marketingApprovalLinks.approvalRequestId))
    .where(and(eq(marketingApprovalLinks.organizationId, input.organizationId), eq(agentApprovalRequests.status, "pending")));

  const contentIdSet = new Set(contentOwnedByUser.map((c) => c.id));
  const relevantContentIds = new Set([...contentIdSet]);
  const contentByCampaign = await db.select({ id: marketingContentItems.id, campaignId: marketingContentItems.campaignId }).from(marketingContentItems).where(eq(marketingContentItems.organizationId, input.organizationId));
  for (const c of contentByCampaign) if (campaignIds.has(c.campaignId)) relevantContentIds.add(c.id);

  for (const row of pendingApprovalLinks) {
    if (row.link.linkedEntityType !== "content_item" || !relevantContentIds.has(row.link.linkedEntityId)) continue;
    actions.push({
      actionType: "resolve_pending_approval",
      recordType: "marketing_content_item",
      recordId: row.link.linkedEntityId,
      reasonCode: "pending_approval",
      explanation: `"${row.approval.requestedAction}" is awaiting an approval decision.`,
      priority: 85,
      dueAt: row.approval.expiresAt,
      sourceSignals: { approvalRequestId: row.approval.id, riskLevel: row.approval.riskLevel },
    });
  }

  for (const content of contentOwnedByUser) {
    actions.push({
      actionType: "create_content",
      recordType: "marketing_content_item",
      recordId: content.id,
      reasonCode: "draft_not_submitted",
      explanation: `"${content.title}" is still in draft — finish and submit it for review.`,
      priority: 35,
      dueAt: null,
      sourceSignals: { status: content.status },
    });
  }

  actions.sort((a, b) => b.priority - a.priority);

  await recordAuditEvent(db, { eventType: "marketing_next_action_generated", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "marketing_next_action", targetId: null, metadata: { forUserId: input.forUserId, count: actions.length } });

  return actions;
}
