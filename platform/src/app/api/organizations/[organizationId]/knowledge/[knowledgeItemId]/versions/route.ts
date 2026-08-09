import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { knowledgeListLimitSchema } from "@/lib/brain/validation";
import { listKnowledgeItemVersionsForUser } from "@/lib/brain/knowledge-item-versions";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; knowledgeItemId: string }> };

/**
 * GET /api/organizations/{organizationId}/knowledge/{knowledgeItemId}/versions
 * Lists a knowledge item's complete version history, newest first. Requires
 * the identical tenant/workspace authorization as the parent item. Bounded,
 * cursor-paginated (never offset-based) — never full-text or semantic
 * search.
 *
 * Query params: cursor?, limit? (default 20, max 100)
 *
 * 200 response:
 * { "data": { "versions": [ { "versionNumber": 2, "title": "...", "content": "...", "classification": "note", "createdByUserId": "...", "changeReason": "...", "createdAt": "...", "isCurrent": true } ], "nextCursor": "..." | null } }
 *
 * Errors: 400 invalid_request, 401 unauthenticated, 404 not_found (nonexistent, cross-tenant, or workspace-scoped without explicit workspace membership)
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, knowledgeItemId: rawKnowledgeItemId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const knowledgeItemId = parseUuidParam(rawKnowledgeItemId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const query = z
      .object({ cursor: z.string().optional(), limit: knowledgeListLimitSchema.optional() })
      .parse({ cursor: url.searchParams.get("cursor") ?? undefined, limit: url.searchParams.get("limit") ?? undefined });

    const result = await listKnowledgeItemVersionsForUser(db, {
      organizationId,
      knowledgeItemId,
      actorUserId: user.userId,
      cursor: query.cursor ?? null,
      limit: query.limit,
    });

    return jsonSuccess(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
