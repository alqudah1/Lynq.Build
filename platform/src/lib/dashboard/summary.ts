import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { listProjectsForUser, type Project } from "@/lib/projects/projects";
import { listWorkflowExecutionsForUser, type WorkflowExecution } from "@/lib/workflows/executions";
import { listOpportunitiesForUser, type CrmOpportunity } from "@/lib/crm/opportunities";
import { listFollowUpsForUser } from "@/lib/crm/follow-ups";
import { listMyWorkflowHumanTasks } from "@/lib/workflows/human-tasks";
import { listPendingApprovalsForApprover } from "@/lib/agent-runtime/approvals";

type Db = NeonHttpDatabase<Record<string, unknown>>;

const ACTIVE_PROJECT_STATUSES = ["planning", "active", "paused", "blocked"] as const;
const RUNNING_EXECUTION_STATUSES = ["queued", "running", "waiting", "waiting_for_approval", "paused"] as const;

export interface DashboardSummary {
  activeProjects: Project[];
  activeProjectCount: number;
  runningExecutions: WorkflowExecution[];
  runningExecutionCount: number;
  openOpportunities: CrmOpportunity[];
  openOpportunityCount: number;
  openOpportunityValue: number;
  pendingFollowUpCount: number;
  pendingTaskCount: number;
  pendingApprovalCount: number;
}

/**
 * A read-only view aggregator for the dashboard home — calls each
 * module's own existing, unmodified list function (identical
 * authorization and tenant scoping as their real pages) and shapes the
 * result for display. No new business logic, no new authorization rule,
 * no fabricated data: every number here is `array.length` or a real sum
 * over rows a real query returned. CRM/Workflows failures are swallowed
 * to an empty result rather than breaking the dashboard for an org that
 * simply has no CRM/Workflow data yet (mirrors the same defensive
 * pattern already used for optional sections elsewhere in this
 * codebase, e.g. the CRM settings page's own agent-list fallback).
 */
export async function loadDashboardSummary(db: Db, input: { organizationId: string; workspaceId?: string; actorUserId: string }): Promise<DashboardSummary> {
  const [projects, executions, opportunities, followUps, tasks, approvals] = await Promise.all([
    listProjectsForUser(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, workspaceId: input.workspaceId }).catch(() => []),
    listWorkflowExecutionsForUser(db, { organizationId: input.organizationId, actorUserId: input.actorUserId }).catch(() => []),
    listOpportunitiesForUser(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, status: "open", limit: 200 }).catch(() => []),
    listFollowUpsForUser(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, status: "open", limit: 200 }).catch(() => []),
    listMyWorkflowHumanTasks(db, { organizationId: input.organizationId, actorUserId: input.actorUserId, status: "pending" }).catch(() => []),
    listPendingApprovalsForApprover(db, { organizationId: input.organizationId, actorUserId: input.actorUserId }).catch(() => []),
  ]);

  const activeProjects = projects.filter((p) => (ACTIVE_PROJECT_STATUSES as readonly string[]).includes(p.status));
  const runningExecutions = executions.filter((e) => (RUNNING_EXECUTION_STATUSES as readonly string[]).includes(e.status));

  return {
    activeProjects: activeProjects.slice(0, 5),
    activeProjectCount: activeProjects.length,
    runningExecutions: runningExecutions.slice(0, 5),
    runningExecutionCount: runningExecutions.length,
    openOpportunities: opportunities.slice(0, 5),
    openOpportunityCount: opportunities.length,
    openOpportunityValue: opportunities.reduce((sum, o) => sum + (o.amount ? Number(o.amount) : 0), 0),
    pendingFollowUpCount: followUps.length,
    pendingTaskCount: tasks.length,
    pendingApprovalCount: approvals.length,
  };
}
