import "server-only";
import { neon } from "@neondatabase/serverless";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, organizationRoleSchema } from "@/lib/http/validation";
import { addOrganizationMember, listOrganizationMembers } from "@/lib/organizations/memberships";

export const dynamic = "force-dynamic";

const addMemberBodySchema = z.object({ userId: z.string().uuid(), role: organizationRoleSchema }).strict();

type RouteParams = { params: Promise<{ organizationId: string }> };

/**
 * GET /api/organizations/{organizationId}/members
 * Lists every member of the organization. Any member (any role) may view this.
 *
 * 200 response:
 * { "data": [ { "userId": "...", "email": "alice@example.com", "role": "owner" } ] }
 *
 * Errors: 401 unauthenticated, 404 not_found (nonexistent org or not a member)
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const members = await listOrganizationMembers(db, organizationId, user.userId);
    return jsonSuccess(members);
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * POST /api/organizations/{organizationId}/members
 * Adds an existing user to the organization with the given role. Owners and admins only.
 *
 * Body: { "userId": string (UUID of an existing user), "role": "owner" | "admin" | "member" | "viewer" }
 *
 * 201 response:
 * { "data": { "organizationId": "...", "userId": "...", "role": "member" } }
 *
 * Errors:
 * 400 invalid_request — missing/invalid userId or role
 * 401 unauthenticated
 * 403 forbidden — member/viewer attempting to add
 * 404 not_found — organization doesn't exist or actor isn't a member
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const rawSql = neon(env.DATABASE_URL);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, addMemberBodySchema);
    const membership = await addOrganizationMember(db, rawSql, {
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
