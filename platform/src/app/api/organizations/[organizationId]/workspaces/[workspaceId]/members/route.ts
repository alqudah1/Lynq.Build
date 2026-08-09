import "server-only";
import { neon } from "@neondatabase/serverless";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, workspaceRoleSchema } from "@/lib/http/validation";
import { addWorkspaceMember, listWorkspaceMembers } from "@/lib/workspaces/memberships";

export const dynamic = "force-dynamic";

const addMemberBodySchema = z.object({ userId: z.string().uuid(), role: workspaceRoleSchema }).strict();

type RouteParams = { params: Promise<{ organizationId: string; workspaceId: string }> };

/**
 * GET /api/organizations/{organizationId}/workspaces/{workspaceId}/members
 * Lists the workspace's members. Any explicit workspace member (any role,
 * including viewer), or an organization owner/admin via the admin-override.
 *
 * 200 response:
 * { "data": [ { "userId": "...", "email": "alice@example.com", "role": "manager" } ] }
 *
 * Errors: 401 unauthenticated, 404 not_found
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, workspaceId: rawWorkspaceId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const workspaceId = parseUuidParam(rawWorkspaceId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const members = await listWorkspaceMembers(db, workspaceId, organizationId, user.userId);
    return jsonSuccess(members);
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * POST /api/organizations/{organizationId}/workspaces/{workspaceId}/members
 * Adds an existing organization member to the workspace. The workspace's
 * manager, or an organization owner/admin via the admin-override, only.
 *
 * Body: { "userId": string (UUID), "role": "manager" | "member" | "viewer" }
 *
 * 201 response:
 * { "data": { "workspaceId": "...", "organizationId": "...", "userId": "...", "role": "member" } }
 *
 * Errors:
 * 400 invalid_request
 * 401 unauthenticated
 * 403 forbidden — workspace member/viewer (not manager), no admin-override available
 * 404 not_found
 * 409 parent_membership_required — target user has no membership in this workspace's parent organization
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, workspaceId: rawWorkspaceId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const workspaceId = parseUuidParam(rawWorkspaceId);

    const env = loadEnv();
    const db = createDbClient(env);
    const rawSql = neon(env.DATABASE_URL);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, addMemberBodySchema);
    const membership = await addWorkspaceMember(db, rawSql, {
      workspaceId,
      organizationId,
      actorUserId: user.userId,
      targetUserId: body.userId,
      role: body.role,
    });

    return jsonSuccess(membership, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
