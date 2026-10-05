import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { archiveContentItem } from "@/lib/social-os/content";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; contentItemId: string }> };

const archiveBodySchema = z.object({ expectedRevision: z.number().int().min(1) }).strict();

/** POST /api/organizations/{organizationId}/social/content/{contentItemId}/archive — archives the item and every variant; queued publishes are cancelled. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, contentItemId: rawItem } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const contentItemId = parseUuidParam(rawItem);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, archiveBodySchema);
    const item = await archiveContentItem(db, { organizationId, contentItemId, actorUserId: user.userId, expectedRevision: body.expectedRevision });
    return jsonSuccess(item);
  } catch (err) {
    return handleRouteError(err);
  }
}
