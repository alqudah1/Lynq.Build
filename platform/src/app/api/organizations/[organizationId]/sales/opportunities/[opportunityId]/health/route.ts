import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { computeOpportunityHealth } from "@/lib/sales-os/health";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; opportunityId: string }> };

/** GET /api/organizations/{organizationId}/sales/opportunities/{opportunityId}/health — deterministic, reason-coded, never a probability. */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, opportunityId: rawOpp } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const opportunityId = parseUuidParam(rawOpp);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const health = await computeOpportunityHealth(db, { organizationId, opportunityId, actorUserId: user.userId });
    return jsonSuccess(health);
  } catch (err) {
    return handleRouteError(err);
  }
}
