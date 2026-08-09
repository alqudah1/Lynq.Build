import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { versionNumberSchema } from "@/lib/brain/validation";
import { archiveKnowledgeItem } from "@/lib/brain/knowledge-items";

export const dynamic = "force-dynamic";

const archiveKnowledgeItemBodySchema = z.object({ expectedVersionNumber: versionNumberSchema }).strict();

type RouteParams = { params: Promise<{ organizationId: string; knowledgeItemId: string }> };

/**
 * POST /api/organizations/{organizationId}/knowledge/{knowledgeItemId}/archive
 * Archives a knowledge item. Requires the `archive` Brain-domain capability
 * at this exact scope (Module 7) — never substitutable by authorship,
 * unlike an ordinary update. There is no hard-delete endpoint anywhere in
 * this module, and archiving never creates a new content version or
 * rewrites history — it is purely an item-level lifecycle transition.
 *
 * Body: { "expectedVersionNumber": number }
 *
 * 200 response: { "data": { "id": "...", "status": "archived", "archivedAt": "...", "currentVersionNumber": 2, ... } }
 *
 * Errors:
 * 400 invalid_request
 * 401 unauthenticated
 * 403 forbidden — lacks the `archive` capability at this scope
 * 404 not_found
 * 409 version_conflict — expectedVersionNumber no longer matches; 409 already_archived
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, knowledgeItemId: rawKnowledgeItemId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const knowledgeItemId = parseUuidParam(rawKnowledgeItemId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, archiveKnowledgeItemBodySchema);

    const item = await archiveKnowledgeItem(db, {
      organizationId,
      knowledgeItemId,
      actorUserId: user.userId,
      expectedVersionNumber: body.expectedVersionNumber,
    });

    return jsonSuccess(item);
  } catch (err) {
    return handleRouteError(err);
  }
}
