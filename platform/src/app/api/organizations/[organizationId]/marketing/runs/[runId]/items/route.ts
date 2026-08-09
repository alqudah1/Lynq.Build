import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { listCampaignRunItems, completeCampaignRunItem } from "@/lib/marketing-os/campaign-runs";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; runId: string }> };

const completeItemBodySchema = z.object({ itemId: z.string().uuid(), status: z.enum(["complete", "skipped"]), evidenceArtifactId: z.string().uuid().optional(), evidenceContentItemId: z.string().uuid().optional() }).strict();

/** GET /api/organizations/{organizationId}/marketing/runs/{runId}/items */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, runId: rawRun } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const runId = parseUuidParam(rawRun);
    const env = loadEnv();
    const db = createDbClient(env);
    await getAuthenticatedUser(db);

    const items = await listCampaignRunItems(db, organizationId, runId);
    return jsonSuccess({ items });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** PATCH /api/organizations/{organizationId}/marketing/runs/{runId}/items — completes/skips one run item. */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, completeItemBodySchema);
    const item = await completeCampaignRunItem(db, { organizationId, itemId: body.itemId, status: body.status, evidenceArtifactId: body.evidenceArtifactId, evidenceContentItemId: body.evidenceContentItemId, actorUserId: user.userId });
    return jsonSuccess(item);
  } catch (err) {
    return handleRouteError(err);
  }
}
