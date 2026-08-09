import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { resolveAnalyticsAuthContext, requireAnalyticsViewAuthority } from "@/lib/analytics-os/authz";
import { listDimensions } from "@/lib/analytics-os/dimensions";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

/** GET /api/organizations/{organizationId}/analytics/dimensions — the closed dimension vocabulary a query/report may group by. */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const ctx = await resolveAnalyticsAuthContext(db, { organizationId, actorUserId: user.userId });
    await requireAnalyticsViewAuthority(db, ctx, "analytics_dimension_catalog", organizationId);

    return jsonSuccess({ dimensions: listDimensions() });
  } catch (err) {
    return handleRouteError(err);
  }
}
