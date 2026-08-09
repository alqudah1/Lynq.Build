import "server-only";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { runAnalyticsQuery, type AnalyticsQueryResult } from "./query";
import { listMetricsForDomain } from "./metrics/registry";
import type { AnalyticsDomain } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/** Shared loader for every `/analytics/<domain>` page — every metric REGISTERED for the domain, queried through the identical bounded `runAnalyticsQuery` contract every other caller uses (no page-specific query path). */
export async function loadDomainAnalyticsPage(db: Db, input: { organizationId: string; workspaceId: string | null; actorUserId: string; domain: AnalyticsDomain }): Promise<AnalyticsQueryResult> {
  const metricKeys = listMetricsForDomain(input.domain).map((h) => h.definition.metricKey);
  return runAnalyticsQuery(db, {
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    metricKeys,
    comparisonStrategy: "previous_period",
  });
}
