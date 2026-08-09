import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { computeCampaignHealth } from "@/lib/marketing-os/health";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; campaignId: string }> };

/** GET /api/organizations/{organizationId}/marketing/campaigns/{campaignId}/health */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, campaignId: rawCampaign } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const campaignId = parseUuidParam(rawCampaign);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const health = await computeCampaignHealth(db, { organizationId, campaignId, actorUserId: user.userId });
    return jsonSuccess(health);
  } catch (err) {
    return handleRouteError(err);
  }
}
