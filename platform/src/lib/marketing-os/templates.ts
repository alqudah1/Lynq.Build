import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { seedTemplate } from "@/lib/workflows/templates";
import { resolveCampaignBriefAssistantAgent, resolveContentDraftAssistantAgent, resolveCampaignSummaryAssistantAgent } from "./agents";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export const CAMPAIGN_PLANNING_TEMPLATE_KEY = "CAMPAIGN_PLANNING_TEMPLATE";
export const CONTENT_CREATION_TEMPLATE_KEY = "CONTENT_CREATION_TEMPLATE";
export const CAMPAIGN_REVIEW_TEMPLATE_KEY = "CAMPAIGN_REVIEW_TEMPLATE";

/**
 * ============================================================================
 * Marketing OS starter workflow templates — Module 15
 * ============================================================================
 * All three use the Module 14 generic `agent_execution` node
 * (`{agentId, agentTaskType}`) to drive the three Marketing agents — no
 * hardcoded marketing agent path in the Workflow Engine itself, exactly the
 * constraint Module 14 removed. Requires the organization's three Marketing
 * agents to already be seeded (`seedMarketingAgents`). Idempotent by
 * `workflowKey`, matching every other starter-template precedent in this
 * codebase.
 */
export interface SeedMarketingWorkflowTemplatesResult {
  campaignPlanning: { definitionId: string; alreadyExisted: boolean };
  contentCreation: { definitionId: string; alreadyExisted: boolean };
  campaignReview: { definitionId: string; alreadyExisted: boolean };
}

export async function seedMarketingWorkflowTemplates(db: Db, input: { organizationId: string; actorUserId: string }): Promise<SeedMarketingWorkflowTemplatesResult> {
  const briefAgent = await resolveCampaignBriefAssistantAgent(db, input.organizationId);
  const draftAgent = await resolveContentDraftAssistantAgent(db, input.organizationId);
  const summaryAgent = await resolveCampaignSummaryAssistantAgent(db, input.organizationId);

  const campaignPlanning = await seedTemplate(db, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    workflowKey: CAMPAIGN_PLANNING_TEMPLATE_KEY,
    name: "Campaign Planning Workflow",
    description: "Start → define objective → define audience → Campaign Brief Agent → approval → End. A minimal, deterministic starter template.",
    nodes: [
      { nodeKey: "start", nodeType: "start", name: "Start", configuration: {}, positionX: 0, positionY: 0 },
      { nodeKey: "define_objective", nodeType: "human_task", name: "Define objective", configuration: { assignedUserId: input.actorUserId, title: "Define campaign objective", instructions: "Confirm the campaign's objective type and targets before planning continues." }, positionX: 1, positionY: 0 },
      { nodeKey: "define_audience", nodeType: "human_task", name: "Define audience", configuration: { assignedUserId: input.actorUserId, title: "Define campaign audience", instructions: "Select or create the campaign's primary audience." }, positionX: 2, positionY: 0 },
      { nodeKey: "campaign_brief", nodeType: "agent_execution", name: "Campaign Brief Agent", configuration: { agentId: briefAgent.id, agentTaskType: "marketing_campaign_brief" }, inputMapping: { campaignId: { source: "workflow_input", path: "campaignId" } }, positionX: 3, positionY: 0 },
      { nodeKey: "approve_brief", nodeType: "approval", name: "Approve brief", configuration: { agentId: briefAgent.id, requestedAction: "approve_campaign_brief", summary: "Review and approve the generated campaign brief", riskLevel: "low" }, positionX: 4, positionY: 0 },
      { nodeKey: "end", nodeType: "end", name: "End", configuration: { requiredOutputs: [] }, positionX: 5, positionY: 0 },
    ],
    edges: [
      { sourceNodeKey: "start", targetNodeKey: "define_objective" },
      { sourceNodeKey: "define_objective", targetNodeKey: "define_audience" },
      { sourceNodeKey: "define_audience", targetNodeKey: "campaign_brief" },
      { sourceNodeKey: "campaign_brief", targetNodeKey: "approve_brief" },
      { sourceNodeKey: "approve_brief", targetNodeKey: "end" },
    ],
  });

  const contentCreation = await seedTemplate(db, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    workflowKey: CONTENT_CREATION_TEMPLATE_KEY,
    name: "Content Creation Workflow",
    description: "Start → Content Draft Agent → approval → schedule → End. A minimal, deterministic starter template.",
    nodes: [
      { nodeKey: "start", nodeType: "start", name: "Start", configuration: {}, positionX: 0, positionY: 0 },
      { nodeKey: "content_draft", nodeType: "agent_execution", name: "Content Draft Agent", configuration: { agentId: draftAgent.id, agentTaskType: "marketing_content_draft" }, inputMapping: { contentItemId: { source: "workflow_input", path: "contentItemId" }, briefArtifactId: { source: "workflow_input", path: "briefArtifactId" } }, positionX: 1, positionY: 0 },
      { nodeKey: "approve_draft", nodeType: "approval", name: "Approve draft", configuration: { agentId: draftAgent.id, requestedAction: "approve_content_draft", summary: "Review and approve the generated content draft", riskLevel: "low" }, positionX: 2, positionY: 0 },
      { nodeKey: "schedule", nodeType: "human_task", name: "Schedule", configuration: { assignedUserId: input.actorUserId, title: "Schedule content", instructions: "Set the planned publish date and confirm the intended channel." }, positionX: 3, positionY: 0 },
      { nodeKey: "end", nodeType: "end", name: "End", configuration: { requiredOutputs: [] }, positionX: 4, positionY: 0 },
    ],
    edges: [
      { sourceNodeKey: "start", targetNodeKey: "content_draft" },
      { sourceNodeKey: "content_draft", targetNodeKey: "approve_draft" },
      { sourceNodeKey: "approve_draft", targetNodeKey: "schedule" },
      { sourceNodeKey: "schedule", targetNodeKey: "end" },
    ],
  });

  const campaignReview = await seedTemplate(db, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    workflowKey: CAMPAIGN_REVIEW_TEMPLATE_KEY,
    name: "Campaign Review Workflow",
    description: "Start → Campaign Summary Agent → human review → End. A minimal, deterministic starter template.",
    nodes: [
      { nodeKey: "start", nodeType: "start", name: "Start", configuration: {}, positionX: 0, positionY: 0 },
      { nodeKey: "campaign_summary", nodeType: "agent_execution", name: "Campaign Summary Agent", configuration: { agentId: summaryAgent.id, agentTaskType: "marketing_campaign_summary" }, inputMapping: { campaignId: { source: "workflow_input", path: "campaignId" } }, positionX: 1, positionY: 0 },
      { nodeKey: "human_review", nodeType: "human_task", name: "Human review", configuration: { assignedUserId: input.actorUserId, title: "Review campaign summary", instructions: "Review the generated summary and decide on next steps for this campaign." }, positionX: 2, positionY: 0 },
      { nodeKey: "end", nodeType: "end", name: "End", configuration: { requiredOutputs: [] }, positionX: 3, positionY: 0 },
    ],
    edges: [
      { sourceNodeKey: "start", targetNodeKey: "campaign_summary" },
      { sourceNodeKey: "campaign_summary", targetNodeKey: "human_review" },
      { sourceNodeKey: "human_review", targetNodeKey: "end" },
    ],
  });

  return {
    campaignPlanning: { definitionId: campaignPlanning.definitionId, alreadyExisted: campaignPlanning.alreadyExisted },
    contentCreation: { definitionId: contentCreation.definitionId, alreadyExisted: contentCreation.alreadyExisted },
    campaignReview: { definitionId: campaignReview.definitionId, alreadyExisted: campaignReview.alreadyExisted },
  };
}
