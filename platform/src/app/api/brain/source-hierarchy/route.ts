import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { listSourceHierarchy } from "@/lib/brain/source-hierarchy";

export const dynamic = "force-dynamic";

/**
 * GET /api/brain/source-hierarchy
 * Lists the full nine-tier Source Hierarchy (`marketing/LYNQ_BRAIN.md` §7),
 * in rank order. Fixed, immutable, company-wide reference data — not
 * organization-scoped, so this route deliberately lives outside
 * `/api/organizations/{organizationId}/...`. Any authenticated user may
 * read it; there is nothing tenant-specific to protect.
 *
 * 200 response:
 * { "data": [ { "sourceType": "founder_decision", "rank": 1, "label": "Founder decisions", "description": "..." }, ... ] }
 *
 * Errors: 401 unauthenticated
 */
export async function GET() {
  try {
    const env = loadEnv();
    const db = createDbClient(env);
    await getAuthenticatedUser(db);

    return jsonSuccess(listSourceHierarchy());
  } catch (err) {
    return handleRouteError(err);
  }
}
