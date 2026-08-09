import "server-only";
import { neon } from "@neondatabase/serverless";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, nameSchema, slugSchema } from "@/lib/http/validation";
import { getOrganizationForUser, updateOrganization, softDeleteOrganization } from "@/lib/organizations/organizations";

export const dynamic = "force-dynamic";

const updateOrganizationBodySchema = z
  .object({ name: nameSchema.optional(), slug: slugSchema.optional() })
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: "at least one of name or slug must be provided" });

type RouteParams = { params: Promise<{ organizationId: string }> };

/**
 * GET /api/organizations/{organizationId}
 * Fetches one organization the authenticated user belongs to.
 *
 * Path params: organizationId (UUID)
 *
 * 200 response:
 * { "data": { "organization": { "id": "...", "name": "Acme", "slug": "acme", "deletedAt": null, "createdAt": "...", "updatedAt": "..." }, "membership": { "organizationId": "...", "userId": "...", "role": "member" } } }
 *
 * Errors:
 * 401 unauthenticated
 * 404 not_found — nonexistent, soft-deleted, or the user isn't a member (identical response in all three cases)
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const result = await getOrganizationForUser(db, organizationId, user.userId);
    return jsonSuccess(result);
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * PATCH /api/organizations/{organizationId}
 * Updates the organization's name and/or slug. Owners and admins only.
 *
 * Body: { "name"?: string, "slug"?: string } — at least one field required.
 *
 * 200 response:
 * { "data": { "id": "...", "name": "Acme Corp", "slug": "acme", "deletedAt": null, "createdAt": "...", "updatedAt": "..." } }
 *
 * Errors:
 * 400 invalid_request — no fields provided, or invalid name/slug
 * 401 unauthenticated
 * 403 forbidden — member/viewer attempting to update
 * 404 not_found — nonexistent, soft-deleted, or not a member
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const rawSql = neon(env.DATABASE_URL);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, updateOrganizationBodySchema);
    const organization = await updateOrganization(db, rawSql, {
      organizationId,
      actorUserId: user.userId,
      updates: body,
    });

    return jsonSuccess(organization);
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * DELETE /api/organizations/{organizationId}
 * Soft-deletes the organization and cascades to its workspaces. Owners only.
 *
 * 204 response: empty body.
 *
 * Errors:
 * 401 unauthenticated
 * 403 forbidden — non-owner attempting to delete
 * 404 not_found — nonexistent, already deleted, or not a member
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const rawSql = neon(env.DATABASE_URL);
    const user = await getAuthenticatedUser(db);

    await softDeleteOrganization(db, rawSql, { organizationId, actorUserId: user.userId });

    return new Response(null, { status: 204 });
  } catch (err) {
    return handleRouteError(err);
  }
}
