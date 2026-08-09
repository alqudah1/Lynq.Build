import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { runAnalyticsQuery } from "@/lib/analytics-os/query";
import { ANALYTICS_DATE_RANGE_STRATEGIES, ANALYTICS_TIME_GRAINS } from "@/lib/analytics-os/validation";
import { COMPARISON_STRATEGIES } from "@/lib/analytics-os/time";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const querySchema = z.object({
  metricKeys: z.string().min(1),
  workspaceId: z.string().uuid().optional(),
  dateRangeStrategy: z.enum(ANALYTICS_DATE_RANGE_STRATEGIES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  comparisonStrategy: z.enum(COMPARISON_STRATEGIES).optional(),
  comparisonFrom: z.coerce.date().optional(),
  comparisonTo: z.coerce.date().optional(),
  timeGrain: z.enum(ANALYTICS_TIME_GRAINS).optional(),
  groupBy: z.string().optional(),
  includeSeries: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

/** GET /api/organizations/{organizationId}/analytics/query?metricKeys=a,b,c&... — the one bounded read path for every metric value; see `runAnalyticsQuery`'s own module comment for the exact authorization order. */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const parsed = querySchema.parse(Object.fromEntries(url.searchParams));
    const metricKeys = parsed.metricKeys.split(",").map((k) => k.trim()).filter(Boolean);

    const result = await runAnalyticsQuery(db, {
      organizationId,
      workspaceId: parsed.workspaceId ?? null,
      actorUserId: user.userId,
      metricKeys,
      dateRangeStrategy: parsed.dateRangeStrategy,
      customFrom: parsed.from,
      customTo: parsed.to,
      comparisonStrategy: parsed.comparisonStrategy,
      customComparisonFrom: parsed.comparisonFrom,
      customComparisonTo: parsed.comparisonTo,
      timeGrain: parsed.timeGrain,
      groupBy: parsed.groupBy,
      includeSeries: parsed.includeSeries,
    });
    return jsonSuccess(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
