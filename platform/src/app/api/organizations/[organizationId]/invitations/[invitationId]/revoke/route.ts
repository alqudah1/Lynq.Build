import "server-only";
import { createDbClient } from "@/db/client";
import { loadEnv } from "@/lib/env";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { revokeInvitation } from "@/lib/invitations/invitations";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; invitationId: string }> };

/**
 * POST /api/organizations/{organizationId}/invitations/{invitationId}/revoke
 * Revokes a pending invitation. Owners and admins only. A revoked
 * invitation can never be accepted, even if the recipient still has the
 * email/link.
 *
 * 200 response:
 * { "data": { "revoked": true } }
 *
 * Errors:
 * 401 unauthenticated
 * 403 forbidden — member/viewer attempting to revoke
 * 404 not_found — invitation doesn't exist in this organization, or actor isn't a member
 * 409 already_used — the invitation is no longer pending (already accepted, already revoked, or expired)
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, invitationId: rawInvitationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const invitationId = parseUuidParam(rawInvitationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    await revokeInvitation(db, { organizationId, actorUserId: user.userId, invitationId });

    return jsonSuccess({ revoked: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
