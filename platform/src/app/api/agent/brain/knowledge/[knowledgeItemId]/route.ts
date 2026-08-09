import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { authenticateAgentForRoute } from "@/lib/agents/route-helpers";
import { getKnowledgeItemForAgent } from "@/lib/agents/brain-reads";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ knowledgeItemId: string }> };

/**
 * GET /api/agent/brain/knowledge/{knowledgeItemId}
 * Agent-authenticated. 404 (never 403) for every failure mode — cross-
 * tenant, nonexistent, and missing-`read`-grant are indistinguishable,
 * the identical discipline the human read path uses.
 *
 * Errors: 400 invalid_request, 401 unauthenticated, 404 not_found, 429 rate_limited
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { knowledgeItemId: rawKnowledgeItemId } = await params;
    const knowledgeItemId = parseUuidParam(rawKnowledgeItemId);

    const env = loadEnv();
    const db = createDbClient(env);
    const principal = await authenticateAgentForRoute(db, request, "get");

    const item = await getKnowledgeItemForAgent(db, principal, knowledgeItemId);
    return jsonSuccess(item);
  } catch (err) {
    return handleRouteError(err);
  }
}
