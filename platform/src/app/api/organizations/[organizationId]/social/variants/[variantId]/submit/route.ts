import "server-only";
import { after } from "next/server";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { submitVariantForReview } from "@/lib/social-os/content";
import { loadTelegramEnv, notifyTelegramOfReview } from "@/lib/social-os/telegram";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; variantId: string }> };

const bodySchema = z.object({ expectedRevision: z.number().int().min(1), summary: z.string().trim().max(2000).optional() }).strict();

/** POST /api/organizations/{organizationId}/social/variants/{variantId}/submit — submit a draft for human review (creates the approval request). */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, variantId: rawVariant } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const contentVariantId = parseUuidParam(rawVariant);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, bodySchema);
    const variant = await submitVariantForReview(db, { organizationId, contentVariantId, actorUserId: user.userId, expectedRevision: body.expectedRevision, summary: body.summary });
    after(() => notifyTelegramOfReview(db, loadTelegramEnv(), { organizationId, contentVariantId }));
    return jsonSuccess(variant);
  } catch (err) {
    return handleRouteError(err);
  }
}
