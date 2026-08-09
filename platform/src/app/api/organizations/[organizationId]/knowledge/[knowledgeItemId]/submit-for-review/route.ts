import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { submitKnowledgeItemForReview } from "@/lib/brain/lifecycle";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; knowledgeItemId: string }> };

/**
 * POST /api/organizations/{organizationId}/knowledge/{knowledgeItemId}/submit-for-review
 * Draft → Review (Brain Module 8). Requires ordinary edit authority
 * (`edit_any_draft`, or `edit_own_draft` while the actor is the author) —
 * "any human or agent" per §4's authority table. No request body.
 *
 * 200 response: { "data": { "id": "...", "status": "review", ... } }
 *
 * Errors: 401 unauthenticated, 403 forbidden, 404 not_found, 409 invalid_lifecycle_transition — item is not currently draft
 */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, knowledgeItemId: rawKnowledgeItemId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const knowledgeItemId = parseUuidParam(rawKnowledgeItemId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const item = await submitKnowledgeItemForReview(db, { organizationId, knowledgeItemId, actorUserId: user.userId });
    return jsonSuccess(item);
  } catch (err) {
    return handleRouteError(err);
  }
}
