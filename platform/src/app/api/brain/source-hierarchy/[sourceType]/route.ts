import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { sourceTypeSchema } from "@/lib/brain/validation";
import { getSourceDefinition } from "@/lib/brain/source-hierarchy";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ sourceType: string }> };

/**
 * GET /api/brain/source-hierarchy/{sourceType}
 * Retrieves one source type's hierarchy definition.
 *
 * 200 response: { "data": { "sourceType": "client_approved", "rank": 3, "label": "...", "description": "..." } }
 *
 * Errors: 400 invalid_request (not one of the nine approved source types), 401 unauthenticated
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { sourceType: rawSourceType } = await params;
    const sourceType = sourceTypeSchema.parse(rawSourceType);

    const env = loadEnv();
    const db = createDbClient(env);
    await getAuthenticatedUser(db);

    return jsonSuccess(getSourceDefinition(sourceType));
  } catch (err) {
    return handleRouteError(err);
  }
}
