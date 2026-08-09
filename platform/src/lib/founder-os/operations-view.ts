import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { and, eq, lt, count } from "drizzle-orm";
import { workflowExecutions, runtimeJobs } from "@/db/schema";
import { requireOrganizationMembership } from "@/lib/authz/helpers";
import { runAnalyticsQuery, type AnalyticsMetricResult } from "@/lib/analytics-os/query";
import { workspaceScopeCondition } from "@/lib/analytics-os/query-support";
import { resolveFounderAuthContext, requireFounderViewAuthority, hasFounderCapability } from "./authz";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface ExecutiveOperationsView {
  metrics: AnalyticsMetricResult[];
  workflowsWaitingForApproval: number;
  runtimeQueueState: { status: string; count: number }[];
  retryScheduled: number;
  deadLettered: number;
  expiredLeases: number;
}

/** Workflow Engine and Runtime have no org-wide aggregate authority of their own — plain organization membership is the floor, matching the underlying metrics' own gate. */
export async function computeExecutiveOperationsView(db: Db, input: { organizationId: string; workspaceId: string | null; actorUserId: string }): Promise<ExecutiveOperationsView> {
  const founderCtx = await resolveFounderAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireFounderViewAuthority(db, founderCtx, "founder_operations_view", input.organizationId);
  if (!hasFounderCapability(founderCtx, "founder_workspace_view_operations")) {
    return { metrics: [], workflowsWaitingForApproval: 0, runtimeQueueState: [], retryScheduled: 0, deadLettered: 0, expiredLeases: 0 };
  }
  await requireOrganizationMembership(db, input.organizationId, input.actorUserId);

  const result = await runAnalyticsQuery(db, {
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    metricKeys: ["workflows_running", "workflows_completed", "workflows_failed", "workflow_completion_rate", "workflow_avg_duration", "tool_invocations_failed"],
    recordAudit: false,
  });

  const [waitingRow] = await db
    .select({ value: count() })
    .from(workflowExecutions)
    .where(and(eq(workflowExecutions.organizationId, input.organizationId), eq(workflowExecutions.status, "waiting_for_approval"), workspaceScopeCondition(workflowExecutions.workspaceId, input.workspaceId)));

  const queueRows = await db
    .select({ status: runtimeJobs.status, value: count() })
    .from(runtimeJobs)
    .where(and(eq(runtimeJobs.organizationId, input.organizationId), workspaceScopeCondition(runtimeJobs.workspaceId, input.workspaceId)))
    .groupBy(runtimeJobs.status);

  const [retryRow] = await db
    .select({ value: count() })
    .from(runtimeJobs)
    .where(and(eq(runtimeJobs.organizationId, input.organizationId), eq(runtimeJobs.status, "retry_scheduled"), workspaceScopeCondition(runtimeJobs.workspaceId, input.workspaceId)));
  const [deadLetterRow] = await db
    .select({ value: count() })
    .from(runtimeJobs)
    .where(and(eq(runtimeJobs.organizationId, input.organizationId), eq(runtimeJobs.status, "dead_lettered"), workspaceScopeCondition(runtimeJobs.workspaceId, input.workspaceId)));
  const [expiredLeaseRow] = await db
    .select({ value: count() })
    .from(runtimeJobs)
    .where(and(eq(runtimeJobs.organizationId, input.organizationId), eq(runtimeJobs.status, "leased"), lt(runtimeJobs.leaseExpiresAt, new Date()), workspaceScopeCondition(runtimeJobs.workspaceId, input.workspaceId)));

  return {
    metrics: result.metrics,
    workflowsWaitingForApproval: waitingRow.value,
    runtimeQueueState: queueRows.map((r) => ({ status: r.status, count: r.value })),
    retryScheduled: retryRow.value,
    deadLettered: deadLetterRow.value,
    expiredLeases: expiredLeaseRow.value,
  };
}
