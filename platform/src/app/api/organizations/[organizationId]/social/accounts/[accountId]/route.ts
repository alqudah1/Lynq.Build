import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { getAccountForUser, updateAccount, socialAccountUpdateSchema } from "@/lib/social-os/connections";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; accountId: string }> };

const updateAccountBodySchema = z.object({ expectedRevision: z.number().int().min(1), changes: socialAccountUpdateSchema }).strict();

/** GET /api/organizations/{organizationId}/social/accounts/{accountId} */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, accountId: rawAccount } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const channelAccountId = parseUuidParam(rawAccount);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const account = await getAccountForUser(db, { organizationId, channelAccountId, actorUserId: user.userId });
    return jsonSuccess(account);
  } catch (err) {
    return handleRouteError(err);
  }
}

/** PATCH /api/organizations/{organizationId}/social/accounts/{accountId} */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, accountId: rawAccount } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const channelAccountId = parseUuidParam(rawAccount);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, updateAccountBodySchema);
    const account = await updateAccount(db, { organizationId, channelAccountId, actorUserId: user.userId, expectedRevision: body.expectedRevision, changes: body.changes });
    return jsonSuccess(account);
  } catch (err) {
    return handleRouteError(err);
  }
}
