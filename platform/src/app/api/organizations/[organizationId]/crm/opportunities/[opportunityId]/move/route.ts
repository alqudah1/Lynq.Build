import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { moveOpportunityStage } from "@/lib/crm/opportunities";
import { crmBoundedTextSchema } from "@/lib/crm/validation";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ expectedRevision: z.number().int().min(1), targetStageId: uuidParam, lostReason: crmBoundedTextSchema.optional() }).strict();

type RouteParams = { params: Promise<{ organizationId: string; opportunityId: string }> };

/** POST /api/organizations/{organizationId}/crm/opportunities/{opportunityId}/move — moves an OPEN opportunity to a new stage in the same pipeline; refuses to operate on an already-closed opportunity (use /reopen first). */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, opportunityId: rawOpportunityId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const opportunityId = parseUuidParam(rawOpportunityId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, bodySchema);
    const opportunity = await moveOpportunityStage(db, { organizationId, opportunityId, actorUserId: user.userId, ...body });
    return jsonSuccess(opportunity);
  } catch (err) {
    return handleRouteError(err);
  }
}
