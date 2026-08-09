import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { knowledgeListLimitSchema, relationshipTypeSchema } from "@/lib/brain/validation";
import { authenticateAgentForRoute } from "@/lib/agents/route-helpers";
import { listRelationshipsForAgent } from "@/lib/agents/brain-reads";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ knowledgeItemId: string }> };

/**
 * GET /api/agent/brain/knowledge/{knowledgeItemId}/relationships
 * Agent-authenticated. Direct edges anchored at this item — never a
 * multi-hop graph traversal. A relationship whose other endpoint is
 * outside this agent's readable grant scopes is simply absent from the
 * result, never a redacted row (§7's rule, extended to agent readers).
 *
 * Query params: direction? ("outgoing"|"incoming"|"both", default "both"), relationshipType?, status? ("active"|"archived", default "active"), cursor?, limit?
 *
 * Errors: 400 invalid_request, 401 unauthenticated, 404 not_found, 429 rate_limited
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { knowledgeItemId: rawKnowledgeItemId } = await params;
    const knowledgeItemId = parseUuidParam(rawKnowledgeItemId);

    const env = loadEnv();
    const db = createDbClient(env);
    const principal = await authenticateAgentForRoute(db, request, "relationships");

    const url = new URL(request.url);
    const query = z
      .object({
        direction: z.enum(["outgoing", "incoming", "both"]).optional(),
        relationshipType: relationshipTypeSchema.optional(),
        status: z.enum(["active", "archived"]).optional(),
        cursor: z.string().optional(),
        limit: knowledgeListLimitSchema.optional(),
      })
      .parse({
        direction: url.searchParams.get("direction") ?? undefined,
        relationshipType: url.searchParams.get("relationshipType") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
        cursor: url.searchParams.get("cursor") ?? undefined,
        limit: url.searchParams.get("limit") ?? undefined,
      });

    const result = await listRelationshipsForAgent(db, principal, knowledgeItemId, {
      direction: query.direction,
      relationshipType: query.relationshipType,
      status: query.status,
      cursor: query.cursor ?? null,
      limit: query.limit,
    });
    return jsonSuccess(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
