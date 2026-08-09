import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { getOpportunityForUser, updateOpportunity } from "@/lib/crm/opportunities";
import { crmNameSchema, crmAmountSchema, crmCurrencySchema, crmProbabilitySchema } from "@/lib/crm/validation";

export const dynamic = "force-dynamic";

const updateOpportunityBodySchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    name: crmNameSchema.optional(),
    primaryContactId: uuidParam.nullable().optional(),
    companyId: uuidParam.nullable().optional(),
    ownerUserId: uuidParam.nullable().optional(),
    amount: crmAmountSchema.nullable().optional(),
    currency: crmCurrencySchema.nullable().optional(),
    expectedCloseDate: z.coerce.date().nullable().optional(),
    probabilityOverride: crmProbabilitySchema.nullable().optional(),
    sourceId: uuidParam.nullable().optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string; opportunityId: string }> };

/** GET /api/organizations/{organizationId}/crm/opportunities/{opportunityId} */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, opportunityId: rawOpportunityId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const opportunityId = parseUuidParam(rawOpportunityId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const opportunity = await getOpportunityForUser(db, { organizationId, opportunityId, actorUserId: user.userId });
    return jsonSuccess(opportunity);
  } catch (err) {
    return handleRouteError(err);
  }
}

/** PATCH /api/organizations/{organizationId}/crm/opportunities/{opportunityId} — field update only; use /move and /reopen for stage/status transitions. */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, opportunityId: rawOpportunityId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const opportunityId = parseUuidParam(rawOpportunityId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, updateOpportunityBodySchema);
    const updated = await updateOpportunity(db, { organizationId, opportunityId, actorUserId: user.userId, ...body });
    return jsonSuccess(updated);
  } catch (err) {
    return handleRouteError(err);
  }
}
