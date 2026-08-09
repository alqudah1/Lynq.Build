import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { startCampaignRun, listCampaignRunsForCampaign } from "@/lib/marketing-os/campaign-runs";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; campaignId: string }> };

const startRunBodySchema = z.object({ playbookVersionId: z.string().uuid(), ownerUserId: z.string().uuid().nullable().optional() }).strict();

/** GET /api/organizations/{organizationId}/marketing/campaigns/{campaignId}/runs */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, campaignId: rawCampaign } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const campaignId = parseUuidParam(rawCampaign);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const runs = await listCampaignRunsForCampaign(db, { organizationId, campaignId, actorUserId: user.userId });
    return jsonSuccess({ runs });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/marketing/campaigns/{campaignId}/runs */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, campaignId: rawCampaign } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const campaignId = parseUuidParam(rawCampaign);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, startRunBodySchema);
    const result = await startCampaignRun(db, { organizationId, campaignId, actorUserId: user.userId, ...body });
    return jsonSuccess(result, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
