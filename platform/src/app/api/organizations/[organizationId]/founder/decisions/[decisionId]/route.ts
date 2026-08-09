import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam, parseJsonBody } from "@/lib/http/validation";
import { updateFounderDecision } from "@/lib/founder-os/decisions";
import { FOUNDER_DECISION_STATUSES, titleSchema, decisionTextSchema } from "@/lib/founder-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; decisionId: string }> };

const updateBodySchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    title: titleSchema.optional(),
    decision: decisionTextSchema.optional(),
    contextSummary: z.string().trim().max(4000).nullable().optional(),
    status: z.enum(FOUNDER_DECISION_STATUSES).optional(),
    reviewDate: z.coerce.date().nullable().optional(),
  })
  .strict();

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, decisionId: rawDecision } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const decisionId = parseUuidParam(rawDecision);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, updateBodySchema);
    const decision = await updateFounderDecision(db, { organizationId, decisionId, actorUserId: user.userId, ...body });
    return jsonSuccess(decision);
  } catch (err) {
    return handleRouteError(err);
  }
}
