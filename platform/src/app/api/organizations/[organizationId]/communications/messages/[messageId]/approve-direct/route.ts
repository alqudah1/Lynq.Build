import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { approveDraftDirectly } from "@/lib/communications-os/messages";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; messageId: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, messageId: rawMsg } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const messageId = parseUuidParam(rawMsg);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const message = await approveDraftDirectly(db, { organizationId, messageId, actorUserId: user.userId });
    return jsonSuccess(message);
  } catch (err) {
    return handleRouteError(err);
  }
}
