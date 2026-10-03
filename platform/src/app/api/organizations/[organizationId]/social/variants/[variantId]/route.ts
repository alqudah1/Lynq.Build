import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { getVariantForUser, updateVariant } from "@/lib/social-os/content";
import type { SocialVariantUpdate } from "@/lib/social-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; variantId: string }> };

// `changes` is validated (strictly, without applying defaults to absent keys) by the service.
const patchBodySchema = z.object({ expectedRevision: z.number().int().min(1), changes: z.record(z.string(), z.unknown()) }).strict();

/** GET /api/organizations/{organizationId}/social/variants/{variantId} */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, variantId: rawVariant } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const contentVariantId = parseUuidParam(rawVariant);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const variant = await getVariantForUser(db, { organizationId, contentVariantId, actorUserId: user.userId });
    return jsonSuccess(variant);
  } catch (err) {
    return handleRouteError(err);
  }
}

/** PATCH /api/organizations/{organizationId}/social/variants/{variantId} — editing a post awaiting review or approved sends it back to draft. */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, variantId: rawVariant } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const contentVariantId = parseUuidParam(rawVariant);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, patchBodySchema);
    const variant = await updateVariant(db, { organizationId, contentVariantId, actorUserId: user.userId, expectedRevision: body.expectedRevision, changes: body.changes as SocialVariantUpdate });
    return jsonSuccess(variant);
  } catch (err) {
    return handleRouteError(err);
  }
}
