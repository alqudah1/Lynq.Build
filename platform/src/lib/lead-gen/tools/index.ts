import type { ToolImplementation } from "@/lib/tools/implementation-types";
import { findQualifiedLeadsTool, getLeadTool, enrichLeadTool, scoreLeadTool, updateCrmTool, markCallLaterTool, markInterestedTool, markNotInterestedTool } from "./lead-tools";
import { generateDemoTool, reviewDemoTool, regenerateDemoTool } from "./demo-tools";
import { draftOutreachTool, createOutreachBatchTool, submitBatchForApprovalTool, sendApprovedBatchTool, getDeliveryStatusTool, markWhatsappSentTool, suppressContactTool } from "./outreach-tools";
import { processInboundReplyTool, draftFollowUpTool } from "./reply-tools";
import { getCampaignAnalyticsTool } from "./analytics-tools";

/**
 * Every lead-gen tool, in one list. Registered into the EXISTING
 * `tools/implementations/registry.ts` — there is no second tool registry,
 * no second permission model and no second audit trail. Each of these is
 * reachable only through `invokeTool`, and therefore only from inside a
 * live agent execution whose assigned agent is currently eligible.
 */
export const LEAD_GEN_TOOL_IMPLEMENTATIONS: ToolImplementation[] = [
  findQualifiedLeadsTool as ToolImplementation,
  getLeadTool as ToolImplementation,
  enrichLeadTool as ToolImplementation,
  scoreLeadTool as ToolImplementation,
  updateCrmTool as ToolImplementation,
  markCallLaterTool as ToolImplementation,
  markInterestedTool as ToolImplementation,
  markNotInterestedTool as ToolImplementation,
  generateDemoTool as ToolImplementation,
  reviewDemoTool as ToolImplementation,
  regenerateDemoTool as ToolImplementation,
  draftOutreachTool as ToolImplementation,
  createOutreachBatchTool as ToolImplementation,
  submitBatchForApprovalTool as ToolImplementation,
  sendApprovedBatchTool as ToolImplementation,
  getDeliveryStatusTool as ToolImplementation,
  markWhatsappSentTool as ToolImplementation,
  suppressContactTool as ToolImplementation,
  processInboundReplyTool as ToolImplementation,
  draftFollowUpTool as ToolImplementation,
  getCampaignAnalyticsTool as ToolImplementation,
];

export const LEAD_GEN_TOOL_KEYS = LEAD_GEN_TOOL_IMPLEMENTATIONS.map((tool) => tool.toolKey);
