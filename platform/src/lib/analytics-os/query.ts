import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { recordAuditEvent } from "@/lib/audit";
import { resolveAnalyticsAuthContext, requireAnalyticsViewAuthority, requireAnalyticsCapability } from "./authz";
import { resolveEffectiveAnalyticsConfiguration } from "./configuration";
import { resolveMetric, assertMetricSupportsDimension, assertMetricSupportsTimeGrain } from "./metrics/registry";
import { resolveDateRangeForStrategy, resolveComparisonRange, computePercentChange, type ComparisonStrategy, type ResolvedDateRange } from "./time";
import { QueryTooComplexError } from "./errors";
import { DOMAIN_VIEW_CAPABILITY, MAX_METRIC_KEYS_PER_QUERY, MAX_GROUP_BY_CARDINALITY, type AnalyticsDateRangeStrategy, type AnalyticsTimeGrain } from "./validation";
import type { MetricComputeContext, MetricComputeResult, MetricSeriesPoint, MetricClassification, MetricFreshness, MetricValueType, MetricAggregationType } from "./metrics/types";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface AnalyticsQueryInput {
  organizationId: string;
  workspaceId: string | null;
  actorUserId: string;
  metricKeys: string[];
  dateRangeStrategy?: AnalyticsDateRangeStrategy;
  customFrom?: Date;
  customTo?: Date;
  comparisonStrategy?: ComparisonStrategy;
  customComparisonFrom?: Date;
  customComparisonTo?: Date;
  timeGrain?: AnalyticsTimeGrain;
  groupBy?: string;
  includeSeries?: boolean;
  /** Set false for automated/polling callers (e.g. a dashboard auto-refresh) so `analytics_query_executed` audit noise stays limited to genuinely human-driven queries, per this module's own audit-noise rule. */
  recordAudit?: boolean;
}

export interface AnalyticsMetricComparison {
  absoluteDiff: number | null;
  percentChange: number | null;
}

export interface AnalyticsMetricResult {
  metricKey: string;
  name: string;
  description: string;
  valueType: MetricValueType;
  aggregationType: MetricAggregationType;
  unit: string | null;
  classification: MetricClassification;
  nullSemantics: string;
  current: MetricComputeResult;
  previous: MetricComputeResult | null;
  comparison: AnalyticsMetricComparison | null;
  series: MetricSeriesPoint[] | null;
  freshness: MetricFreshness;
  asOf: Date;
  sourceDomain: string;
  sourceVersion: number;
}

export interface AnalyticsQueryResult {
  organizationId: string;
  workspaceId: string | null;
  range: ResolvedDateRange;
  comparisonRange: ResolvedDateRange | null;
  timeGrain: AnalyticsTimeGrain;
  metrics: AnalyticsMetricResult[];
}

/**
 * ============================================================================
 * Query engine — Module 17
 * ============================================================================
 * The one bounded entry point every metric read goes through. Order of
 * checks, deliberately: (1) central `analytics_view` — the floor for
 * touching Analytics at all; (2) per-metric central `analytics_view_<domain>`
 * capability; (3) each metric's own `compute()` independently re-checks its
 * SOURCE module's own aggregate-safe view authority. Step 3 is never
 * skipped or assumed — the central capability in step 2 does not substitute
 * for it, by design (see `authz.ts`'s own module comment).
 */
export async function runAnalyticsQuery(db: Db, input: AnalyticsQueryInput): Promise<AnalyticsQueryResult> {
  if (input.metricKeys.length === 0) throw new QueryTooComplexError("At least one metric key is required.");
  if (input.metricKeys.length > MAX_METRIC_KEYS_PER_QUERY) throw new QueryTooComplexError(`A query may request at most ${MAX_METRIC_KEYS_PER_QUERY} metrics at once.`);

  const authCtx = await resolveAnalyticsAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireAnalyticsViewAuthority(db, authCtx, "analytics_query", input.organizationId);

  const config = await resolveEffectiveAnalyticsConfiguration(db, { organizationId: input.organizationId, workspaceId: input.workspaceId, actorUserId: input.actorUserId });

  const strategy = input.dateRangeStrategy ?? config.defaultDateRangeStrategy;
  const range = resolveDateRangeForStrategy(strategy, config.businessTimezone, input.customFrom && input.customTo ? { from: input.customFrom, to: input.customTo } : null);

  const comparisonStrategy: ComparisonStrategy = input.comparisonStrategy ?? (config.defaultComparisonEnabled ? "previous_period" : "none");
  const comparisonRange = resolveComparisonRange(comparisonStrategy, range, config.businessTimezone, input.customComparisonFrom && input.customComparisonTo ? { from: input.customComparisonFrom, to: input.customComparisonTo } : null);

  const timeGrain = input.timeGrain ?? config.defaultTimeGrain;

  const handlers = input.metricKeys.map((key) => resolveMetric(key));

  for (const handler of handlers) {
    await requireAnalyticsCapability(db, authCtx, DOMAIN_VIEW_CAPABILITY[handler.definition.domain], "analytics_metric", handler.definition.metricKey);
    if (input.groupBy) assertMetricSupportsDimension(handler, input.groupBy);
    if (input.includeSeries && handler.computeSeries) assertMetricSupportsTimeGrain(handler, timeGrain);
  }

  const metrics: AnalyticsMetricResult[] = [];

  for (const handler of handlers) {
    const currentCtx: MetricComputeContext = { db, organizationId: input.organizationId, workspaceId: input.workspaceId, from: range.from, to: range.to, actorUserId: input.actorUserId, groupBy: input.groupBy };
    const current = await handler.compute(currentCtx);
    if (current.points.length > MAX_GROUP_BY_CARDINALITY) {
      throw new QueryTooComplexError(`Metric "${handler.definition.metricKey}" returned more than ${MAX_GROUP_BY_CARDINALITY} grouped rows — narrow the date range or drop groupBy.`);
    }

    let previous: MetricComputeResult | null = null;
    let comparison: AnalyticsMetricComparison | null = null;
    if (comparisonRange) {
      const previousCtx: MetricComputeContext = { db, organizationId: input.organizationId, workspaceId: input.workspaceId, from: comparisonRange.from, to: comparisonRange.to, actorUserId: input.actorUserId, groupBy: input.groupBy };
      previous = await handler.compute(previousCtx);
      // Comparison diff/percent is only computed for the single-value (ungrouped) case —
      // comparing grouped result sets across two periods with potentially different
      // dimension memberships would produce a misleading pairwise diff, so it is
      // deliberately left null (the raw `previous` result is still returned).
      if (current.points.length === 1 && previous.points.length === 1) {
        const currentValue = current.points[0].value;
        const previousValue = previous.points[0].value;
        const absoluteDiff = currentValue !== null && previousValue !== null ? Math.round((currentValue - previousValue) * 100) / 100 : null;
        comparison = { absoluteDiff, percentChange: computePercentChange(currentValue, previousValue) };
      }
    }

    let series: MetricSeriesPoint[] | null = null;
    if (input.includeSeries && handler.computeSeries && handler.definition.supportsTimeSeries) {
      series = await handler.computeSeries(currentCtx, timeGrain);
    }

    metrics.push({
      metricKey: handler.definition.metricKey,
      name: handler.definition.name,
      description: handler.definition.description,
      valueType: handler.definition.valueType,
      aggregationType: handler.definition.aggregationType,
      unit: handler.definition.unit,
      classification: handler.definition.classification,
      nullSemantics: handler.definition.nullSemantics,
      current,
      previous,
      comparison,
      series,
      freshness: current.freshness,
      asOf: current.asOf,
      sourceDomain: handler.definition.domain,
      sourceVersion: handler.definition.version,
    });
  }

  if (input.recordAudit !== false) {
    await recordAuditEvent(db, {
      eventType: "analytics_query_executed",
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      targetType: "analytics_query",
      targetId: null,
      metadata: { metricKeys: input.metricKeys, dateRangeStrategy: strategy, comparisonStrategy, groupBy: input.groupBy ?? null },
    });
  }

  return { organizationId: input.organizationId, workspaceId: input.workspaceId, range, comparisonRange, timeGrain, metrics };
}
