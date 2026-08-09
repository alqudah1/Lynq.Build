import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { authenticateAgentForExecutionRoute } from "@/lib/agent-runtime/route-helpers";
import { advanceExecution } from "@/lib/agent-runtime/lifecycle";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    toStatus: z.enum(["planning", "reasoning", "waiting", "executing", "delegating", "human_approval", "verifying"]),
    waitReason: z.string().trim().max(200).optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string; executionId: string }> };

/** POST .../{executionId}/advance — agent-authenticated. The assigned agent's own progression through §1's Planning/Reasoning/Executing/Waiting/Delegating/HumanApproval/Verifying states, validated against the exact diagram adjacency. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, executionId: rawExecutionId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const executionId = parseUuidParam(rawExecutionId);

    const env = loadEnv();
    const db = createDbClient(env);
    const principal = await authenticateAgentForExecutionRoute(db, request, organizationId);
    const body = await parseJsonBody(request, bodySchema);

    const execution = await advanceExecution(db, { organizationId, executionId, toStatus: body.toStatus, waitReason: body.waitReason ?? null, actorAgentId: principal.agentId });
    return jsonSuccess(execution);
  } catch (err) {
    return handleRouteError(err);
  }
}
