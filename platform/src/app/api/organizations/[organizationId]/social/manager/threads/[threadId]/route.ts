import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { getManagerThread } from "@/lib/social-os/manager";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; threadId: string }> };

/** GET /api/organizations/{organizationId}/social/manager/threads/{threadId} — the thread with its messages (owner only). */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, threadId: rawThread } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const threadId = parseUuidParam(rawThread);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const thread = await getManagerThread(db, { organizationId, threadId, actorUserId: user.userId });
    return jsonSuccess(thread);
  } catch (err) {
    return handleRouteError(err);
  }
}
