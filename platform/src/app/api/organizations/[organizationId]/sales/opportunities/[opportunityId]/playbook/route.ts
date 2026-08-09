import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { startOpportunityPlaybookRun, listOpportunityPlaybookRunsForOpportunity } from "@/lib/sales-os/opportunity-playbooks";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; opportunityId: string }> };

const startRunBodySchema = z.object({ playbookVersionId: z.string().uuid().optional() }).strict();

/** GET /api/organizations/{organizationId}/sales/opportunities/{opportunityId}/playbook */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, opportunityId: rawOpp } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const opportunityId = parseUuidParam(rawOpp);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const runs = await listOpportunityPlaybookRunsForOpportunity(db, { organizationId, opportunityId, actorUserId: user.userId });
    return jsonSuccess({ runs });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/sales/opportunities/{opportunityId}/playbook — starts a new opportunity playbook run. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, opportunityId: rawOpp } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const opportunityId = parseUuidParam(rawOpp);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, startRunBodySchema);
    const result = await startOpportunityPlaybookRun(db, { organizationId, opportunityId, playbookVersionId: body.playbookVersionId, actorUserId: user.userId });
    return jsonSuccess(result, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
