import "server-only";
import { neon } from "@neondatabase/serverless";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, workspaceRoleSchema } from "@/lib/http/validation";
import { changeWorkspaceRole, removeWorkspaceMember } from "@/lib/workspaces/memberships";

export const dynamic = "force-dynamic";

const changeRoleBodySchema = z.object({ role: workspaceRoleSchema }).strict();

type RouteParams = { params: Promise<{ organizationId: string; workspaceId: string; userId: string }> };

/**
 * PATCH /api/organizations/{organizationId}/workspaces/{workspaceId}/members/{userId}
 * Changes a workspace member's role. The workspace's manager, or an
 * organization owner/admin via the admin-override; never the actor's own
 * membership.
 *
 * Body: { "role": "manager" | "member" | "viewer" }
 *
 * 200 response:
 * { "data": { "workspaceId": "...", "organizationId": "...", "userId": "...", "role": "viewer" } }
 *
 * Errors:
 * 400 invalid_request
 * 401 unauthenticated
 * 403 forbidden
 * 404 not_found
 * 409 self_role_change
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, workspaceId: rawWorkspaceId, userId: rawUserId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const workspaceId = parseUuidParam(rawWorkspaceId);
    const targetUserId = parseUuidParam(rawUserId);

    const env = loadEnv();
    const db = createDbClient(env);
    const rawSql = neon(env.DATABASE_URL);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, changeRoleBodySchema);
    const membership = await changeWorkspaceRole(db, rawSql, {
      workspaceId,
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
 * DELETE /api/organizations/{organizationId}/workspaces/{workspaceId}/members/{userId}
 * Removes a member from the workspace. The workspace's manager, or an
 * organization owner/admin via the admin-override, only.
 *
 * 204 response: empty body.
 *
 * Errors: 401 unauthenticated, 403 forbidden, 404 not_found
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, workspaceId: rawWorkspaceId, userId: rawUserId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const workspaceId = parseUuidParam(rawWorkspaceId);
    const targetUserId = parseUuidParam(rawUserId);

    const env = loadEnv();
    const db = createDbClient(env);
    const rawSql = neon(env.DATABASE_URL);
    const user = await getAuthenticatedUser(db);

    await removeWorkspaceMember(db, rawSql, { workspaceId, organizationId, actorUserId: user.userId, targetUserId });

    return new Response(null, { status: 204 });
  } catch (err) {
    return handleRouteError(err);
  }
}
