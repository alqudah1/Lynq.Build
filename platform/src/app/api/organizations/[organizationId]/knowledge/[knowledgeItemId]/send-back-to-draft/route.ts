import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { sendKnowledgeItemBackToDraft } from "@/lib/brain/lifecycle";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; knowledgeItemId: string }> };

/**
 * POST /api/organizations/{organizationId}/knowledge/{knowledgeItemId}/send-back-to-draft
 * Review → Draft (Brain Module 8, "sent back"). Requires ordinary edit
 * authority — the reviewer need not be the item's author. No request body.
 *
 * 200 response: { "data": { "id": "...", "status": "draft", ... } }
 *
 * Errors: 401 unauthenticated, 403 forbidden, 404 not_found, 409 invalid_lifecycle_transition — item is not currently in review
 */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, knowledgeItemId: rawKnowledgeItemId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const knowledgeItemId = parseUuidParam(rawKnowledgeItemId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const item = await sendKnowledgeItemBackToDraft(db, { organizationId, knowledgeItemId, actorUserId: user.userId });
    return jsonSuccess(item);
  } catch (err) {
    return handleRouteError(err);
  }
}
