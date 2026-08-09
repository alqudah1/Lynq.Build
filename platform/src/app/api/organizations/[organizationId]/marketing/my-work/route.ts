import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { getMarketingWorkQueueForUser } from "@/lib/marketing-os/work-queue";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

/** GET /api/organizations/{organizationId}/marketing/my-work */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const forUserId = url.searchParams.get("forUserId") ?? user.userId;

    const queue = await getMarketingWorkQueueForUser(db, { organizationId, forUserId, actorUserId: user.userId });
    return jsonSuccess(queue);
  } catch (err) {
    return handleRouteError(err);
  }
}
