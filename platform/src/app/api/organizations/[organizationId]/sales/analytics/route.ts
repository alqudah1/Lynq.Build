import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { computeSalesAnalytics } from "@/lib/sales-os/analytics";
import { resolveEffectiveSalesConfiguration } from "@/lib/sales-os/configuration";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

/** GET /api/organizations/{organizationId}/sales/analytics — deterministic operational summaries only, never the org-wide Analytics OS. */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const config = await resolveEffectiveSalesConfiguration(db, organizationId, null);
    const analytics = await computeSalesAnalytics(db, { organizationId, staleOpportunityThresholdDays: config.staleOpportunityThresholdDays, actorUserId: user.userId });
    return jsonSuccess(analytics);
  } catch (err) {
    return handleRouteError(err);
  }
}
