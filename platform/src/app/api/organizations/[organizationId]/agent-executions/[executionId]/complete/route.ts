import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { authenticateAgentForExecutionRoute } from "@/lib/agent-runtime/route-helpers";
import { completeExecution } from "@/lib/agent-runtime/lifecycle";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; executionId: string }> };

/** POST .../{executionId}/complete — agent-authenticated. `verifying -> completed`, gated on objective completion evidence (every current-plan step resolved) — never the agent's own narrative claim alone. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, executionId: rawExecutionId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const executionId = parseUuidParam(rawExecutionId);

    const env = loadEnv();
    const db = createDbClient(env);
    const principal = await authenticateAgentForExecutionRoute(db, request, organizationId);

    const execution = await completeExecution(db, { organizationId, executionId, actorAgentId: principal.agentId });
    return jsonSuccess(execution);
  } catch (err) {
    return handleRouteError(err);
  }
}
