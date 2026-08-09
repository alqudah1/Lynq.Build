import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { getConversationForUser } from "@/lib/communications-os/conversations";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; conversationId: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, conversationId: rawConv } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const conversationId = parseUuidParam(rawConv);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const conversation = await getConversationForUser(db, { organizationId, conversationId, actorUserId: user.userId });
    return jsonSuccess(conversation);
  } catch (err) {
    return handleRouteError(err);
  }
}
