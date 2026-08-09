import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { knowledgeDomainSchema } from "@/lib/brain/validation";
import { getDomain } from "@/lib/brain/domains";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ domain: string }> };

/**
 * GET /api/brain/domains/{domain}
 * Retrieves one domain's management metadata.
 *
 * 200 response: { "data": { "domain": "governance", "description": "...", "sortOrder": 6, "ownerDepartment": null, "isRetired": false, "retiredAt": null } }
 *
 * Errors: 400 invalid_request (not one of the eight canonical domains), 401 unauthenticated
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { domain: rawDomain } = await params;
    const domain = knowledgeDomainSchema.parse(rawDomain);

    const env = loadEnv();
    const db = createDbClient(env);
    await getAuthenticatedUser(db);

    return jsonSuccess(await getDomain(db, domain));
  } catch (err) {
    return handleRouteError(err);
  }
}
