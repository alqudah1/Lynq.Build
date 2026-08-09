import "server-only";
import { and, eq, lt, isNotNull, count, sql } from "drizzle-orm";
import { projects, projectTasks } from "@/db/schema";
import { requireOrganizationMembership } from "@/lib/authz/helpers";
import { workspaceScopeCondition } from "../query-support";
import type { MetricHandler, MetricComputeContext, MetricComputeResult } from "./types";

/**
 * Projects Core has no org-wide "view all projects in aggregate" gate of
 * its own — its real authorization (`requireProjectViewAuthority`) is
 * deliberately per-project. Plain organization membership (already
 * enforced by `resolveAnalyticsAuthContext` itself) is therefore the
 * aggregate-safe floor for COUNTS here; a caller drilling into a specific
 * project's own real records still goes through that project's own
 * `requireProjectViewAuthority` via the real Projects Core read function.
 */
async function requireProjectsAggregateAccess(ctx: MetricComputeContext): Promise<void> {
  await requireOrganizationMembership(ctx.db, ctx.organizationId, ctx.actorUserId);
}

function single(value: number | null): MetricComputeResult {
  return { points: [{ value }], freshness: "live", asOf: new Date() };
}

export const projectsActive: MetricHandler = {
  definition: {
    metricKey: "projects_active",
    name: "Active projects",
    description: "Projects currently in active status.",
    domain: "projects",
    valueType: "count",
    aggregationType: "count",
    unit: "projects",
    classification: "actual",
    supportsTimeSeries: false,
    supportedTimeGrains: [],
    supportedDimensions: [],
    version: 1,
    nullSemantics: "0 means no active projects right now — never null.",
  },
  compute: async (ctx) => {
    await requireProjectsAggregateAccess(ctx);
    const [row] = await ctx.db
      .select({ value: count() })
      .from(projects)
      .where(and(eq(projects.organizationId, ctx.organizationId), eq(projects.status, "active"), workspaceScopeCondition(projects.workspaceId, ctx.workspaceId)));
    return single(row.value);
  },
};

export const projectsBlocked: MetricHandler = {
  definition: {
    metricKey: "projects_blocked",
    name: "Blocked projects",
    description: "Projects currently in blocked status.",
    domain: "projects",
    valueType: "count",
    aggregationType: "count",
    unit: "projects",
    classification: "actual",
    supportsTimeSeries: false,
    supportedTimeGrains: [],
    supportedDimensions: [],
    version: 1,
    nullSemantics: "0 means no blocked projects right now — never null.",
  },
  compute: async (ctx) => {
    await requireProjectsAggregateAccess(ctx);
    const [row] = await ctx.db
      .select({ value: count() })
      .from(projects)
      .where(and(eq(projects.organizationId, ctx.organizationId), eq(projects.status, "blocked"), workspaceScopeCondition(projects.workspaceId, ctx.workspaceId)));
    return single(row.value);
  },
  drilldown: async (ctx) => {
    await requireProjectsAggregateAccess(ctx);
    const rows = await ctx.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.organizationId, ctx.organizationId), eq(projects.status, "blocked"), workspaceScopeCondition(projects.workspaceId, ctx.workspaceId)))
      .limit(200);
    return { entityType: "project", ids: rows.map((r) => r.id), totalCount: rows.length };
  },
};

export const projectTasksOpen: MetricHandler = {
  definition: {
    metricKey: "project_tasks_open",
    name: "Open tasks",
    description: "Tasks not yet completed or cancelled, across all projects. Tasks carry no workspace column of their own — scoped through their own project's real workspaceId via a join.",
    domain: "projects",
    valueType: "count",
    aggregationType: "count",
    unit: "tasks",
    classification: "actual",
    supportsTimeSeries: false,
    supportedTimeGrains: [],
    supportedDimensions: ["project"],
    version: 1,
    nullSemantics: "0 means no open tasks right now — never null.",
  },
  compute: async (ctx) => {
    await requireProjectsAggregateAccess(ctx);
    const base = and(eq(projectTasks.organizationId, ctx.organizationId), sql`${projectTasks.status} NOT IN ('completed','cancelled')`, workspaceScopeCondition(projects.workspaceId, ctx.workspaceId));
    if (ctx.groupBy === "project") {
      const rows = await ctx.db.select({ value: count(), dim: projectTasks.projectId }).from(projectTasks).innerJoin(projects, eq(projects.id, projectTasks.projectId)).where(base).groupBy(projectTasks.projectId);
      return { points: rows.map((r) => ({ value: r.value, dimensionValue: r.dim, dimensionLabel: r.dim })), freshness: "live", asOf: new Date() };
    }
    const [row] = await ctx.db
      .select({ value: count() })
      .from(projectTasks)
      .innerJoin(projects, eq(projects.id, projectTasks.projectId))
      .where(base);
    return single(row.value);
  },
};

export const projectTasksOverdue: MetricHandler = {
  definition: {
    metricKey: "project_tasks_overdue",
    name: "Overdue tasks",
    description: "Open tasks whose dueDate has already passed. Scoped through the task's own project's real workspaceId via a join.",
    domain: "projects",
    valueType: "count",
    aggregationType: "count",
    unit: "tasks",
    classification: "actual",
    supportsTimeSeries: false,
    supportedTimeGrains: [],
    supportedDimensions: ["project"],
    version: 1,
    nullSemantics: "0 means no overdue tasks right now — never null.",
  },
  compute: async (ctx) => {
    await requireProjectsAggregateAccess(ctx);
    const [row] = await ctx.db
      .select({ value: count() })
      .from(projectTasks)
      .innerJoin(projects, eq(projects.id, projectTasks.projectId))
      .where(and(eq(projectTasks.organizationId, ctx.organizationId), sql`${projectTasks.status} NOT IN ('completed','cancelled')`, isNotNull(projectTasks.dueDate), lt(projectTasks.dueDate, ctx.to), workspaceScopeCondition(projects.workspaceId, ctx.workspaceId)));
    return single(row.value);
  },
  drilldown: async (ctx) => {
    await requireProjectsAggregateAccess(ctx);
    const rows = await ctx.db
      .select({ id: projectTasks.id })
      .from(projectTasks)
      .innerJoin(projects, eq(projects.id, projectTasks.projectId))
      .where(and(eq(projectTasks.organizationId, ctx.organizationId), sql`${projectTasks.status} NOT IN ('completed','cancelled')`, isNotNull(projectTasks.dueDate), lt(projectTasks.dueDate, ctx.to), workspaceScopeCondition(projects.workspaceId, ctx.workspaceId)))
      .limit(200);
    return { entityType: "project_task", ids: rows.map((r) => r.id), totalCount: rows.length };
  },
};

export const projectCompletionRate: MetricHandler = {
  definition: {
    metricKey: "project_completion_rate",
    name: "Task completion rate",
    description: "Of non-cancelled tasks across all projects, the percentage marked completed. Scoped through each task's own project's real workspaceId via a join.",
    domain: "projects",
    valueType: "percentage",
    aggregationType: "ratio",
    unit: "%",
    classification: "derived",
    supportsTimeSeries: false,
    supportedTimeGrains: [],
    supportedDimensions: ["project"],
    version: 1,
    nullSemantics: "null (not 0%) means there are no eligible (non-cancelled) tasks yet — a zero denominator, not a zero rate.",
  },
  compute: async (ctx) => {
    await requireProjectsAggregateAccess(ctx);
    const [eligibleRow] = await ctx.db
      .select({ value: count() })
      .from(projectTasks)
      .innerJoin(projects, eq(projects.id, projectTasks.projectId))
      .where(and(eq(projectTasks.organizationId, ctx.organizationId), sql`${projectTasks.status} <> 'cancelled'`, workspaceScopeCondition(projects.workspaceId, ctx.workspaceId)));
    if (eligibleRow.value === 0) return single(null);
    const [completedRow] = await ctx.db
      .select({ value: count() })
      .from(projectTasks)
      .innerJoin(projects, eq(projects.id, projectTasks.projectId))
      .where(and(eq(projectTasks.organizationId, ctx.organizationId), eq(projectTasks.status, "completed"), workspaceScopeCondition(projects.workspaceId, ctx.workspaceId)));
    return single(Math.round((completedRow.value / eligibleRow.value) * 1000) / 10);
  },
};

export const PROJECTS_METRICS: MetricHandler[] = [projectsActive, projectsBlocked, projectTasksOpen, projectTasksOverdue, projectCompletionRate];
