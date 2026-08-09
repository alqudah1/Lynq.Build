import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, uuidParam } from "@/lib/http/validation";
import { relationshipTypeSchema, relationshipExplanationSchema } from "@/lib/brain/validation";
import { createRelationship } from "@/lib/brain/relationships";

export const dynamic = "force-dynamic";

const createRelationshipBodySchema = z
  .object({
    sourceItemId: uuidParam,
    targetItemId: uuidParam,
    relationshipType: relationshipTypeSchema,
    explanation: relationshipExplanationSchema.optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string }> };

/**
 * POST /api/organizations/{organizationId}/knowledge-relationships
 * Creates a typed, directed edge between two stable knowledge items
 * (never versions). Requires the actor to independently have read access
 * to BOTH `sourceItemId` and `targetItemId`, and neither may be archived.
 *
 * Body: { "sourceItemId": string (UUID), "targetItemId": string (UUID), "relationshipType": string, "explanation"?: string }
 *
 * 201 response: { "data": { "id": "...", "sourceItemId": "...", "targetItemId": "...", "relationshipType": "supports", ... } }
 *
 * Errors:
 * 400 invalid_request
 * 401 unauthenticated
 * 404 not_found — either endpoint doesn't exist, is cross-tenant, or the actor lacks explicit workspace membership for a workspace-scoped endpoint
 * 409 self_relationship — sourceItemId equals targetItemId
 * 409 item_archived — either endpoint is archived
 * 409 duplicate_relationship — an active relationship of this exact type already exists between these two items
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = uuidParam.parse(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createRelationshipBodySchema);

    const relationship = await createRelationship(db, {
      organizationId,
      sourceItemId: body.sourceItemId,
      targetItemId: body.targetItemId,
      relationshipType: body.relationshipType,
      explanation: body.explanation ?? null,
      actorUserId: user.userId,
    });

    return jsonSuccess(relationship, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
