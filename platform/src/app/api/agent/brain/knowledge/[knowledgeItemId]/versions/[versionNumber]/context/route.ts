import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { authenticateAgentForRoute } from "@/lib/agents/route-helpers";
import { getKnowledgeContextForAgent } from "@/lib/agents/brain-reads";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ knowledgeItemId: string; versionNumber: string }> };

const versionNumberSchema = z.coerce.number().int().min(1);

/**
 * GET /api/agent/brain/knowledge/{knowledgeItemId}/versions/{versionNumber}/context
 * Agent-authenticated. The citation-ready bundle: item identity, the
 * requested version's title/content/classification, lifecycle status,
 * source metadata, trust metadata, evidence references, relationship
 * references, organization/workspace scope, and a retrieval timestamp —
 * exactly the field list this endpoint is specified against, nothing
 * more. A deterministic lookup only: no ranking, no synthesis, no
 * generated reasoning.
 *
 * Errors: 400 invalid_request, 401 unauthenticated, 404 not_found, 429 rate_limited
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { knowledgeItemId: rawKnowledgeItemId, versionNumber: rawVersionNumber } = await params;
    const knowledgeItemId = parseUuidParam(rawKnowledgeItemId);
    const versionNumber = versionNumberSchema.parse(rawVersionNumber);

    const env = loadEnv();
    const db = createDbClient(env);
    const principal = await authenticateAgentForRoute(db, request, "context");

    const context = await getKnowledgeContextForAgent(db, principal, knowledgeItemId, versionNumber);
    return jsonSuccess(context);
  } catch (err) {
    return handleRouteError(err);
  }
}
