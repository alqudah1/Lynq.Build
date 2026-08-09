import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { recordAuditEvent } from "@/lib/audit";
import { runAnalyticsQuery, type AnalyticsMetricResult } from "./query";
import { resolveMetric } from "./metrics/registry";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * ============================================================================
 * Executive KPI foundation — Module 17
 * ============================================================================
 * A fixed, curated set of already-registered metric keys grouped for an
 * executive-facing overview — reusable query CONTRACTS only, not a UI.
 * Every key here must already exist in the metric registry (validated at
 * module load) — this file adds no new computation of its own, it only
 * groups and reuses `runAnalyticsQuery`.
 */
export const KPI_GROUPS: Record<string, string[]> = {
  growth: ["crm_leads_open", "marketing_campaign_sourced_leads", "sales_qualification_conversion_rate"],
  sales: ["sales_pipeline_weighted_value", "crm_opportunities_open", "crm_won_value", "sales_opportunities_at_risk"],
  marketing: ["marketing_campaigns_active", "marketing_campaign_qualified_leads", "marketing_manual_spend"],
  delivery: ["projects_active", "projects_blocked", "project_completion_rate"],
  operations: ["workflows_running", "workflows_failed", "workflow_completion_rate"],
  communications: ["communications_messages_sent", "communications_delivery_rate", "communications_messages_failed"],
  ai: ["agent_executions_running", "agent_success_rate", "approvals_pending"],
};

// Fail fast at module load if a KPI group ever drifts from the registry (e.g. a metric renamed) rather than surfacing an UnknownMetricError deep inside a live request.
for (const keys of Object.values(KPI_GROUPS)) {
  for (const key of keys) resolveMetric(key);
}

export interface ExecutiveKpiGroup {
  group: string;
  metrics: AnalyticsMetricResult[];
}

export interface ExecutiveKpiInput {
  organizationId: string;
  workspaceId: string | null;
  actorUserId: string;
  dateRangeStrategy?: Parameters<typeof runAnalyticsQuery>[1]["dateRangeStrategy"];
  comparisonStrategy?: Parameters<typeof runAnalyticsQuery>[1]["comparisonStrategy"];
  recordAudit?: boolean;
}

/**
 * Runs one query PER METRIC (not per group) — several groups (e.g. "growth")
 * deliberately mix domains, so a single missing domain capability must only
 * drop that one metric, never the whole group. A caller lacking a domain's
 * capability for a given metric simply doesn't see that metric (its own
 * gate already recorded its own `analytics_permission_denied` event) — an
 * empty group is omitted entirely rather than shown blank.
 *
 * One aggregate `analytics_query_executed` audit event covers the whole
 * KPI overview (naming every metric that actually succeeded), instead of
 * one event per metric — deliberate audit-noise control for a page that
 * legitimately fires many small queries on every load.
 */
export async function computeExecutiveKpis(db: Db, input: ExecutiveKpiInput): Promise<ExecutiveKpiGroup[]> {
  const groups: ExecutiveKpiGroup[] = [];
  const succeededMetricKeys: string[] = [];

  for (const [group, metricKeys] of Object.entries(KPI_GROUPS)) {
    const metrics: AnalyticsMetricResult[] = [];
    for (const metricKey of metricKeys) {
      try {
        const result = await runAnalyticsQuery(db, {
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          actorUserId: input.actorUserId,
          metricKeys: [metricKey],
          dateRangeStrategy: input.dateRangeStrategy,
          comparisonStrategy: input.comparisonStrategy,
          recordAudit: false,
        });
        metrics.push(...result.metrics);
        succeededMetricKeys.push(metricKey);
      } catch {
        continue;
      }
    }
    if (metrics.length > 0) groups.push({ group, metrics });
  }

  if (input.recordAudit !== false && succeededMetricKeys.length > 0) {
    await recordAuditEvent(db, {
      eventType: "analytics_query_executed",
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      targetType: "analytics_kpi_overview",
      targetId: null,
      metadata: { metricKeys: succeededMetricKeys },
    });
  }

  return groups;
}
