import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { computeExecutiveAgentsView } from "@/lib/founder-os/agents-view";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

/** GET /api/organizations/{organizationId}/founder/agents — AI Workforce view: registered agents with real per-agent execution/artifact counts. No hidden reasoning, no credential values. */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const view = await computeExecutiveAgentsView(db, { organizationId, actorUserId: user.userId });
    return jsonSuccess(view);
  } catch (err) {
    return handleRouteError(err);
  }
}
