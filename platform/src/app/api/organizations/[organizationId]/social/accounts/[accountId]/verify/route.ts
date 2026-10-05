import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { verifyAccount } from "@/lib/social-os/connections";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; accountId: string }> };

/** POST /api/organizations/{organizationId}/social/accounts/{accountId}/verify — re-checks the authorization with the provider. */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, accountId: rawAccount } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const channelAccountId = parseUuidParam(rawAccount);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const account = await verifyAccount(db, { organizationId, channelAccountId, actorUserId: user.userId });
    return jsonSuccess(account);
  } catch (err) {
    return handleRouteError(err);
  }
}
