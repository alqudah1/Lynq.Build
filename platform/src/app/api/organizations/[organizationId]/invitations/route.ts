import "server-only";
import { neon } from "@neondatabase/serverless";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, emailSchema, organizationRoleSchema, workspaceRoleSchema } from "@/lib/http/validation";
import { createOrRefreshInvitation, listOrganizationInvitations } from "@/lib/invitations/invitations";
import { notifyInvitationCreated } from "@/lib/email/invitation-notifier";
import { PostgresRateLimiter } from "@/lib/rate-limit/postgres";
import { enforceRateLimit, invitationCreateRateLimitKey, INVITATION_CREATE_RATE_LIMIT } from "@/lib/invitations/rate-limits";

export const dynamic = "force-dynamic";

const createInvitationBodySchema = z
  .object({
    email: emailSchema,
    role: organizationRoleSchema,
    workspaceId: z.string().uuid().optional(),
    workspaceRole: workspaceRoleSchema.optional(),
  })
  .strict()
  .refine((data) => !data.workspaceId === !data.workspaceRole, {
    message: "workspaceId and workspaceRole must be provided together",
  });

type RouteParams = { params: Promise<{ organizationId: string }> };

/**
 * GET /api/organizations/{organizationId}/invitations
 * Lists every invitation (pending, accepted, revoked, expired) for the organization. Owners and admins only.
 *
 * 200 response:
 * { "data": [ { "id": "...", "organizationId": "...", "workspaceId": null, "email": "alice@example.com", "role": "member", "workspaceRole": null, "invitedByUserId": "...", "status": "pending", "expiresAt": "...", "acceptedAt": null, "createdAt": "..." } ] }
 *
 * Errors: 401 unauthenticated, 403 forbidden (member/viewer), 404 not_found
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const list = await listOrganizationInvitations(db, organizationId, user.userId);
    return jsonSuccess(list);
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * POST /api/organizations/{organizationId}/invitations
 * Creates a new pending invitation, OR — if one is already pending for the
 * same email — atomically refreshes it (new token, reset 7-day expiry).
 * Owners and admins only; an admin may never invite someone as owner.
 *
 * Body: { "email": string, "role": "owner"|"admin"|"member"|"viewer", "workspaceId"?: string (UUID), "workspaceRole"?: "manager"|"member"|"viewer" }
 * (workspaceId and workspaceRole must be provided together, or not at all)
 *
 * 201 response (new invitation) / 200 response (existing pending invitation refreshed):
 * { "data": { "invitation": { "id": "...", "organizationId": "...", "workspaceId": null, "email": "alice@example.com", "role": "member", "workspaceRole": null, "invitedByUserId": "...", "status": "pending", "expiresAt": "...", "acceptedAt": null, "createdAt": "..." }, "refreshed": false } }
 *
 * Note: the raw invitation token/accept URL is never included in this
 * response — it exists only transiently, to build the invitation email.
 *
 * Errors:
 * 400 invalid_request — invalid email/role, or workspaceId/workspaceRole provided without the other
 * 401 unauthenticated
 * 403 forbidden — member/viewer attempting to invite
 * 404 not_found — organization doesn't exist, actor isn't a member, or workspaceId doesn't belong to this organization
 * 409 unauthorized_role — an admin attempting to invite someone as owner
 * 429 rate_limited
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const rawSql = neon(env.DATABASE_URL);
    const limiter = new PostgresRateLimiter(db);
    const user = await getAuthenticatedUser(db);

    await enforceRateLimit(limiter, invitationCreateRateLimitKey(organizationId, user.userId), INVITATION_CREATE_RATE_LIMIT);

    const body = await parseJsonBody(request, createInvitationBodySchema);

    const result = await createOrRefreshInvitation(db, rawSql, {
      organizationId,
      actorUserId: user.userId,
      email: body.email,
      role: body.role,
      workspace: body.workspaceId && body.workspaceRole ? { workspaceId: body.workspaceId, workspaceRole: body.workspaceRole } : null,
    });

    await notifyInvitationCreated(db, result, user.userId);

    return jsonSuccess({ invitation: result.invitation, refreshed: result.refreshed }, result.refreshed ? 200 : 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
