import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { createDraftReplyTask } from "@/lib/communications-os/agents";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };
const bodySchema = z.object({ conversationId: z.string().uuid() }).strict();

/** POST /api/organizations/{organizationId}/communications/agents/draft-reply — direct-launch the Communications Assistant's reply-drafting task (also reachable generically through Tool Runtime's communications.create_draft tool from within a workflow). */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, bodySchema);
    const result = await createDraftReplyTask(db, { organizationId, conversationId: body.conversationId, actorUserId: user.userId });
    return jsonSuccess(result, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
