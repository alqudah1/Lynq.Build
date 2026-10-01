import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { runAutomationRuleNow } from "@/lib/social-os/automation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; ruleId: string }> };

/** POST /api/organizations/{organizationId}/social/automation/{ruleId}/run — queue a run now. */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, ruleId: rawRuleId } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const ruleId = parseUuidParam(rawRuleId);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const job = await runAutomationRuleNow(db, { organizationId, ruleId, actorUserId: user.userId });
    return jsonSuccess(job, 202);
  } catch (err) {
    return handleRouteError(err);
  }
}
