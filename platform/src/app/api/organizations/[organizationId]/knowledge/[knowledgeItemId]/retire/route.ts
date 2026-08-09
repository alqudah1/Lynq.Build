import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { retireReasonSchema } from "@/lib/brain/validation";
import { retireKnowledgeItem } from "@/lib/brain/lifecycle";

export const dynamic = "force-dynamic";

const retireBodySchema = z.object({ reason: retireReasonSchema }).strict();

type RouteParams = { params: Promise<{ organizationId: string; knowledgeItemId: string }> };

/**
 * POST /api/organizations/{organizationId}/knowledge/{knowledgeItemId}/retire
 * Any non-terminal status → Retired (Brain Module 9) — "would actively
 * mislead if resurfaced," preserved for audit only, excluded from normal
 * retrieval by default. Requires the `archive` capability and a mandatory,
 * bounded reason.
 *
 * Body: { "reason": string }
 *
 * 200 response: { "data": { "id": "...", "status": "retired", "retiredReason": "...", ... } }
 *
 * Errors: 400 invalid_request, 401 unauthenticated, 403 forbidden — lacks the `archive` capability, 404 not_found, 409 invalid_lifecycle_transition — item is already retired or purged
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, knowledgeItemId: rawKnowledgeItemId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const knowledgeItemId = parseUuidParam(rawKnowledgeItemId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, retireBodySchema);

    const item = await retireKnowledgeItem(db, { organizationId, knowledgeItemId, reason: body.reason, actorUserId: user.userId });
    return jsonSuccess(item);
  } catch (err) {
    return handleRouteError(err);
  }
}
