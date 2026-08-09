import "server-only";
import { and, eq, isNotNull, count, sql } from "drizzle-orm";
import { workflowExecutions } from "@/db/schema";
import { requireOrganizationMembership } from "@/lib/authz/helpers";
import { workspaceScopeCondition } from "../query-support";
import type { MetricHandler, MetricComputeContext, MetricComputeResult } from "./types";

/** Workflow Engine's own authority is per-definition/per-execution, like Projects Core — plain organization membership is the aggregate-safe floor for these org-wide counts; drill-down into one execution's own real detail still goes through `requireWorkflowExecutionViewAuthority`. */
async function requireWorkflowsAggregateAccess(ctx: MetricComputeContext): Promise<void> {
  await requireOrganizationMembership(ctx.db, ctx.organizationId, ctx.actorUserId);
}

function single(value: number | null): MetricComputeResult {
  return { points: [{ value }], freshness: "live", asOf: new Date() };
}

export const workflowsRunning: MetricHandler = {
  definition: {
    metricKey: "workflows_running",
    name: "Workflows running",
    description: "Workflow executions currently in a non-terminal, non-paused state (running/waiting/waiting_for_approval).",
    domain: "workflows",
    valueType: "count",
    aggregationType: "count",
    unit: "executions",
    classification: "actual",
    supportsTimeSeries: false,
    supportedTimeGrains: [],
    supportedDimensions: ["workflow"],
    version: 1,
    nullSemantics: "0 means nothing running right now — never null.",
  },
  compute: async (ctx) => {
    await requireWorkflowsAggregateAccess(ctx);
    const [row] = await ctx.db
      .select({ value: count() })
      .from(workflowExecutions)
      .where(and(eq(workflowExecutions.organizationId, ctx.organizationId), sql`${workflowExecutions.status} IN ('running','waiting','waiting_for_approval')`, workspaceScopeCondition(workflowExecutions.workspaceId, ctx.workspaceId)));
    return single(row.value);
  },
};

export const workflowsCompleted: MetricHandler = {
  definition: {
    metricKey: "workflows_completed",
    name: "Workflows completed",
    description: "Workflow executions completed within the range, by completedAt.",
    domain: "workflows",
    valueType: "count",
    aggregationType: "count",
    unit: "executions",
    classification: "actual",
    supportsTimeSeries: true,
    supportedTimeGrains: ["day", "week", "month", "quarter"],
    supportedDimensions: ["workflow"],
    version: 1,
    nullSemantics: "0 means nothing completed in this range — never null.",
  },
  compute: async (ctx) => {
    await requireWorkflowsAggregateAccess(ctx);
    const [row] = await ctx.db
      .select({ value: count() })
      .from(workflowExecutions)
      .where(and(eq(workflowExecutions.organizationId, ctx.organizationId), eq(workflowExecutions.status, "completed"), isNotNull(workflowExecutions.completedAt), sql`${workflowExecutions.completedAt} >= ${ctx.from} AND ${workflowExecutions.completedAt} <= ${ctx.to}`, workspaceScopeCondition(workflowExecutions.workspaceId, ctx.workspaceId)));
    return single(row.value);
  },
};

export const workflowsFailed: MetricHandler = {
  definition: {
    metricKey: "workflows_failed",
    name: "Workflows failed",
    description: "Workflow executions that failed within the range, by completedAt.",
    domain: "workflows",
    valueType: "count",
    aggregationType: "count",
    unit: "executions",
    classification: "actual",
    supportsTimeSeries: true,
    supportedTimeGrains: ["day", "week", "month", "quarter"],
    supportedDimensions: ["workflow"],
    version: 1,
    nullSemantics: "0 means no failures in this range — never null.",
  },
  compute: async (ctx) => {
    await requireWorkflowsAggregateAccess(ctx);
    const [row] = await ctx.db
      .select({ value: count() })
      .from(workflowExecutions)
      .where(and(eq(workflowExecutions.organizationId, ctx.organizationId), eq(workflowExecutions.status, "failed"), isNotNull(workflowExecutions.completedAt), sql`${workflowExecutions.completedAt} >= ${ctx.from} AND ${workflowExecutions.completedAt} <= ${ctx.to}`, workspaceScopeCondition(workflowExecutions.workspaceId, ctx.workspaceId)));
    return single(row.value);
  },
  drilldown: async (ctx) => {
    await requireWorkflowsAggregateAccess(ctx);
    const rows = await ctx.db
      .select({ id: workflowExecutions.id })
      .from(workflowExecutions)
      .where(and(eq(workflowExecutions.organizationId, ctx.organizationId), eq(workflowExecutions.status, "failed"), isNotNull(workflowExecutions.completedAt), sql`${workflowExecutions.completedAt} >= ${ctx.from} AND ${workflowExecutions.completedAt} <= ${ctx.to}`, workspaceScopeCondition(workflowExecutions.workspaceId, ctx.workspaceId)))
      .limit(200);
    return { entityType: "workflow_execution", ids: rows.map((r) => r.id), totalCount: rows.length };
  },
};

export const workflowCompletionRate: MetricHandler = {
  definition: {
    metricKey: "workflow_completion_rate",
    name: "Workflow completion rate",
    description: "Of executions reaching a terminal state (completed or failed) within the range, the percentage that completed successfully.",
    domain: "workflows",
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
    await requireWorkflowsAggregateAccess(ctx);
    const terminalCondition = and(
      eq(workflowExecutions.organizationId, ctx.organizationId),
      isNotNull(workflowExecutions.completedAt),
      sql`${workflowExecutions.completedAt} >= ${ctx.from} AND ${workflowExecutions.completedAt} <= ${ctx.to}`,
      sql`${workflowExecutions.status} IN ('completed','failed')`,
      workspaceScopeCondition(workflowExecutions.workspaceId, ctx.workspaceId)
    );
    const [totalRow] = await ctx.db.select({ value: count() }).from(workflowExecutions).where(terminalCondition);
    if (totalRow.value === 0) return single(null);
    const [completedRow] = await ctx.db.select({ value: count() }).from(workflowExecutions).where(and(terminalCondition, eq(workflowExecutions.status, "completed")));
    return single(Math.round((completedRow.value / totalRow.value) * 1000) / 10);
  },
};

export const workflowAvgDurationSeconds: MetricHandler = {
  definition: {
    metricKey: "workflow_avg_duration",
    name: "Average workflow duration",
    description: "Average seconds between startedAt and completedAt for executions completed within the range.",
    domain: "workflows",
    valueType: "duration_seconds",
    aggregationType: "avg",
    unit: "seconds",
    classification: "derived",
    supportsTimeSeries: false,
    supportedTimeGrains: [],
    supportedDimensions: ["workflow"],
    version: 1,
    nullSemantics: "null means no completed execution with both timestamps set exists in this range.",
  },
  compute: async (ctx) => {
    await requireWorkflowsAggregateAccess(ctx);
    const [row] = await ctx.db
      .select({ value: sql<number | null>`avg(extract(epoch from (${workflowExecutions.completedAt} - ${workflowExecutions.startedAt})))::float` })
      .from(workflowExecutions)
      .where(
        and(
          eq(workflowExecutions.organizationId, ctx.organizationId),
          eq(workflowExecutions.status, "completed"),
          isNotNull(workflowExecutions.startedAt),
          isNotNull(workflowExecutions.completedAt),
          sql`${workflowExecutions.completedAt} >= ${ctx.from} AND ${workflowExecutions.completedAt} <= ${ctx.to}`,
          workspaceScopeCondition(workflowExecutions.workspaceId, ctx.workspaceId)
        )
      );
    return single(row.value !== null ? Math.round(row.value) : null);
  },
};

export const WORKFLOW_METRICS: MetricHandler[] = [workflowsRunning, workflowsCompleted, workflowsFailed, workflowCompletionRate, workflowAvgDurationSeconds];
