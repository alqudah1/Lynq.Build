import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { and, eq, isNotNull, gte, count } from "drizzle-orm";
import { projectMilestones, projects, workflowExecutions } from "@/db/schema";
import { requireOrganizationMembership } from "@/lib/authz/helpers";
import { runAnalyticsQuery, type AnalyticsMetricResult } from "@/lib/analytics-os/query";
import { workspaceScopeCondition } from "@/lib/analytics-os/query-support";
import { resolveFounderAuthContext, requireFounderViewAuthority, hasFounderCapability } from "./authz";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface ExecutiveProjectsView {
  metrics: AnalyticsMetricResult[];
  recentlyCompletedMilestones: { id: string; title: string; completedAt: string }[];
  linkedWorkflowFailures: number;
}

/** Projects Core has no org-wide aggregate authority of its own (see Analytics OS's own documented distinction) — plain organization membership is the floor here too, matching the underlying metrics' own gate. */
export async function computeExecutiveProjectsView(db: Db, input: { organizationId: string; workspaceId: string | null; actorUserId: string }): Promise<ExecutiveProjectsView> {
  const founderCtx = await resolveFounderAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireFounderViewAuthority(db, founderCtx, "founder_projects_view", input.organizationId);
  if (!hasFounderCapability(founderCtx, "founder_workspace_view_operations")) return { metrics: [], recentlyCompletedMilestones: [], linkedWorkflowFailures: 0 };
  await requireOrganizationMembership(db, input.organizationId, input.actorUserId);

  const result = await runAnalyticsQuery(db, {
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    metricKeys: ["projects_active", "projects_blocked", "project_tasks_open", "project_tasks_overdue", "project_completion_rate"],
    recordAudit: false,
  });

  const recentWindow = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const recentlyCompleted = await db
    .select({ id: projectMilestones.id, title: projectMilestones.title, completedAt: projectMilestones.completedAt })
    .from(projectMilestones)
    .innerJoin(projects, eq(projects.id, projectMilestones.projectId))
    .where(and(eq(projectMilestones.organizationId, input.organizationId), eq(projectMilestones.status, "completed"), isNotNull(projectMilestones.completedAt), gte(projectMilestones.completedAt, recentWindow), workspaceScopeCondition(projects.workspaceId, input.workspaceId)))
    .limit(10);

  const [linkedFailuresRow] = await db
    .select({ value: count() })
    .from(workflowExecutions)
    .where(and(eq(workflowExecutions.organizationId, input.organizationId), eq(workflowExecutions.status, "failed"), isNotNull(workflowExecutions.projectId), workspaceScopeCondition(workflowExecutions.workspaceId, input.workspaceId)));

  return {
    metrics: result.metrics,
    recentlyCompletedMilestones: recentlyCompleted.map((m) => ({ id: m.id, title: m.title, completedAt: m.completedAt!.toISOString() })),
    linkedWorkflowFailures: linkedFailuresRow.value,
  };
}
