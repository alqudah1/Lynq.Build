import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { versionNumberSchema } from "@/lib/brain/validation";
import { getKnowledgeItemVersionForUser } from "@/lib/brain/knowledge-item-versions";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; knowledgeItemId: string; versionNumber: string }> };

/**
 * GET /api/organizations/{organizationId}/knowledge/{knowledgeItemId}/versions/{versionNumber}
 * Resolves exactly one historical version. Requires the identical tenant/
 * workspace authorization as the parent item — a nonexistent version number
 * on an otherwise-accessible item is a 404, identical to an inaccessible
 * item, so a caller cannot learn how many versions an item has beyond what
 * it can already read.
 *
 * 200 response:
 * { "data": { "versionNumber": 2, "title": "...", "content": "...", "classification": "note", "createdByUserId": "...", "changeReason": "...", "createdAt": "...", "isCurrent": true } }
 *
 * Errors: 400 invalid_request, 401 unauthenticated, 404 not_found
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, knowledgeItemId: rawKnowledgeItemId, versionNumber: rawVersionNumber } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const knowledgeItemId = parseUuidParam(rawKnowledgeItemId);
    const versionNumber = versionNumberSchema.parse(rawVersionNumber);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const version = await getKnowledgeItemVersionForUser(db, organizationId, knowledgeItemId, versionNumber, user.userId);
    return jsonSuccess(version);
  } catch (err) {
    return handleRouteError(err);
  }
}
