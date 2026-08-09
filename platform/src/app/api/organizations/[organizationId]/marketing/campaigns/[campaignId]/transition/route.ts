import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { transitionCampaignStatus } from "@/lib/marketing-os/campaigns";
import { marketingCampaignStatusSchema } from "@/lib/marketing-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; campaignId: string }> };

const transitionBodySchema = z.object({ toStatus: marketingCampaignStatusSchema, expectedRevision: z.number().int().min(1) }).strict();

/** POST /api/organizations/{organizationId}/marketing/campaigns/{campaignId}/transition */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, campaignId: rawCampaign } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const campaignId = parseUuidParam(rawCampaign);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, transitionBodySchema);
    const campaign = await transitionCampaignStatus(db, { organizationId, campaignId, actorUserId: user.userId, ...body });
    return jsonSuccess(campaign);
  } catch (err) {
    return handleRouteError(err);
  }
}
