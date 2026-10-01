import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { requestEngagementSync } from "@/lib/social-os/engagement";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; accountId: string }> };

/** POST /api/organizations/{organizationId}/social/accounts/{accountId}/sync-engagement — queue an inbox sync for a connected account. */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, accountId: rawAccountId } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const accountId = parseUuidParam(rawAccountId);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const job = await requestEngagementSync(db, { organizationId, channelAccountId: accountId, actorUserId: user.userId });
    return jsonSuccess(job, 202);
  } catch (err) {
    return handleRouteError(err);
  }
}
