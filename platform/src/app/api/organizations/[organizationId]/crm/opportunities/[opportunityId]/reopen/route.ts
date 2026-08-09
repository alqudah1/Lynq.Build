import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { reopenOpportunity } from "@/lib/crm/opportunities";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ expectedRevision: z.number().int().min(1), targetStageId: uuidParam }).strict();

type RouteParams = { params: Promise<{ organizationId: string; opportunityId: string }> };

/** POST /api/organizations/{organizationId}/crm/opportunities/{opportunityId}/reopen — the one explicit door back to `open` from `won`/`lost`; never happens implicitly via /move. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, opportunityId: rawOpportunityId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const opportunityId = parseUuidParam(rawOpportunityId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, bodySchema);
    const opportunity = await reopenOpportunity(db, { organizationId, opportunityId, actorUserId: user.userId, ...body });
    return jsonSuccess(opportunity);
  } catch (err) {
    return handleRouteError(err);
  }
}
