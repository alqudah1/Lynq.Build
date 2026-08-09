import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { sourceTypeSchema } from "@/lib/brain/validation";
import { resolveSourceOrdering } from "@/lib/brain/source-hierarchy";

export const dynamic = "force-dynamic";

/**
 * GET /api/brain/source-hierarchy/compare?a={sourceType}&b={sourceType}
 * Compares two source types' rank and resolves deterministic ordering
 * between them (`compareSourceRanks` + `resolveSourceOrdering` combined
 * into one response, since a client asking "which wins" always wants both).
 * Pure, static comparison — never conflict resolution: no Trust tier,
 * Evidence, or anything situational is considered.
 *
 * Query params: a=sourceType, b=sourceType (both required)
 *
 * 200 response:
 * { "data": { "a": { "sourceType": "client_approved", "rank": 3, ... }, "b": { "sourceType": "external_research", "rank": 7, ... }, "comparison": "higher", "winner": { "sourceType": "client_approved", ... } } }
 *
 * Errors: 400 invalid_request, 401 unauthenticated
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = z.object({ a: sourceTypeSchema, b: sourceTypeSchema }).parse({
      a: url.searchParams.get("a") ?? undefined,
      b: url.searchParams.get("b") ?? undefined,
    });

    const env = loadEnv();
    const db = createDbClient(env);
    await getAuthenticatedUser(db);

    return jsonSuccess(resolveSourceOrdering(query.a, query.b));
  } catch (err) {
    return handleRouteError(err);
  }
}
