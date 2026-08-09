import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { getEffectiveBrainPermissions } from "@/lib/brain/permissions";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

/**
 * GET /api/organizations/{organizationId}/brain-permissions/effective
 * Resolves the AUTHENTICATED caller's own effective Brain capabilities —
 * every active grant they hold, across every domain and workspace scope in
 * this organization, grouped by exact scope. Always self; there is no
 * target-user parameter (see `getEffectiveBrainPermissions`'s own doc
 * comment for why).
 *
 * 200 response: { "data": { "scopes": [ { "domain": "execution", "workspaceId": null, "capabilities": ["read", "draft_write"] } ] } }
 *
 * Errors: 401 unauthenticated, 404 not_found — not an organization member
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const result = await getEffectiveBrainPermissions(db, organizationId, user.userId);
    return jsonSuccess(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
