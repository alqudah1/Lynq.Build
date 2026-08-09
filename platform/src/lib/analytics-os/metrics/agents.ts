import "server-only";
import { and, eq, isNotNull, count, sql } from "drizzle-orm";
import { agentExecutions, toolInvocations, agentApprovalRequests } from "@/db/schema";
import { requireOrganizationMembership } from "@/lib/authz/helpers";
import { workspaceScopeCondition } from "../query-support";
import type { MetricHandler, MetricComputeContext, MetricComputeResult } from "./types";

/** Agent Runtime's own authorization (`requireExecutionVisibility`/`requireExecutionManageAuthority`) is per-execution, like Projects Core and Workflow Engine — plain organization membership is the aggregate-safe floor for these org-wide counts; a caller drilling into one execution's own real detail still goes through that execution's own runtime authority checks. */
async function requireAgentsAggregateAccess(ctx: MetricComputeContext): Promise<void> {
  await requireOrganizationMembership(ctx.db, ctx.organizationId, ctx.actorUserId);
}

function single(value: number | null): MetricComputeResult {
  return { points: [{ value }], freshness: "live", asOf: new Date() };
}

export const agentExecutionsRunning: MetricHandler = {
  definition: {
    metricKey: "agent_executions_running",
    name: "Agent executions running",
    description: "Executions currently in a non-terminal, active state (assigned through verifying, excluding paused/waiting/human_approval).",
    domain: "agents",
    valueType: "count",
    aggregationType: "count",
    unit: "executions",
    classification: "actual",
    supportsTimeSeries: false,
    supportedTimeGrains: [],
    supportedDimensions: ["agent"],
    version: 1,
    nullSemantics: "0 means nothing running right now — never null.",
  },
  compute: async (ctx) => {
    await requireAgentsAggregateAccess(ctx);
    const [row] = await ctx.db
      .select({ value: count() })
      .from(agentExecutions)
      .where(and(eq(agentExecutions.organizationId, ctx.organizationId), sql`${agentExecutions.status} IN ('assigned','gathering_context','planning','reasoning','executing','delegating','verifying')`, workspaceScopeCondition(agentExecutions.workspaceId, ctx.workspaceId)));
    return single(row.value);
  },
};

export const agentExecutionsCompleted: MetricHandler = {
  definition: {
    metricKey: "agent_executions_completed",
    name: "Agent executions completed",
    description: "Executions that reached completed status within the range, by completedAt.",
    domain: "agents",
    valueType: "count",
    aggregationType: "count",
    unit: "executions",
    classification: "actual",
    supportsTimeSeries: true,
    supportedTimeGrains: ["day", "week", "month", "quarter"],
    supportedDimensions: ["agent"],
    version: 1,
    nullSemantics: "0 means nothing completed in this range — never null.",
  },
  compute: async (ctx) => {
    await requireAgentsAggregateAccess(ctx);
    const [row] = await ctx.db
      .select({ value: count() })
      .from(agentExecutions)
      .where(and(eq(agentExecutions.organizationId, ctx.organizationId), eq(agentExecutions.status, "completed"), isNotNull(agentExecutions.completedAt), sql`${agentExecutions.completedAt} >= ${ctx.from} AND ${agentExecutions.completedAt} <= ${ctx.to}`, workspaceScopeCondition(agentExecutions.workspaceId, ctx.workspaceId)));
    return single(row.value);
  },
};

export const agentExecutionsFailed: MetricHandler = {
  definition: {
    metricKey: "agent_executions_failed",
    name: "Agent executions failed",
    description: "Executions that reached failed status within the range, by failedAt.",
    domain: "agents",
    valueType: "count",
    aggregationType: "count",
    unit: "executions",
    classification: "actual",
    supportsTimeSeries: true,
    supportedTimeGrains: ["day", "week", "month", "quarter"],
    supportedDimensions: ["agent"],
    version: 1,
    nullSemantics: "0 means no failures in this range — never null.",
  },
  compute: async (ctx) => {
    await requireAgentsAggregateAccess(ctx);
    const [row] = await ctx.db
      .select({ value: count() })
      .from(agentExecutions)
      .where(and(eq(agentExecutions.organizationId, ctx.organizationId), eq(agentExecutions.status, "failed"), isNotNull(agentExecutions.failedAt), sql`${agentExecutions.failedAt} >= ${ctx.from} AND ${agentExecutions.failedAt} <= ${ctx.to}`, workspaceScopeCondition(agentExecutions.workspaceId, ctx.workspaceId)));
    return single(row.value);
  },
  drilldown: async (ctx) => {
    await requireAgentsAggregateAccess(ctx);
    const rows = await ctx.db
      .select({ id: agentExecutions.id })
      .from(agentExecutions)
      .where(and(eq(agentExecutions.organizationId, ctx.organizationId), eq(agentExecutions.status, "failed"), isNotNull(agentExecutions.failedAt), sql`${agentExecutions.failedAt} >= ${ctx.from} AND ${agentExecutions.failedAt} <= ${ctx.to}`, workspaceScopeCondition(agentExecutions.workspaceId, ctx.workspaceId)))
      .limit(200);
    return { entityType: "agent_execution", ids: rows.map((r) => r.id), totalCount: rows.length };
  },
};

export const agentSuccessRate: MetricHandler = {
  definition: {
    metricKey: "agent_success_rate",
    name: "Agent execution success rate",
    description: "Of executions reaching a terminal state (completed or failed) within the range, the percentage that completed successfully.",
    domain: "agents",
    valueType: "percentage",
    aggregationType: "ratio",
    unit: "%",
    classification: "derived",
    supportsTimeSeries: false,
    supportedTimeGrains: [],
    supportedDimensions: [],
    version: 1,
    nullSemantics: "null (not 0%) means no execution reached a terminal state in this range yet — a zero denominator, not a zero rate.",
  },
  compute: async (ctx) => {
    await requireAgentsAggregateAccess(ctx);
    const workspaceCondition = workspaceScopeCondition(agentExecutions.workspaceId, ctx.workspaceId);
    const completedCondition = and(eq(agentExecutions.organizationId, ctx.organizationId), eq(agentExecutions.status, "completed"), isNotNull(agentExecutions.completedAt), sql`${agentExecutions.completedAt} >= ${ctx.from} AND ${agentExecutions.completedAt} <= ${ctx.to}`, workspaceCondition);
    const failedCondition = and(eq(agentExecutions.organizationId, ctx.organizationId), eq(agentExecutions.status, "failed"), isNotNull(agentExecutions.failedAt), sql`${agentExecutions.failedAt} >= ${ctx.from} AND ${agentExecutions.failedAt} <= ${ctx.to}`, workspaceCondition);
    const [completedRow] = await ctx.db.select({ value: count() }).from(agentExecutions).where(completedCondition);
    const [failedRow] = await ctx.db.select({ value: count() }).from(agentExecutions).where(failedCondition);
    const denominator = completedRow.value + failedRow.value;
    if (denominator === 0) return single(null);
    return single(Math.round((completedRow.value / denominator) * 1000) / 10);
  },
};

export const agentAvgExecutionDurationSeconds: MetricHandler = {
  definition: {
    metricKey: "agent_avg_execution_duration",
    name: "Average execution duration",
    description: "Average seconds between startedAt and completedAt for executions completed within the range.",
    domain: "agents",
    valueType: "duration_seconds",
    aggregationType: "avg",
    unit: "seconds",
    classification: "derived",
    supportsTimeSeries: false,
    supportedTimeGrains: [],
    supportedDimensions: ["agent"],
    version: 1,
    nullSemantics: "null means no completed execution with both timestamps set exists in this range.",
  },
  compute: async (ctx) => {
    await requireAgentsAggregateAccess(ctx);
    const [row] = await ctx.db
      .select({ value: sql<number | null>`avg(extract(epoch from (${agentExecutions.completedAt} - ${agentExecutions.startedAt})))::float` })
      .from(agentExecutions)
      .where(
        and(
          eq(agentExecutions.organizationId, ctx.organizationId),
          eq(agentExecutions.status, "completed"),
          isNotNull(agentExecutions.startedAt),
          isNotNull(agentExecutions.completedAt),
          sql`${agentExecutions.completedAt} >= ${ctx.from} AND ${agentExecutions.completedAt} <= ${ctx.to}`,
          workspaceScopeCondition(agentExecutions.workspaceId, ctx.workspaceId)
        )
      );
    return single(row.value !== null ? Math.round(row.value) : null);
  },
};

export const toolInvocationsFailed: MetricHandler = {
  definition: {
    metricKey: "tool_invocations_failed",
    name: "Tool invocations failed",
    description: "Tool invocations that reached failed or timed_out status, by completedAt, within the range.",
    domain: "agents",
    valueType: "count",
    aggregationType: "count",
    unit: "invocations",
    classification: "actual",
    supportsTimeSeries: true,
    supportedTimeGrains: ["day", "week", "month", "quarter"],
    supportedDimensions: [],
    version: 1,
    nullSemantics: "0 means no failed or timed-out tool invocations in this range — never null.",
  },
  compute: async (ctx) => {
    await requireAgentsAggregateAccess(ctx);
    const [row] = await ctx.db
      .select({ value: count() })
      .from(toolInvocations)
      .where(and(eq(toolInvocations.organizationId, ctx.organizationId), sql`${toolInvocations.status} IN ('failed','timed_out')`, isNotNull(toolInvocations.completedAt), sql`${toolInvocations.completedAt} >= ${ctx.from} AND ${toolInvocations.completedAt} <= ${ctx.to}`, workspaceScopeCondition(toolInvocations.workspaceId, ctx.workspaceId)));
    return single(row.value);
  },
  drilldown: async (ctx) => {
    await requireAgentsAggregateAccess(ctx);
    const rows = await ctx.db
      .select({ id: toolInvocations.id })
      .from(toolInvocations)
      .where(and(eq(toolInvocations.organizationId, ctx.organizationId), sql`${toolInvocations.status} IN ('failed','timed_out')`, isNotNull(toolInvocations.completedAt), sql`${toolInvocations.completedAt} >= ${ctx.from} AND ${toolInvocations.completedAt} <= ${ctx.to}`, workspaceScopeCondition(toolInvocations.workspaceId, ctx.workspaceId)))
      .limit(200);
    return { entityType: "tool_invocation", ids: rows.map((r) => r.id), totalCount: rows.length };
  },
};

export const agentApprovalsPending: MetricHandler = {
  definition: {
    metricKey: "approvals_pending",
    name: "Approvals pending",
    description: "Agent approval requests currently in pending status (a live snapshot count — not bounded by the query date range). Approval requests carry no workspace column of their own — scoped through their own execution's real workspaceId via a join.",
    domain: "agents",
    valueType: "count",
    aggregationType: "count",
    unit: "requests",
    classification: "actual",
    supportsTimeSeries: false,
    supportedTimeGrains: [],
    supportedDimensions: [],
    version: 1,
    nullSemantics: "0 means nothing pending right now — never null.",
  },
  compute: async (ctx) => {
    await requireAgentsAggregateAccess(ctx);
    const [row] = await ctx.db
      .select({ value: count() })
      .from(agentApprovalRequests)
      .innerJoin(agentExecutions, eq(agentExecutions.id, agentApprovalRequests.executionId))
      .where(and(eq(agentApprovalRequests.organizationId, ctx.organizationId), eq(agentApprovalRequests.status, "pending"), workspaceScopeCondition(agentExecutions.workspaceId, ctx.workspaceId)));
    return single(row.value);
  },
  drilldown: async (ctx) => {
    await requireAgentsAggregateAccess(ctx);
    const rows = await ctx.db
      .select({ id: agentApprovalRequests.id })
      .from(agentApprovalRequests)
      .innerJoin(agentExecutions, eq(agentExecutions.id, agentApprovalRequests.executionId))
      .where(and(eq(agentApprovalRequests.organizationId, ctx.organizationId), eq(agentApprovalRequests.status, "pending"), workspaceScopeCondition(agentExecutions.workspaceId, ctx.workspaceId)))
      .limit(200);
    return { entityType: "agent_approval_request", ids: rows.map((r) => r.id), totalCount: rows.length };
  },
};

export const AGENTS_METRICS: MetricHandler[] = [
  agentExecutionsRunning,
  agentExecutionsCompleted,
  agentExecutionsFailed,
  agentSuccessRate,
  agentAvgExecutionDurationSeconds,
  toolInvocationsFailed,
  agentApprovalsPending,
];
