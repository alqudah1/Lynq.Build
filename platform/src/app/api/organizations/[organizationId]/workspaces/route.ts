import "server-only";
import { neon } from "@neondatabase/serverless";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, nameSchema, slugSchema } from "@/lib/http/validation";
import { createWorkspace, listWorkspacesForUser } from "@/lib/workspaces/workspaces";

export const dynamic = "force-dynamic";

const createWorkspaceBodySchema = z.object({ name: nameSchema, slug: slugSchema }).strict();

type RouteParams = { params: Promise<{ organizationId: string }> };

/**
 * GET /api/organizations/{organizationId}/workspaces
 * Lists workspaces within this organization that the authenticated user
 * holds an explicit workspace membership in — organization membership
 * alone never grants this list any entries.
 *
 * 200 response:
 * { "data": [ { "id": "...", "organizationId": "...", "name": "Marketing", "slug": "marketing", "role": "manager", "deletedAt": null, "createdAt": "...", "updatedAt": "..." } ] }
 *
 * Errors: 401 unauthenticated
 *
 * Note: this reuses `listWorkspacesForUser` (which already returns only
 * workspaces the caller has explicit membership in) and narrows the
 * result to this organizationId in the route handler — it does not
 * introduce any new unscoped query.
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const allWorkspaces = await listWorkspacesForUser(db, user.userId);
    const workspaces = allWorkspaces.filter((w) => w.organizationId === organizationId);

    return jsonSuccess(workspaces);
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * POST /api/organizations/{organizationId}/workspaces
 * Creates a workspace within the organization. Organization owners and
 * admins only; the creator becomes the workspace's first `manager`.
 *
 * Body: { "name": string (1-200 chars), "slug": string (lowercase, hyphenated, 1-100 chars) }
 *
 * 201 response:
 * { "data": { "workspace": { "id": "...", "organizationId": "...", "name": "Marketing", "slug": "marketing", "deletedAt": null, "createdAt": "...", "updatedAt": "..." }, "creatorMembership": { "workspaceId": "...", "organizationId": "...", "userId": "...", "role": "manager" } } }
 *
 * Errors:
 * 400 invalid_request
 * 401 unauthenticated
 * 403 forbidden — org member/viewer attempting to create a workspace
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

    const body = await parseJsonBody(request, createWorkspaceBodySchema);
    const result = await createWorkspace(db, rawSql, {
      organizationId,
      actorUserId: user.userId,
      name: body.name,
      slug: body.slug,
    });

    return jsonSuccess(result, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
