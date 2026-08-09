import "server-only";
import { neon } from "@neondatabase/serverless";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, nameSchema, slugSchema } from "@/lib/http/validation";
import { getWorkspaceForUser, updateWorkspace, softDeleteWorkspace } from "@/lib/workspaces/workspaces";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";

export const dynamic = "force-dynamic";

const updateWorkspaceBodySchema = z
  .object({ name: nameSchema.optional(), slug: slugSchema.optional() })
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: "at least one of name or slug must be provided" });

type RouteParams = { params: Promise<{ organizationId: string; workspaceId: string }> };

/**
 * GET /api/organizations/{organizationId}/workspaces/{workspaceId}
 * Fetches one workspace — requires an explicit workspace membership;
 * organization membership alone (even owner/admin) is never sufficient.
 *
 * 200 response:
 * { "data": { "workspace": { "id": "...", "organizationId": "...", "name": "Marketing", "slug": "marketing", "deletedAt": null, "createdAt": "...", "updatedAt": "..." }, "membership": { "workspaceId": "...", "organizationId": "...", "userId": "...", "role": "member" } } }
 *
 * Errors: 401 unauthenticated, 404 not_found (nonexistent, soft-deleted, wrong parent organization in the URL, or no explicit workspace membership — identical in every case)
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, workspaceId: rawWorkspaceId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const workspaceId = parseUuidParam(rawWorkspaceId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const result = await getWorkspaceForUser(db, workspaceId, user.userId);
    // The URL claims this workspace belongs to `organizationId` — if it
    // actually belongs to a different organization, treat it exactly like
    // any other cross-tenant miss: 404, never reveal which org it's really in.
    if (result.workspace.organizationId !== organizationId) {
      throw new TenantResourceNotFoundError();
    }

    return jsonSuccess(result);
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * PATCH /api/organizations/{organizationId}/workspaces/{workspaceId}
 * Updates workspace name/slug. The workspace's manager, or an organization
 * owner/admin via the admin-override, may do this.
 *
 * Body: { "name"?: string, "slug"?: string } — at least one field required.
 *
 * 200 response:
 * { "data": { "id": "...", "organizationId": "...", "name": "Growth", "slug": "marketing", "deletedAt": null, "createdAt": "...", "updatedAt": "..." } }
 *
 * Errors:
 * 400 invalid_request
 * 401 unauthenticated
 * 403 forbidden — workspace member/viewer (not manager) attempting the update, with no admin-override available
 * 404 not_found — nonexistent workspace or wrong parent organization in the URL
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, workspaceId: rawWorkspaceId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const workspaceId = parseUuidParam(rawWorkspaceId);

    const env = loadEnv();
    const db = createDbClient(env);
    const rawSql = neon(env.DATABASE_URL);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, updateWorkspaceBodySchema);
    const workspace = await updateWorkspace(db, rawSql, {
      workspaceId,
      organizationId,
      actorUserId: user.userId,
      updates: body,
    });

    return jsonSuccess(workspace);
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * DELETE /api/organizations/{organizationId}/workspaces/{workspaceId}
 * Soft-deletes the workspace. No workspace role — not even manager — may
 * do this; only an organization owner or admin, via the admin-override.
 *
 * 204 response: empty body.
 *
 * Errors:
 * 401 unauthenticated
 * 404 not_found — nonexistent workspace or wrong parent organization in the URL
 * 409 workspace_deletion_not_permitted — anyone other than an org owner/admin, including the workspace's own manager
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, workspaceId: rawWorkspaceId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const workspaceId = parseUuidParam(rawWorkspaceId);

    const env = loadEnv();
    const db = createDbClient(env);
    const rawSql = neon(env.DATABASE_URL);
    const user = await getAuthenticatedUser(db);

    await softDeleteWorkspace(db, rawSql, { workspaceId, organizationId, actorUserId: user.userId });

    return new Response(null, { status: 204 });
  } catch (err) {
    return handleRouteError(err);
  }
}
