import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { listDomains } from "@/lib/brain/domains";

export const dynamic = "force-dynamic";

/**
 * GET /api/brain/domains
 * Lists the eight fixed Brain domains' management metadata, in display
 * order. Global, read-only reference data — not organization-scoped, so
 * this route deliberately lives outside `/api/organizations/{organizationId}/...`,
 * matching Brain Module 5's identical precedent for the Source Hierarchy.
 *
 * 200 response:
 * { "data": [ { "domain": "identity", "description": "...", "sortOrder": 1, "ownerDepartment": null, "isRetired": false, "retiredAt": null } ] }
 *
 * Errors: 401 unauthenticated
 */
export async function GET() {
  try {
    const env = loadEnv();
    const db = createDbClient(env);
    await getAuthenticatedUser(db);

    return jsonSuccess(await listDomains(db));
  } catch (err) {
    return handleRouteError(err);
  }
}
