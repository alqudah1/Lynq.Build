import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { completeCampaignRun } from "@/lib/marketing-os/campaign-runs";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; runId: string }> };

const completeBodySchema = z.object({ expectedRevision: z.number().int().min(1) }).strict();

/** POST /api/organizations/{organizationId}/marketing/runs/{runId}/complete */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, runId: rawRun } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const runId = parseUuidParam(rawRun);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, completeBodySchema);
    const run = await completeCampaignRun(db, { organizationId, runId, actorUserId: user.userId, ...body });
    return jsonSuccess(run);
  } catch (err) {
    return handleRouteError(err);
  }
}
