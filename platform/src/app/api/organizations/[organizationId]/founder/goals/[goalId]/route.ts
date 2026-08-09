import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam, parseJsonBody } from "@/lib/http/validation";
import { updateFounderGoal } from "@/lib/founder-os/goals";
import { FOUNDER_GOAL_STATUSES, titleSchema } from "@/lib/founder-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; goalId: string }> };

const updateBodySchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    title: titleSchema.optional(),
    targetValue: z.number().optional(),
    status: z.enum(FOUNDER_GOAL_STATUSES).optional(),
  })
  .strict();

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, goalId: rawGoal } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const goalId = parseUuidParam(rawGoal);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, updateBodySchema);
    const goal = await updateFounderGoal(db, { organizationId, goalId, actorUserId: user.userId, ...body });
    return jsonSuccess(goal);
  } catch (err) {
    return handleRouteError(err);
  }
}
