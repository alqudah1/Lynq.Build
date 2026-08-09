import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { recordAuditEvent } from "@/lib/audit";
import { runAnalyticsQuery, type AnalyticsQueryInput } from "./query";

type Db = NeonHttpDatabase<Record<string, unknown>>;

const CSV_HEADER = ["metric_key", "metric_name", "dimension", "value", "previous_value", "percent_change", "unit", "classification", "freshness"] as const;

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * ============================================================================
 * CSV export foundation — Module 17
 * ============================================================================
 * Same authorization as the underlying query (goes through the identical
 * `runAnalyticsQuery` bounded contract — no separate, weaker export path).
 * No PDF yet, no arbitrary formatting — one flat, bounded CSV. Logs
 * `analytics_export_created` with bounded metadata only (metric keys and
 * row count) — never the exported values themselves in the audit record.
 */
export async function exportAnalyticsQueryToCsv(db: Db, input: AnalyticsQueryInput): Promise<{ csv: string; rowCount: number }> {
  const result = await runAnalyticsQuery(db, { ...input, recordAudit: false });

  const lines: string[] = [CSV_HEADER.join(",")];
  let rowCount = 0;

  for (const metric of result.metrics) {
    for (const point of metric.current.points) {
      const previousPoint = metric.previous?.points.length === 1 ? metric.previous.points[0] : metric.previous?.points.find((p) => p.dimensionValue === point.dimensionValue);
      const percentChange = metric.current.points.length === 1 ? metric.comparison?.percentChange ?? null : null;
      lines.push(
        [
          csvCell(metric.metricKey),
          csvCell(metric.name),
          csvCell(point.dimensionLabel ?? ""),
          csvCell(point.value),
          csvCell(previousPoint?.value ?? null),
          csvCell(percentChange),
          csvCell(metric.unit),
          csvCell(metric.classification),
          csvCell(metric.freshness),
        ].join(",")
      );
      rowCount++;
    }
  }

  await recordAuditEvent(db, {
    eventType: "analytics_export_created",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    targetType: "analytics_export",
    targetId: null,
    metadata: { metricKeys: input.metricKeys, rowCount },
  });

  return { csv: lines.join("\n"), rowCount };
}
