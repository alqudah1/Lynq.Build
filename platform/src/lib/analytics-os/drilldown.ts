import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { recordAuditEvent } from "@/lib/audit";
import { resolveAnalyticsAuthContext, requireAnalyticsViewAuthority, requireAnalyticsCapability } from "./authz";
import { resolveMetric } from "./metrics/registry";
import { DrilldownNotSupportedError } from "./errors";
import { DOMAIN_VIEW_CAPABILITY } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface AnalyticsDrilldownInput {
  organizationId: string;
  workspaceId: string | null;
  actorUserId: string;
  metricKey: string;
  from: Date;
  to: Date;
}

export interface AnalyticsDrilldownResult {
  metricKey: string;
  entityType: string;
  ids: string[];
  totalCount: number;
}

/**
 * ============================================================================
 * Drill-down dispatcher — Module 17
 * ============================================================================
 * Deliberately returns ONLY a bounded id list, never full records — that is
 * how "no PII unless the caller independently has the underlying module
 * permission" is actually enforced here: a caller who wants the real record
 * behind one of these ids must separately call that source module's own
 * real per-record read function (e.g. `getLeadForUser`), which carries its
 * own full record-level authorization end to end. This dispatcher's own
 * job is: (1) central `analytics_view` + `analytics_view_<domain>`
 * capability, (2) confirm the metric actually defines a `drilldown`, (3)
 * delegate to it — the metric's own `drilldown()` independently re-checks
 * its source module's aggregate-safe view authority, the same dual-gate
 * every metric's `compute()` already uses.
 */
export async function runAnalyticsDrilldown(db: Db, input: AnalyticsDrilldownInput): Promise<AnalyticsDrilldownResult> {
  const authCtx = await resolveAnalyticsAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireAnalyticsViewAuthority(db, authCtx, "analytics_drilldown", input.metricKey);

  const handler = resolveMetric(input.metricKey);
  await requireAnalyticsCapability(db, authCtx, DOMAIN_VIEW_CAPABILITY[handler.definition.domain], "analytics_drilldown", input.metricKey);

  if (!handler.drilldown) throw new DrilldownNotSupportedError(input.metricKey);

  const result = await handler.drilldown({ db, organizationId: input.organizationId, workspaceId: input.workspaceId, from: input.from, to: input.to, actorUserId: input.actorUserId });

  await recordAuditEvent(db, {
    eventType: "analytics_drilldown_accessed",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    targetType: "analytics_metric",
    targetId: null,
    metadata: { metricKey: input.metricKey, entityType: result.entityType, totalCount: result.totalCount },
  });

  return { metricKey: input.metricKey, entityType: result.entityType, ids: result.ids, totalCount: result.totalCount };
}
