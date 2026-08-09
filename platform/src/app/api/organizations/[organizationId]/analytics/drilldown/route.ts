import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { runAnalyticsDrilldown } from "@/lib/analytics-os/drilldown";
import { resolveDateRangeForStrategy } from "@/lib/analytics-os/time";
import { resolveEffectiveAnalyticsConfiguration } from "@/lib/analytics-os/configuration";
import { ANALYTICS_DATE_RANGE_STRATEGIES } from "@/lib/analytics-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const querySchema = z.object({
  metricKey: z.string().min(1),
  workspaceId: z.string().uuid().optional(),
  dateRangeStrategy: z.enum(ANALYTICS_DATE_RANGE_STRATEGIES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/**
 * GET /api/organizations/{organizationId}/analytics/drilldown?metricKey=&...
 * Returns a bounded id list only — never full records. A caller who wants
 * the actual record behind one of these ids calls that source module's
 * own real read endpoint, which carries its own full record-level
 * authorization.
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const parsed = querySchema.parse(Object.fromEntries(url.searchParams));

    const config = await resolveEffectiveAnalyticsConfiguration(db, { organizationId, workspaceId: parsed.workspaceId ?? null, actorUserId: user.userId });
    const strategy = parsed.dateRangeStrategy ?? config.defaultDateRangeStrategy;
    const range = resolveDateRangeForStrategy(strategy, config.businessTimezone, parsed.from && parsed.to ? { from: parsed.from, to: parsed.to } : null);

    const result = await runAnalyticsDrilldown(db, {
      organizationId,
      workspaceId: parsed.workspaceId ?? null,
      actorUserId: user.userId,
      metricKey: parsed.metricKey,
      from: range.from,
      to: range.to,
    });
    return jsonSuccess(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
