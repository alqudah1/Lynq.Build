import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { resolveAnalyticsAuthContext, requireAnalyticsViewAuthority } from "@/lib/analytics-os/authz";
import { listMetrics, listMetricsForDomain } from "@/lib/analytics-os/metrics/registry";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

/** GET /api/organizations/{organizationId}/analytics/metrics?domain= — the registered metric catalog (definitions only, never a value) for building a query/report UI. */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const ctx = await resolveAnalyticsAuthContext(db, { organizationId, actorUserId: user.userId });
    await requireAnalyticsViewAuthority(db, ctx, "analytics_metric_catalog", organizationId);

    const url = new URL(request.url);
    const domain = url.searchParams.get("domain");
    const handlers = domain ? listMetricsForDomain(domain) : listMetrics();
    return jsonSuccess({ metrics: handlers.map((h) => h.definition) });
  } catch (err) {
    return handleRouteError(err);
  }
}
