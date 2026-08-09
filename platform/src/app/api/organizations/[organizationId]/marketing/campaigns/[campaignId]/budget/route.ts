import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { createBudgetEntry, listBudgetEntriesForCampaign } from "@/lib/marketing-os/budget";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; campaignId: string }> };

const createBudgetEntryBodySchema = z
  .object({
    category: z.string().trim().min(1).max(100).optional(),
    plannedAmount: z.number().nonnegative().nullable().optional(),
    spendAmount: z.number().nonnegative().nullable().optional(),
    currency: z.string().trim().length(3).toUpperCase(),
  })
  .strict();

/** GET /api/organizations/{organizationId}/marketing/campaigns/{campaignId}/budget */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, campaignId: rawCampaign } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const campaignId = parseUuidParam(rawCampaign);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const entries = await listBudgetEntriesForCampaign(db, { organizationId, campaignId, actorUserId: user.userId });
    return jsonSuccess({ entries });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/marketing/campaigns/{campaignId}/budget */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, campaignId: rawCampaign } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const campaignId = parseUuidParam(rawCampaign);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createBudgetEntryBodySchema);
    const entry = await createBudgetEntry(db, { organizationId, campaignId, actorUserId: user.userId, ...body });
    return jsonSuccess(entry, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
