import { Card } from "@/components/ui/Card";
import { formatMetricValue } from "@/lib/analytics-os/format";
import type { AnalyticsMetricResult } from "@/lib/analytics-os/query";

/** An accessible, real HTML table for a grouped (dimension-bucketed) metric result — the text/table equivalent every chart in this module also has, never a chart-only presentation. */
export function MetricTable({ metric }: { metric: AnalyticsMetricResult }) {
  if (metric.current.points.length <= 1) return null;
  return (
    <Card padding="sm" className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="mb-2 text-left text-xs uppercase tracking-[0.15em] text-subtle">{metric.name} by group</caption>
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-[0.1em] text-subtle">
            <th scope="col" className="py-2 pr-4">Group</th>
            <th scope="col" className="py-2">Value</th>
          </tr>
        </thead>
        <tbody>
          {metric.current.points.map((point, idx) => (
            <tr key={`${point.dimensionValue ?? idx}`} className="border-b border-border/60 last:border-0">
              <td className="py-2 pr-4 text-foreground">{point.dimensionLabel ?? point.dimensionValue ?? "—"}</td>
              <td className="py-2 text-muted">{formatMetricValue(point.value, metric.valueType, metric.unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
