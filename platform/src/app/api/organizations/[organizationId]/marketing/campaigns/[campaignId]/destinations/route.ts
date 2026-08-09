import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { createDestination, listDestinationsForCampaign } from "@/lib/marketing-os/destinations";
import { marketingDestinationTypeSchema } from "@/lib/marketing-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; campaignId: string }> };

const createDestinationBodySchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    url: z.string().trim().url().max(2000),
    destinationType: marketingDestinationTypeSchema.optional(),
    utmSource: z.string().trim().min(1).max(100),
    utmMedium: z.string().trim().min(1).max(100),
    utmCampaign: z.string().trim().min(1).max(100),
    utmContent: z.string().trim().max(100).optional(),
    utmTerm: z.string().trim().max(100).optional(),
  })
  .strict();

/** GET /api/organizations/{organizationId}/marketing/campaigns/{campaignId}/destinations */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, campaignId: rawCampaign } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const campaignId = parseUuidParam(rawCampaign);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const destinations = await listDestinationsForCampaign(db, { organizationId, campaignId, actorUserId: user.userId });
    return jsonSuccess({ destinations });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/marketing/campaigns/{campaignId}/destinations */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, campaignId: rawCampaign } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const campaignId = parseUuidParam(rawCampaign);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createDestinationBodySchema);
    const destination = await createDestination(db, { organizationId, campaignId, actorUserId: user.userId, ...body });
    return jsonSuccess(destination, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
