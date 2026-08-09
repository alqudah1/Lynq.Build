import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { createDraftFollowUpTask } from "@/lib/communications-os/agents";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };
const bodySchema = z.object({ conversationId: z.string().uuid(), reason: z.string().trim().min(1).max(500) }).strict();

/** POST /api/organizations/{organizationId}/communications/agents/draft-follow-up */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, bodySchema);
    const result = await createDraftFollowUpTask(db, { organizationId, conversationId: body.conversationId, reason: body.reason, actorUserId: user.userId });
    return jsonSuccess(result, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
