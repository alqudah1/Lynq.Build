import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { versionNumberSchema, changeReasonSchema } from "@/lib/brain/validation";
import { restoreKnowledgeItemVersion } from "@/lib/brain/knowledge-item-versions";

export const dynamic = "force-dynamic";

const restoreBodySchema = z.object({ expectedVersionNumber: versionNumberSchema, changeReason: changeReasonSchema }).strict();

type RouteParams = { params: Promise<{ organizationId: string; knowledgeItemId: string; versionNumber: string }> };

/**
 * POST /api/organizations/{organizationId}/knowledge/{knowledgeItemId}/versions/{versionNumber}/restore
 * Restores a historical version by creating a brand-new current version
 * whose content copies the named one — never by moving the current pointer
 * backward. Requires the same authorization as a plain update, the current
 * concurrency token, and a mandatory, non-empty change reason recording why
 * the restoration happened. Rollback of an archived item is not permitted.
 *
 * Body: { "expectedVersionNumber": number, "changeReason": string }
 *
 * 200 response: { "data": { "id": "...", "currentVersionNumber": 6, ... } }
 *
 * Errors:
 * 400 invalid_request
 * 401 unauthenticated
 * 403 forbidden — lacks `edit_any_draft`, and (if not the author) lacks `edit_own_draft`
 * 404 not_found — item, or the source version number, doesn't exist/isn't accessible
 * 409 version_conflict — expectedVersionNumber no longer matches; 409 item_archived — cannot restore into an archived item
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, knowledgeItemId: rawKnowledgeItemId, versionNumber: rawVersionNumber } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const knowledgeItemId = parseUuidParam(rawKnowledgeItemId);
    const sourceVersionNumber = versionNumberSchema.parse(rawVersionNumber);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, restoreBodySchema);

    const item = await restoreKnowledgeItemVersion(db, {
      organizationId,
      knowledgeItemId,
      sourceVersionNumber,
      expectedVersionNumber: body.expectedVersionNumber,
      changeReason: body.changeReason,
      actorUserId: user.userId,
    });

    return jsonSuccess(item);
  } catch (err) {
    return handleRouteError(err);
  }
}
