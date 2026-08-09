import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { restoreKnowledgeItem } from "@/lib/brain/lifecycle";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; knowledgeItemId: string }> };

/**
 * POST /api/organizations/{organizationId}/knowledge/{knowledgeItemId}/restore
 * Archived → Approved (Brain Module 9) — a genuine re-approval, not a
 * technicality; same authority and human-only requirement as the original
 * approval. Distinct from `.../versions/{versionNumber}/restore` (Module
 * 2, content rollback) — this restores the item's LIFECYCLE status only.
 * No request body.
 *
 * 200 response: { "data": { "id": "...", "status": "approved", ... } }
 *
 * Errors: 401 unauthenticated, 403 forbidden — lacks the `approve` capability, 404 not_found, 409 invalid_lifecycle_transition — item is not currently archived
 */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, knowledgeItemId: rawKnowledgeItemId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const knowledgeItemId = parseUuidParam(rawKnowledgeItemId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const item = await restoreKnowledgeItem(db, { organizationId, knowledgeItemId, actorUserId: user.userId });
    return jsonSuccess(item);
  } catch (err) {
    return handleRouteError(err);
  }
}
