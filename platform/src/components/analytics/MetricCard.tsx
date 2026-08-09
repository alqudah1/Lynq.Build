import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { formatMetricValue, formatPercentChange } from "@/lib/analytics-os/format";
import type { AnalyticsMetricResult } from "@/lib/analytics-os/query";

const CLASSIFICATION_TONE: Record<string, BadgeTone> = { actual: "success", derived: "info", estimated: "warning", manual: "neutral" };

/**
 * A single ungrouped (or first-point) metric as a KPI card — always shows
 * the metric's own `classification` badge so "actual" vs "estimated" vs
 * "manual" is never visually indistinguishable, and the `nullSemantics`
 * text as an accessible caption so "0" and "no data yet" read differently
 * even without color. Comparison change is text, not a color-only arrow.
 */
export function MetricCard({ metric, href }: { metric: AnalyticsMetricResult; href?: string }) {
  const point = metric.current.points[0];
  const value = point ? point.value : null;
  const isGrouped = metric.current.points.length > 1;

  const body = (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs uppercase tracking-[0.15em] text-subtle">{metric.name}</p>
        <Badge tone={CLASSIFICATION_TONE[metric.classification] ?? "neutral"}>{metric.classification}</Badge>
      </div>
      {isGrouped ? (
        <p className="text-sm text-muted">{metric.current.points.length} groups — see table below</p>
      ) : (
        <p className="font-serif text-3xl italic font-light text-foreground">{formatMetricValue(value, metric.valueType, metric.unit)}</p>
      )}
      {metric.comparison ? (
        <p className="text-xs text-subtle">
          vs. previous period: <span className={metric.comparison.percentChange !== null && metric.comparison.percentChange < 0 ? "text-danger" : "text-foreground"}>{formatPercentChange(metric.comparison.percentChange)}</span>
        </p>
      ) : null}
      <p className="text-[0.7rem] text-subtle">{value === null ? metric.nullSemantics : metric.description}</p>
    </div>
  );

  return href ? (
    <Card as="a" href={href} interactive padding="md">
      {body}
    </Card>
  ) : (
    <Card padding="md">{body}</Card>
  );
}
