import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { publishKnowledgeItem } from "@/lib/brain/lifecycle";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; knowledgeItemId: string }> };

/**
 * POST /api/organizations/{organizationId}/knowledge/{knowledgeItemId}/publish
 * Approved → Published (Brain Module 9). Shares the `approve` grant level
 * for now (§4/§15.5's deferred decision on a separate `publish` grant). No
 * request body.
 *
 * 200 response: { "data": { "id": "...", "status": "published", "publishedByUserId": "...", "publishedAt": "...", ... } }
 *
 * Errors: 401 unauthenticated, 403 forbidden, 404 not_found, 409 invalid_lifecycle_transition — item is not currently approved
 */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, knowledgeItemId: rawKnowledgeItemId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const knowledgeItemId = parseUuidParam(rawKnowledgeItemId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const item = await publishKnowledgeItem(db, { organizationId, knowledgeItemId, actorUserId: user.userId });
    return jsonSuccess(item);
  } catch (err) {
    return handleRouteError(err);
  }
}
