import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { marketingCampaigns, marketingContentItems, workflowExecutions, workflowDefinitions } from "@/db/schema";
import { listMyWorkflowHumanTasks, type WorkflowHumanTask } from "@/lib/workflows/human-tasks";
import type { AgentApprovalRequest } from "@/lib/agent-runtime/approvals";
import { resolveMarketingAuthContext, requireMarketingViewAuthority } from "./authz";
import { listPendingMarketingApprovalsForApprover } from "./approvals";
import { computeNextBestActionsForUser, type MarketingNextBestAction } from "./next-best-action";
import type { MarketingCampaign } from "./campaigns";
import type { MarketingContentItem } from "./content";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export const MARKETING_WORKFLOW_TEMPLATE_KEYS = ["CAMPAIGN_PLANNING_TEMPLATE", "CONTENT_CREATION_TEMPLATE", "CAMPAIGN_REVIEW_TEMPLATE"] as const;

export interface MarketingWorkQueue {
  ownedCampaigns: MarketingCampaign[];
  contentAwaitingReview: MarketingContentItem[];
  pendingMarketingApprovals: AgentApprovalRequest[];
  marketingWorkflowHumanTasks: WorkflowHumanTask[];
  nextBestActions: MarketingNextBestAction[];
}

/**
 * "My Marketing Work" — every field here is a filtered/derived view over
 * already-canonical records (Marketing OS campaigns/content, Runtime
 * approvals, Workflow human tasks). Nothing in this module creates a new
 * operational task record; it only aggregates and labels existing ones.
 */
export async function getMarketingWorkQueueForUser(db: Db, input: { organizationId: string; workspaceId?: string | null; forUserId: string; actorUserId: string }): Promise<MarketingWorkQueue> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "marketing_work_queue", input.forUserId);

  const ownedCampaigns = (await db
    .select()
    .from(marketingCampaigns)
    .where(and(eq(marketingCampaigns.organizationId, input.organizationId), eq(marketingCampaigns.ownerUserId, input.forUserId), inArray(marketingCampaigns.status, ["draft", "planning", "ready", "active", "paused"])))) as unknown as MarketingCampaign[];

  const contentAwaitingReview = (await db
    .select()
    .from(marketingContentItems)
    .where(and(eq(marketingContentItems.organizationId, input.organizationId), eq(marketingContentItems.ownerUserId, input.forUserId), inArray(marketingContentItems.status, ["draft", "review", "rejected"])))) as unknown as MarketingContentItem[];

  const pendingMarketingApprovals = await listPendingMarketingApprovalsForApprover(db, { organizationId: input.organizationId, actorUserId: input.forUserId });

  const allTasks = await listMyWorkflowHumanTasks(db, { organizationId: input.organizationId, actorUserId: input.forUserId, status: "pending" });
  const marketingExecutionIds = new Set(
    (
      await db
        .select({ executionId: workflowExecutions.id })
        .from(workflowExecutions)
        .innerJoin(workflowDefinitions, eq(workflowDefinitions.id, workflowExecutions.workflowDefinitionId))
        .where(and(eq(workflowExecutions.organizationId, input.organizationId), inArray(workflowDefinitions.workflowKey, [...MARKETING_WORKFLOW_TEMPLATE_KEYS])))
    ).map((r) => r.executionId)
  );
  const marketingWorkflowHumanTasks = allTasks.filter((t) => marketingExecutionIds.has(t.workflowExecutionId));

  const nextBestActions = await computeNextBestActionsForUser(db, { organizationId: input.organizationId, workspaceId: input.workspaceId, forUserId: input.forUserId, actorUserId: input.actorUserId });

  return { ownedCampaigns, contentAwaitingReview, pendingMarketingApprovals, marketingWorkflowHumanTasks, nextBestActions };
}
