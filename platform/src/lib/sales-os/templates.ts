import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { seedTemplate } from "@/lib/workflows/templates";
import { resolveOpportunitySummaryAssistantAgent } from "./agents";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export const LEAD_QUALIFICATION_TEMPLATE_KEY = "LEAD_QUALIFICATION_TEMPLATE";
export const OPPORTUNITY_REVIEW_TEMPLATE_KEY = "OPPORTUNITY_REVIEW_TEMPLATE";
export const FOLLOW_UP_SEQUENCE_TEMPLATE_KEY = "FOLLOW_UP_SEQUENCE_TEMPLATE";

/**
 * ============================================================================
 * Sales OS starter workflow templates — Module 13 (updated by Module 14)
 * ============================================================================
 * RESOLVED LIMITATION: when these templates were first written, the
 * Workflow Engine's `agent_execution` node type was hard-wired to
 * `createKnowledgeAnalystTask` regardless of the configured agent, so
 * routing either Sales agent through an `agent_execution` node would have
 * silently run the wrong logic — these templates deliberately used only
 * `human_task`/`approval` instead. Module 14 made `agent_execution` generic
 * (a typed, in-code agent task handler registry — see
 * `@/lib/agent-runtime/task-handlers` — now covers `sales_lead_research`
 * and `sales_opportunity_summary` in addition to
 * `company_knowledge_report`), so a future template revision COULD route
 * through `agent_execution` instead. These specific templates are left
 * exactly as Module 13 built them — updating them is not part of what
 * Module 14 was scoped to do (it only had to remove the constraint, not
 * retrofit every existing template onto it). Sales agent tasks continue to
 * launch directly through `agents.ts`'s own `createLeadResearchTask`/
 * `createOpportunitySummaryTask`, still fully correct and now ALSO reachable
 * generically via the task handler registry for any NEW workflow that wants
 * an `agent_execution` node instead.
 *
 * A second, smaller limitation: `executeHumanTaskNode` does not read
 * `inputMapping` at all (confirmed in `dispatchAsyncNode`) — a
 * `human_task` node's `assignedUserId` is fixed at template-seed time,
 * not resolvable per-execution. These templates default that assignee to
 * whichever user seeds the template; real per-lead/per-rep assignment is
 * handled by Sales OS's own qualification/opportunity-playbook runs, and
 * these workflow templates are a complementary, org-wide reminder/
 * approval mechanism, not the primary assignment path.
 */
export async function seedSalesOsWorkflowTemplates(db: Db, input: { organizationId: string; actorUserId: string }): Promise<{ leadQualification: { definitionId: string; alreadyExisted: boolean }; opportunityReview: { definitionId: string; alreadyExisted: boolean }; followUpSequence: { definitionId: string; alreadyExisted: boolean } }> {
  const opportunitySummaryAgent = await resolveOpportunitySummaryAssistantAgent(db, input.organizationId);

  const leadQualification = await seedTemplate(db, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    workflowKey: LEAD_QUALIFICATION_TEMPLATE_KEY,
    name: "Lead Qualification Workflow",
    description: "A reusable reminder workflow for lead qualification — complements Sales OS's own qualification run, never replaces it.",
    nodes: [
      { nodeKey: "start", nodeType: "start", name: "Start", configuration: {}, positionX: 0, positionY: 0 },
      { nodeKey: "qualify_task", nodeType: "human_task", name: "Complete lead qualification checklist", configuration: { assignedUserId: input.actorUserId, title: "Complete lead qualification checklist", instructions: "Work through the assigned lead's qualification playbook in Sales OS, then mark this task complete.", dueInHours: 48 }, positionX: 1, positionY: 0 },
      { nodeKey: "end", nodeType: "end", name: "End", configuration: { requiredOutputs: [] }, positionX: 2, positionY: 0 },
    ],
    edges: [
      { sourceNodeKey: "start", targetNodeKey: "qualify_task" },
      { sourceNodeKey: "qualify_task", targetNodeKey: "end" },
    ],
  });

  const opportunityReview = await seedTemplate(db, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    workflowKey: OPPORTUNITY_REVIEW_TEMPLATE_KEY,
    name: "Opportunity Review Workflow",
    description: "Requests an explicit review/approval decision on an opportunity via the Opportunity Summary Assistant's evidence.",
    nodes: [
      { nodeKey: "start", nodeType: "start", name: "Start", configuration: {}, positionX: 0, positionY: 0 },
      {
        nodeKey: "review_approval",
        nodeType: "approval",
        name: "Review opportunity",
        configuration: { agentId: opportunitySummaryAgent.id, requestedAction: "review_opportunity", summary: "Review this opportunity's current health and confirm whether to continue pursuing it.", riskLevel: "low" },
        positionX: 1,
        positionY: 0,
      },
      { nodeKey: "end", nodeType: "end", name: "End", configuration: { requiredOutputs: [] }, positionX: 2, positionY: 0 },
    ],
    edges: [
      { sourceNodeKey: "start", targetNodeKey: "review_approval" },
      { sourceNodeKey: "review_approval", targetNodeKey: "end" },
    ],
  });

  const followUpSequence = await seedTemplate(db, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    workflowKey: FOLLOW_UP_SEQUENCE_TEMPLATE_KEY,
    name: "Follow-Up Sequence Workflow",
    description: "The workflow-backed step Sales OS follow-up sequences use for a `workflow_human_task` sequence step — never sends any real communication itself.",
    nodes: [
      { nodeKey: "start", nodeType: "start", name: "Start", configuration: {}, positionX: 0, positionY: 0 },
      { nodeKey: "sequence_task", nodeType: "human_task", name: "Sequence follow-up due", configuration: { assignedUserId: input.actorUserId, title: "Sequence follow-up due", instructions: "A follow-up sequence step is due — see the linked lead/opportunity in Sales OS for details.", dueInHours: 24 }, positionX: 1, positionY: 0 },
      { nodeKey: "end", nodeType: "end", name: "End", configuration: { requiredOutputs: [] }, positionX: 2, positionY: 0 },
    ],
    edges: [
      { sourceNodeKey: "start", targetNodeKey: "sequence_task" },
      { sourceNodeKey: "sequence_task", targetNodeKey: "end" },
    ],
  });

  return {
    leadQualification: { definitionId: leadQualification.definitionId, alreadyExisted: leadQualification.alreadyExisted },
    opportunityReview: { definitionId: opportunityReview.definitionId, alreadyExisted: opportunityReview.alreadyExisted },
    followUpSequence: { definitionId: followUpSequence.definitionId, alreadyExisted: followUpSequence.alreadyExisted },
  };
}
