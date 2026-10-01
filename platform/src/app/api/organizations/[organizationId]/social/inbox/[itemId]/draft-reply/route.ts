import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { draftReply } from "@/lib/social-os/engagement";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; itemId: string }> };

/** POST /api/organizations/{organizationId}/social/inbox/{itemId}/draft-reply — AI-suggested reply (never sent). */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, itemId: rawItemId } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const itemId = parseUuidParam(rawItemId);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const item = await draftReply(db, { organizationId, engagementItemId: itemId, actorUserId: user.userId });
    return jsonSuccess(item);
  } catch (err) {
    return handleRouteError(err);
  }
}
