import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { archiveAutomationRule } from "@/lib/social-os/automation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; ruleId: string }> };

const bodySchema = z.object({ expectedRevision: z.number().int().min(1) }).strict();

/** POST /api/organizations/{organizationId}/social/automation/{ruleId}/archive */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, ruleId: rawRuleId } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const ruleId = parseUuidParam(rawRuleId);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, bodySchema);
    const rule = await archiveAutomationRule(db, { organizationId, ruleId, actorUserId: user.userId, expectedRevision: body.expectedRevision });
    return jsonSuccess(rule);
  } catch (err) {
    return handleRouteError(err);
  }
}
