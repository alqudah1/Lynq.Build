import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { relationshipTypeSchema, relationshipDirectionSchema, relationshipStatusSchema, knowledgeListLimitSchema } from "@/lib/brain/validation";
import { listRelationshipsForItem } from "@/lib/brain/relationships";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; knowledgeItemId: string }> };

/**
 * GET /api/organizations/{organizationId}/knowledge/{knowledgeItemId}/relationships
 * Lists the relationships anchored at one item — direct edges only, never a
 * multi-hop graph traversal (explicitly deferred; this module only stores
 * and retrieves edges). A relationship whose *other* endpoint the actor
 * cannot independently read is silently excluded, never returned in a
 * redacted form.
 *
 * Query params: direction? ("outgoing" | "incoming" | "both", default "both"),
 * relationshipType?, status? ("active" | "archived", default "active"), cursor?, limit?
 *
 * 200 response:
 * { "data": { "relationships": [ { "id": "...", "sourceItemId": "...", "targetItemId": "...", "relationshipType": "supports", "explanation": null, "creatorUserId": "...", "createdAt": "...", "archivedAt": null } ], "nextCursor": "..." | null } }
 *
 * Errors: 400 invalid_request, 401 unauthenticated, 404 not_found
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, knowledgeItemId: rawKnowledgeItemId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const knowledgeItemId = parseUuidParam(rawKnowledgeItemId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const query = z
      .object({
        direction: relationshipDirectionSchema.optional(),
        relationshipType: relationshipTypeSchema.optional(),
        status: relationshipStatusSchema.optional(),
        cursor: z.string().optional(),
        limit: knowledgeListLimitSchema.optional(),
      })
      .parse({
        direction: url.searchParams.get("direction") ?? undefined,
        relationshipType: url.searchParams.get("relationshipType") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
        cursor: url.searchParams.get("cursor") ?? undefined,
        limit: url.searchParams.get("limit") ?? undefined,
      });

    const result = await listRelationshipsForItem(db, {
      organizationId,
      knowledgeItemId,
      actorUserId: user.userId,
      direction: query.direction,
      relationshipType: query.relationshipType,
      status: query.status,
      cursor: query.cursor ?? null,
      limit: query.limit,
    });

    return jsonSuccess(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
