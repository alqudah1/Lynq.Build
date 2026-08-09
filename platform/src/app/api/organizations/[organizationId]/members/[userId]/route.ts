import "server-only";
import { neon } from "@neondatabase/serverless";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, organizationRoleSchema } from "@/lib/http/validation";
import { changeOrganizationRole, removeOrganizationMember } from "@/lib/organizations/memberships";

export const dynamic = "force-dynamic";

const changeRoleBodySchema = z.object({ role: organizationRoleSchema }).strict();

type RouteParams = { params: Promise<{ organizationId: string; userId: string }> };

/**
 * PATCH /api/organizations/{organizationId}/members/{userId}
 * Changes an existing member's role. Owners and admins only; never the
 * actor's own membership; admins can never act on an owner; the final
 * owner can never be demoted.
 *
 * Body: { "role": "owner" | "admin" | "member" | "viewer" }
 *
 * 200 response:
 * { "data": { "organizationId": "...", "userId": "...", "role": "admin" } }
 *
 * Errors:
 * 400 invalid_request — missing/invalid role
 * 401 unauthenticated
 * 403 forbidden — member/viewer attempting the change
 * 404 not_found — organization or target membership doesn't exist / actor isn't a member
 * 409 self_role_change — actor and target are the same user
 * 409 admin_cannot_act_on_owner — an admin attempting to act on an owner
 * 409 last_owner — attempting to demote the organization's final owner
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, userId: rawUserId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const targetUserId = parseUuidParam(rawUserId);

    const env = loadEnv();
    const db = createDbClient(env);
    const rawSql = neon(env.DATABASE_URL);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, changeRoleBodySchema);
    const membership = await changeOrganizationRole(db, rawSql, {
      organizationId,
      actorUserId: user.userId,
      targetUserId,
      newRole: body.role,
    });

    return jsonSuccess(membership);
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * DELETE /api/organizations/{organizationId}/members/{userId}
 * Removes a member from the organization. Owners and admins only; admins
 * can never remove an owner; the final owner can never be removed.
 *
 * 204 response: empty body.
 *
 * Errors:
 * 401 unauthenticated
 * 403 forbidden — member/viewer attempting to remove
 * 404 not_found — organization or target membership doesn't exist / actor isn't a member
 * 409 admin_cannot_act_on_owner
 * 409 last_owner
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, userId: rawUserId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const targetUserId = parseUuidParam(rawUserId);

    const env = loadEnv();
    const db = createDbClient(env);
    const rawSql = neon(env.DATABASE_URL);
    const user = await getAuthenticatedUser(db);

    await removeOrganizationMember(db, rawSql, { organizationId, actorUserId: user.userId, targetUserId });

    return new Response(null, { status: 204 });
  } catch (err) {
    return handleRouteError(err);
  }
}
