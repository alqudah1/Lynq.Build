import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { computeFounderGoalProgress } from "@/lib/founder-os/goals";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; goalId: string }> };

/** GET — current value always derived live from Analytics OS, never stored on the goal. */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, goalId: rawGoal } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const goalId = parseUuidParam(rawGoal);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const progress = await computeFounderGoalProgress(db, { organizationId, goalId, actorUserId: user.userId });
    return jsonSuccess(progress);
  } catch (err) {
    return handleRouteError(err);
  }
}
