import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { archiveAccount } from "@/lib/social-os/connections";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; accountId: string }> };

const archiveBodySchema = z.object({ expectedRevision: z.number().int().min(1) }).strict();

/** POST /api/organizations/{organizationId}/social/accounts/{accountId}/archive */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, accountId: rawAccount } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const channelAccountId = parseUuidParam(rawAccount);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, archiveBodySchema);
    const account = await archiveAccount(db, { organizationId, channelAccountId, actorUserId: user.userId, expectedRevision: body.expectedRevision });
    return jsonSuccess(account);
  } catch (err) {
    return handleRouteError(err);
  }
}
