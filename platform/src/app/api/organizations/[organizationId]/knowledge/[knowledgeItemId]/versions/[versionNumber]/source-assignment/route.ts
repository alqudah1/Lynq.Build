import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { versionNumberSchema } from "@/lib/brain/validation";
import { validateSourceAssignment } from "@/lib/brain/source-hierarchy";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; knowledgeItemId: string; versionNumber: string }> };

/**
 * GET /api/organizations/{organizationId}/knowledge/{knowledgeItemId}/versions/{versionNumber}/source-assignment
 * Validates the Source already recorded for this version (Brain Module 4)
 * against the Source Hierarchy, returning its rank. `isValid: false` (never
 * a 404) when no source has been recorded yet — this mirrors the trust
 * route's "not yet assessed is not an error" behavior, not a failure state.
 * The only tenant-scoped operation in this module — reuses the identical
 * cross-tenant/workspace-membership gate every other Brain read uses.
 *
 * 200 response: { "data": { "isValid": true, "sourceType": "founder_decision", "rank": 1 } }
 * or: { "data": { "isValid": false, "sourceType": null, "rank": null, "reason": "no source has been recorded for this version yet" } }
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

    const validation = await validateSourceAssignment(db, organizationId, knowledgeItemId, versionNumber, user.userId);
    return jsonSuccess(validation);
  } catch (err) {
    return handleRouteError(err);
  }
}
