import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { getRelationshipForUser } from "@/lib/brain/relationships";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; relationshipId: string }> };

/**
 * GET /api/organizations/{organizationId}/knowledge-relationships/{relationshipId}
 * Fetches one relationship. Requires the actor to independently have read
 * access to BOTH endpoint items — a relationship whose other endpoint the
 * actor cannot see is a 404, identical to a nonexistent relationship
 * (MODULE_3_BRAIN_ARCHITECTURE.md §7: a relationship never grants
 * visibility into the item on its other end).
 *
 * 200 response: { "data": { "id": "...", "sourceItemId": "...", "targetItemId": "...", "relationshipType": "supports", ... } }
 *
 * Errors: 401 unauthenticated, 404 not_found
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, relationshipId: rawRelationshipId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const relationshipId = parseUuidParam(rawRelationshipId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const relationship = await getRelationshipForUser(db, organizationId, relationshipId, user.userId);
    return jsonSuccess(relationship);
  } catch (err) {
    return handleRouteError(err);
  }
}
