import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { knowledgeListLimitSchema } from "@/lib/brain/validation";
import { authenticateAgentForRoute } from "@/lib/agents/route-helpers";
import { listKnowledgeItemVersionsForAgent } from "@/lib/agents/brain-reads";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ knowledgeItemId: string }> };

/**
 * GET /api/agent/brain/knowledge/{knowledgeItemId}/versions
 * Agent-authenticated. Version history for one item — never exposes
 * `createdByUserId`/`createdByAgentId` (see `listKnowledgeItemVersionsForAgent`'s
 * own comment).
 *
 * Query params: cursor?, limit?
 *
 * Errors: 400 invalid_request, 401 unauthenticated, 404 not_found, 429 rate_limited
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { knowledgeItemId: rawKnowledgeItemId } = await params;
    const knowledgeItemId = parseUuidParam(rawKnowledgeItemId);

    const env = loadEnv();
    const db = createDbClient(env);
    const principal = await authenticateAgentForRoute(db, request, "versions");

    const url = new URL(request.url);
    const query = z
      .object({ cursor: z.string().optional(), limit: knowledgeListLimitSchema.optional() })
      .parse({ cursor: url.searchParams.get("cursor") ?? undefined, limit: url.searchParams.get("limit") ?? undefined });

    const result = await listKnowledgeItemVersionsForAgent(db, principal, knowledgeItemId, { cursor: query.cursor ?? null, limit: query.limit });
    return jsonSuccess(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
