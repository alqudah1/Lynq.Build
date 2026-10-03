import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { regenerateVariantPart } from "@/lib/social-os/studio";
import { socialRegeneratePartSchema } from "@/lib/social-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; variantId: string }> };

const bodySchema = z.object({ part: socialRegeneratePartSchema, instruction: z.string().trim().max(1000).optional() }).strict();

/** POST /api/organizations/{organizationId}/social/variants/{variantId}/regenerate { part, instruction? } — 202 when a video render was started in the background. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, variantId: rawVariant } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const contentVariantId = parseUuidParam(rawVariant);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, bodySchema);
    const result = await regenerateVariantPart(db, { organizationId, contentVariantId, actorUserId: user.userId, part: body.part, instruction: body.instruction });
    return jsonSuccess(result, result.pending ? 202 : 200);
  } catch (err) {
    return handleRouteError(err);
  }
}
