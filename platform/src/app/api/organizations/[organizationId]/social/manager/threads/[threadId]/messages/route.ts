import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { sendManagerMessage } from "@/lib/social-os/manager";

export const dynamic = "force-dynamic";
// A manager turn runs a bounded tool loop (≤ 8 model calls) and may generate drafts.
export const maxDuration = 300;

type RouteParams = { params: Promise<{ organizationId: string; threadId: string }> };

const bodySchema = z.object({ content: z.string().trim().min(1).max(8000) }).strict();

/** POST /api/organizations/{organizationId}/social/manager/threads/{threadId}/messages { content } — runs one manager turn and returns the updated thread. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, threadId: rawThread } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const threadId = parseUuidParam(rawThread);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, bodySchema);
    const thread = await sendManagerMessage(db, { organizationId, threadId, actorUserId: user.userId, content: body.content });
    return jsonSuccess(thread, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
