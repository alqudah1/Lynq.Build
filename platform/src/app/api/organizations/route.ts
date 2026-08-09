import "server-only";
import { neon } from "@neondatabase/serverless";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, nameSchema, slugSchema } from "@/lib/http/validation";
import { createOrganization, listOrganizationsForUser } from "@/lib/organizations/organizations";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createOrganizationBodySchema = z.object({ name: nameSchema, slug: slugSchema }).strict();

/**
 * GET /api/organizations
 * List every organization the authenticated user belongs to.
 *
 * Auth: required.
 * Query params: none.
 *
 * 200 response:
 * { "data": [ { "id": "...", "name": "Acme", "slug": "acme", "role": "owner", "deletedAt": null, "createdAt": "...", "updatedAt": "..." } ] }
 */
export async function GET() {
  try {
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const organizations = await listOrganizationsForUser(db, user.userId);
    return jsonSuccess(organizations);
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * POST /api/organizations
 * Creates a new organization with the authenticated user as its first owner.
 *
 * Auth: required (any authenticated user may create an organization).
 * Body: { "name": string (1-200 chars), "slug": string (lowercase, hyphenated, 1-100 chars) }
 *
 * 201 response:
 * { "data": { "organization": { "id": "...", "name": "Acme", "slug": "acme", "deletedAt": null, "createdAt": "...", "updatedAt": "..." }, "ownerMembership": { "organizationId": "...", "userId": "...", "role": "owner" } } }
 *
 * Errors:
 * 400 invalid_request — missing/invalid name or slug
 * 401 unauthenticated — no valid session
 */
export async function POST(request: Request) {
  try {
    const env = loadEnv();
    const db = createDbClient(env);
    const rawSql = neon(env.DATABASE_URL);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createOrganizationBodySchema);
    const result = await createOrganization(rawSql, { name: body.name, slug: body.slug, ownerUserId: user.userId });

    return jsonSuccess(result, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
