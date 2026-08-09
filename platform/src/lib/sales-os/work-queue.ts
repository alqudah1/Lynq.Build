import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { crmLeads, crmFollowUps, workflowExecutions, workflowDefinitions } from "@/db/schema";
import { listMyWorkflowHumanTasks, type WorkflowHumanTask } from "@/lib/workflows/human-tasks";
import type { AgentApprovalRequest } from "@/lib/agent-runtime/approvals";
import type { CrmFollowUp } from "@/lib/crm/follow-ups";
import type { CrmLead } from "@/lib/crm/leads";
import { resolveSalesAuthContext, requireSalesViewAuthority } from "./authz";
import { listQualificationRunsForAssignee, type SalesLeadQualificationRun } from "./qualification";
import { listOpportunityPlaybookRunsForAssignee, type SalesOpportunityPlaybookRun } from "./opportunity-playbooks";
import { computeNextBestActionsForUser, type NextBestAction } from "./next-best-action";
import { listPendingSalesApprovalsForApprover } from "./approvals";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export const SALES_WORKFLOW_TEMPLATE_KEYS = ["LEAD_QUALIFICATION_TEMPLATE", "OPPORTUNITY_REVIEW_TEMPLATE", "FOLLOW_UP_SEQUENCE_TEMPLATE"] as const;

export interface SalesWorkQueue {
  assignedLeads: CrmLead[];
  openFollowUps: CrmFollowUp[];
  activeQualificationSessions: SalesLeadQualificationRun[];
  activeOpportunityPlaybookRuns: SalesOpportunityPlaybookRun[];
  pendingSalesApprovals: AgentApprovalRequest[];
  salesWorkflowHumanTasks: WorkflowHumanTask[];
  nextBestActions: NextBestAction[];
}

/**
 * "My Sales Work" — every field here is a filtered/derived view over
 * already-canonical records (CRM leads/follow-ups, Sales OS runs, Runtime
 * approvals, Workflow human tasks). Nothing in this module creates a new
 * operational task record; it only aggregates and labels existing ones.
 */
export async function getSalesWorkQueueForUser(db: Db, input: { organizationId: string; workspaceId?: string | null; forUserId: string; actorUserId: string }): Promise<SalesWorkQueue> {
  const ctx = await resolveSalesAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireSalesViewAuthority(db, ctx, "sales_work_queue", input.forUserId);

  const assignedLeads = (await db
    .select()
    .from(crmLeads)
    .where(and(eq(crmLeads.organizationId, input.organizationId), eq(crmLeads.ownerUserId, input.forUserId), inArray(crmLeads.status, ["new", "contacted", "engaged", "qualified"])))) as unknown as CrmLead[];

  const openFollowUps = (await db.select().from(crmFollowUps).where(and(eq(crmFollowUps.organizationId, input.organizationId), eq(crmFollowUps.assignedUserId, input.forUserId), eq(crmFollowUps.status, "open")))) as unknown as CrmFollowUp[];

  const activeQualificationSessions = await listQualificationRunsForAssignee(db, { organizationId: input.organizationId, assignedUserId: input.forUserId, actorUserId: input.actorUserId });
  const activeOpportunityPlaybookRuns = await listOpportunityPlaybookRunsForAssignee(db, { organizationId: input.organizationId, assignedUserId: input.forUserId, status: "active", actorUserId: input.actorUserId });

  const pendingSalesApprovals = await listPendingSalesApprovalsForApprover(db, { organizationId: input.organizationId, actorUserId: input.forUserId });

  const allTasks = await listMyWorkflowHumanTasks(db, { organizationId: input.organizationId, actorUserId: input.forUserId, status: "pending" });
  const salesExecutionIds = new Set(
    (
      await db
        .select({ executionId: workflowExecutions.id })
        .from(workflowExecutions)
        .innerJoin(workflowDefinitions, eq(workflowDefinitions.id, workflowExecutions.workflowDefinitionId))
        .where(and(eq(workflowExecutions.organizationId, input.organizationId), inArray(workflowDefinitions.workflowKey, [...SALES_WORKFLOW_TEMPLATE_KEYS])))
    ).map((r) => r.executionId)
  );
  const salesWorkflowHumanTasks = allTasks.filter((t) => salesExecutionIds.has(t.workflowExecutionId));

  const nextBestActions = await computeNextBestActionsForUser(db, { organizationId: input.organizationId, workspaceId: input.workspaceId, forUserId: input.forUserId, actorUserId: input.actorUserId });

  return { assignedLeads, openFollowUps, activeQualificationSessions, activeOpportunityPlaybookRuns, pendingSalesApprovals, salesWorkflowHumanTasks, nextBestActions };
}
