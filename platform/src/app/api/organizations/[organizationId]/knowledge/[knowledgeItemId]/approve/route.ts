import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { approveKnowledgeItem } from "@/lib/brain/lifecycle";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; knowledgeItemId: string }> };

/**
 * POST /api/organizations/{organizationId}/knowledge/{knowledgeItemId}/approve
 * Review → Approved (Brain Module 9) — the one gate with structurally no
 * agent bypass, ever. Requires the `approve` capability at this exact
 * scope. No request body.
 *
 * 200 response: { "data": { "id": "...", "status": "approved", "approvedByUserId": "...", "approvedAt": "...", ... } }
 *
 * Errors: 401 unauthenticated, 403 forbidden — lacks the `approve` capability, 404 not_found, 409 invalid_lifecycle_transition — item is not currently in review
 */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, knowledgeItemId: rawKnowledgeItemId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const knowledgeItemId = parseUuidParam(rawKnowledgeItemId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const item = await approveKnowledgeItem(db, { organizationId, knowledgeItemId, actorUserId: user.userId });
    return jsonSuccess(item);
  } catch (err) {
    return handleRouteError(err);
  }
}
