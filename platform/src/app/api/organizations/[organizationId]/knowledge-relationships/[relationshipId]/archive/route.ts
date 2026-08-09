import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { archiveRelationship } from "@/lib/brain/relationships";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; relationshipId: string }> };

/**
 * POST /api/organizations/{organizationId}/knowledge-relationships/{relationshipId}/archive
 * Archives a relationship — never a hard delete (no DELETE route exists).
 * Requires UPDATE-level authority on BOTH endpoint items (the same
 * authority that could edit either one), not the relationship's own
 * creator — MODULE_3_BRAIN_ARCHITECTURE.md §13 entity 8's exact rule.
 *
 * No request body — archiving a relationship has no other mutable field to
 * protect with a concurrency token; the atomic `archived_at IS NULL` guard
 * is sufficient (see `archiveRelationship`'s own doc comment for the full
 * reasoning).
 *
 * 200 response: { "data": { "id": "...", "archivedAt": "...", ... } }
 *
 * Errors:
 * 401 unauthenticated
 * 403 forbidden — actor lacks update authority on one or both endpoints
 * 404 not_found
 * 409 relationship_already_archived
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, relationshipId: rawRelationshipId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const relationshipId = parseUuidParam(rawRelationshipId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const relationship = await archiveRelationship(db, { organizationId, relationshipId, actorUserId: user.userId });
    return jsonSuccess(relationship);
  } catch (err) {
    return handleRouteError(err);
  }
}
