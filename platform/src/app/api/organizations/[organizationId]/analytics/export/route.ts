import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { exportAnalyticsQueryToCsv } from "@/lib/analytics-os/export";
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
  timeGrain: z.enum(ANALYTICS_TIME_GRAINS).optional(),
  groupBy: z.string().optional(),
});

/** GET /api/organizations/{organizationId}/analytics/export?metricKeys=a,b,c&... — same authorization as `/analytics/query`, bounded CSV only. */
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

    const { csv } = await exportAnalyticsQueryToCsv(db, {
      organizationId,
      workspaceId: parsed.workspaceId ?? null,
      actorUserId: user.userId,
      metricKeys,
      dateRangeStrategy: parsed.dateRangeStrategy,
      customFrom: parsed.from,
      customTo: parsed.to,
      comparisonStrategy: parsed.comparisonStrategy,
      timeGrain: parsed.timeGrain,
      groupBy: parsed.groupBy,
    });

    return new Response(csv, {
      status: 200,
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="analytics-export.csv"` },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
