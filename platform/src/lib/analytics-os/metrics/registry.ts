import "server-only";
import { isKnownDimension } from "../dimensions";
import { UnknownMetricError, UnsupportedDimensionError, UnsupportedTimeGrainError } from "../errors";
import type { AnalyticsTimeGrain } from "../validation";
import { CRM_METRICS } from "./crm";
import { SALES_METRICS } from "./sales";
import { MARKETING_METRICS } from "./marketing";
import { COMMUNICATIONS_METRICS } from "./communications";
import { PROJECTS_METRICS } from "./projects";
import { WORKFLOW_METRICS } from "./workflows";
import { AGENTS_METRICS } from "./agents";
import type { MetricHandler } from "./types";

/**
 * ============================================================================
 * Central metric registry — Module 17
 * ============================================================================
 * Aggregates every domain's own metric file into one lookup keyed by
 * `metricKey`. This is the ONLY place the query engine, KPI layer, and
 * funnels are allowed to resolve a metric key from — nothing outside this
 * module ever imports a domain metric file directly, so every access path
 * is forced through `resolveMetric`'s own validation.
 */
const ALL_METRICS: MetricHandler[] = [...CRM_METRICS, ...SALES_METRICS, ...MARKETING_METRICS, ...COMMUNICATIONS_METRICS, ...PROJECTS_METRICS, ...WORKFLOW_METRICS, ...AGENTS_METRICS];

const METRIC_REGISTRY: Map<string, MetricHandler> = new Map(ALL_METRICS.map((handler) => [handler.definition.metricKey, handler]));

if (METRIC_REGISTRY.size !== ALL_METRICS.length) {
  throw new Error("Duplicate metricKey detected across analytics-os metric domain files.");
}

export function resolveMetric(metricKey: string): MetricHandler {
  const handler = METRIC_REGISTRY.get(metricKey);
  if (!handler) throw new UnknownMetricError(metricKey);
  return handler;
}

export function listMetrics(): MetricHandler[] {
  return Array.from(METRIC_REGISTRY.values());
}

export function listMetricsForDomain(domain: string): MetricHandler[] {
  return listMetrics().filter((handler) => handler.definition.domain === domain);
}

/** Validates a groupBy dimension against BOTH the global dimension registry and this specific metric's own declared allow-list. */
export function assertMetricSupportsDimension(handler: MetricHandler, dimensionKey: string): void {
  if (!isKnownDimension(dimensionKey) || !handler.definition.supportedDimensions.includes(dimensionKey)) {
    throw new UnsupportedDimensionError(handler.definition.metricKey, dimensionKey);
  }
}

export function assertMetricSupportsTimeGrain(handler: MetricHandler, grain: AnalyticsTimeGrain): void {
  if (!handler.definition.supportsTimeSeries || !handler.definition.supportedTimeGrains.includes(grain)) {
    throw new UnsupportedTimeGrainError(handler.definition.metricKey, grain);
  }
}
