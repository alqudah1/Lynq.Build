import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { publishVariantNow } from "@/lib/social-os/content";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; variantId: string }> };

const bodySchema = z.object({ expectedRevision: z.number().int().min(1) }).strict();

/** POST /api/organizations/{organizationId}/social/variants/{variantId}/publish-now — publish an approved, scheduled or failed post now. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, variantId: rawVariant } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const contentVariantId = parseUuidParam(rawVariant);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, bodySchema);
    const variant = await publishVariantNow(db, { organizationId, contentVariantId, actorUserId: user.userId, expectedRevision: body.expectedRevision });
    return jsonSuccess(variant);
  } catch (err) {
    return handleRouteError(err);
  }
}
