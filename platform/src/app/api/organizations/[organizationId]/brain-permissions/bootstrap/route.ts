import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { grantReasonSchema } from "@/lib/brain/validation";
import { bootstrapBrainPermissions } from "@/lib/brain/permissions";

export const dynamic = "force-dynamic";

// `z.preprocess` defaults a missing/empty request body to `{}` — every
// field here is optional, so "no body at all" (this route's common case)
// must be as valid as `{ "reason": "..." }`, unlike every other body
// schema in this module where `parseJsonBody`'s `undefined` fallback is
// meant to fail validation against required fields.
const bootstrapBodySchema = z.preprocess((value) => value ?? {}, z.object({ reason: grantReasonSchema.optional() }).strict());

type RouteParams = { params: Promise<{ organizationId: string }> };

/**
 * POST /api/organizations/{organizationId}/brain-permissions/bootstrap
 * The one-time "first real organization" onboarding operation ("Migration
 * from temporary authorization" — CRITICAL). Organization owner only.
 * Grants the invoking owner all eight Brain capabilities across all eight
 * domains, organization-scoped — a real, individually-revocable set of
 * rows, never a standing implicit override — so they can immediately use
 * and delegate Brain access from a cold start. Refuses if this
 * organization already has ANY grant (bootstrapped or otherwise); this is
 * strictly a one-time operation per organization.
 *
 * Body: { "reason"?: string }
 *
 * 201 response: { "data": [ { "id": "...", "domain": "identity", "capability": "read", ... }, ... ] } — 64 rows (8 domains × 8 capabilities)
 *
 * Errors: 400 invalid_request, 401 unauthenticated, 403 forbidden — not an organization owner, 404 not_found, 409 bootstrap_already_completed
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, bootstrapBodySchema);

    const grants = await bootstrapBrainPermissions(db, { organizationId, actorUserId: user.userId, reason: body.reason ?? null });

    return jsonSuccess(grants, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
