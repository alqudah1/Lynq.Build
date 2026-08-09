import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { grantRevisionSchema, grantReasonSchema } from "@/lib/brain/validation";
import { updateBrainPermissionGrant } from "@/lib/brain/permissions";

export const dynamic = "force-dynamic";

const updateGrantBodySchema = z
  .object({
    expectedRevision: grantRevisionSchema,
    reason: grantReasonSchema.nullable(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string; grantId: string }> };

/**
 * PATCH /api/organizations/{organizationId}/brain-permissions/{grantId}
 * Updates a grant's own mutable `reason` field only — capability, scope,
 * and grantee are immutable once a grant exists (revoke-and-recreate is the
 * only way to change any of those; see `updateBrainPermissionGrant`'s own
 * doc comment). Requires the identical grant-management authority as
 * creating a grant at this exact scope. Optimistic concurrency via
 * `expectedRevision`.
 *
 * Body: { "expectedRevision": number, "reason": string | null }
 *
 * 200 response: { "data": { "id": "...", "reason": "...", "revision": 2, ... } }
 *
 * Errors: 400 invalid_request, 401 unauthenticated, 403 forbidden, 404 not_found, 409 grant_already_revoked, 409 grant_conflict — expectedRevision no longer matches
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, grantId: rawGrantId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const grantId = parseUuidParam(rawGrantId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, updateGrantBodySchema);

    const grant = await updateBrainPermissionGrant(db, {
      organizationId,
      grantId,
      reason: body.reason,
      expectedRevision: body.expectedRevision,
      actorUserId: user.userId,
    });

    return jsonSuccess(grant);
  } catch (err) {
    return handleRouteError(err);
  }
}
