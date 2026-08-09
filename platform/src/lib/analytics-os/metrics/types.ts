import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { AnalyticsDomain, AnalyticsTimeGrain } from "../validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export type MetricValueType = "count" | "currency" | "percentage" | "duration_seconds" | "ratio";
export type MetricAggregationType = "count" | "sum" | "avg" | "ratio";
/** "actual" = a real recorded fact. "derived" = computed from real facts (e.g. a rate). "estimated" = a labeled projection (e.g. weighted pipeline) — never presented as actual. "manual" = human-entered, never provider-verified (e.g. manual marketing spend). */
export type MetricClassification = "actual" | "derived" | "estimated" | "manual";
export type MetricFreshness = "live" | "near_real_time" | "scheduled_snapshot" | "manual";

export interface MetricDefinition {
  metricKey: string;
  name: string;
  description: string;
  domain: AnalyticsDomain;
  valueType: MetricValueType;
  aggregationType: MetricAggregationType;
  unit: string | null;
  classification: MetricClassification;
  supportsTimeSeries: boolean;
  supportedTimeGrains: AnalyticsTimeGrain[];
  /** Dimension keys (from the dimension registry) this metric may be grouped by — a closed, per-metric allow-list, never an arbitrary column. */
  supportedDimensions: string[];
  version: number;
  /** What a null or zero result means for THIS metric — always non-empty, since "no data yet" and "genuinely zero" must never be visually indistinguishable without explanation. */
  nullSemantics: string;
}

export interface MetricComputeContext {
  db: Db;
  organizationId: string;
  workspaceId: string | null;
  from: Date;
  to: Date;
  actorUserId: string;
  groupBy?: string;
}

export interface MetricPointValue {
  value: number | null;
  dimensionValue?: string;
  dimensionLabel?: string;
}

export interface MetricComputeResult {
  points: MetricPointValue[];
  freshness: MetricFreshness;
  asOf: Date;
}

export interface MetricSeriesPoint {
  bucketStart: string;
  value: number | null;
}

export interface MetricHandler {
  definition: MetricDefinition;
  compute(ctx: MetricComputeContext): Promise<MetricComputeResult>;
  computeSeries?: (ctx: MetricComputeContext, grain: AnalyticsTimeGrain) => Promise<MetricSeriesPoint[]>;
  /** Present only for metrics with a real, bounded drill-down target — resolves the id list (never full records) behind this metric's current value, for a caller who separately holds the source module's own record-level authority. */
  drilldown?: (ctx: MetricComputeContext) => Promise<{ entityType: string; ids: string[]; totalCount: number }>;
}
