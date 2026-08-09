import type { MetricValueType } from "./metrics/types";

/** Shared value formatting for the Analytics UI — every place a metric value renders goes through this, so "0" vs "no data yet" (see each metric's own `nullSemantics`) never looks the same on screen. */
export function formatMetricValue(value: number | null, valueType: MetricValueType, unit: string | null): string {
  if (value === null) return "—";
  switch (valueType) {
    case "currency":
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
    case "percentage":
      return `${value.toFixed(1)}%`;
    case "duration_seconds": {
      if (value < 60) return `${Math.round(value)}s`;
      if (value < 3600) return `${Math.round(value / 60)}m`;
      return `${(value / 3600).toFixed(1)}h`;
    }
    case "ratio":
      return value.toFixed(2);
    case "count":
    default:
      return `${new Intl.NumberFormat("en-US").format(value)}${unit ? ` ${unit}` : ""}`;
  }
}

export function formatPercentChange(percentChange: number | null): string {
  if (percentChange === null) return "—";
  const sign = percentChange > 0 ? "+" : "";
  return `${sign}${percentChange.toFixed(1)}%`;
}
