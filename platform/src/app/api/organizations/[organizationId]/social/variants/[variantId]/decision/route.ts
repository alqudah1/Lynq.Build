import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { decideVariantApproval } from "@/lib/social-os/content";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; variantId: string }> };

const bodySchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    decision: z.enum(["approve", "request_changes", "reject"]),
    note: z.string().trim().max(2000).optional(),
    scheduledFor: z.coerce.date().nullable().optional(),
    publishNow: z.boolean().optional(),
  })
  .strict();

/** POST /api/organizations/{organizationId}/social/variants/{variantId}/decision — approve (optionally schedule / publish now), request changes, or reject. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, variantId: rawVariant } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const contentVariantId = parseUuidParam(rawVariant);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, bodySchema);
    const variant = await decideVariantApproval(db, { organizationId, contentVariantId, actorUserId: user.userId, expectedRevision: body.expectedRevision, decision: body.decision, note: body.note, scheduledFor: body.scheduledFor, publishNow: body.publishNow });
    return jsonSuccess(variant);
  } catch (err) {
    return handleRouteError(err);
  }
}
