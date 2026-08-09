import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { createCampaignBriefTask } from "@/lib/marketing-os/agents";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; campaignId: string }> };

/** POST /api/organizations/{organizationId}/marketing/campaigns/{campaignId}/brief — direct-launch the Campaign Brief Assistant (also reachable generically via a workflow's agent_execution node). */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, campaignId: rawCampaign } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const campaignId = parseUuidParam(rawCampaign);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const result = await createCampaignBriefTask(db, { organizationId, campaignId, actorUserId: user.userId });
    return jsonSuccess(result, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
