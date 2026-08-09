import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { revokeBrainPermissionGrant } from "@/lib/brain/permissions";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; grantId: string }> };

/**
 * POST /api/organizations/{organizationId}/brain-permissions/{grantId}/revoke
 * Revokes a grant — a one-way, terminal transition; re-granting later
 * creates a brand-new row (there is no "un-revoke"). Requires the
 * identical grant-management authority as creating a grant at this exact
 * scope. No request body — the atomic `revoked_at IS NULL` guard is the
 * complete concurrency protection (see `revokeBrainPermissionGrant`'s own
 * doc comment).
 *
 * 200 response: { "data": { "id": "...", "revokedAt": "...", "revokedByUserId": "...", ... } }
 *
 * Errors: 401 unauthenticated, 403 forbidden, 404 not_found, 409 grant_already_revoked
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, grantId: rawGrantId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const grantId = parseUuidParam(rawGrantId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const grant = await revokeBrainPermissionGrant(db, { organizationId, grantId, actorUserId: user.userId });
    return jsonSuccess(grant);
  } catch (err) {
    return handleRouteError(err);
  }
}
