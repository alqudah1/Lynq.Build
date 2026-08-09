import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { createOpportunity, listOpportunitiesForUser } from "@/lib/crm/opportunities";
import { crmNameSchema, crmAmountSchema, crmCurrencySchema, crmProbabilitySchema, crmOpportunityStatusSchema, crmIdempotencyKeySchema } from "@/lib/crm/validation";

export const dynamic = "force-dynamic";

const createOpportunityBodySchema = z
  .object({
    workspaceId: uuidParam.optional(),
    pipelineId: uuidParam,
    stageId: uuidParam,
    name: crmNameSchema,
    primaryContactId: uuidParam.optional(),
    companyId: uuidParam.optional(),
    ownerUserId: uuidParam.optional(),
    amount: crmAmountSchema.optional(),
    currency: crmCurrencySchema.optional(),
    expectedCloseDate: z.coerce.date().optional(),
    probabilityOverride: crmProbabilitySchema.optional(),
    sourceId: uuidParam.optional(),
    idempotencyKey: crmIdempotencyKeySchema.optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string }> };

/** GET /api/organizations/{organizationId}/crm/opportunities — query params: workspaceId?, pipelineId?, stageId?, status?, ownerUserId?, companyId?, limit? */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const query = z
      .object({
        workspaceId: uuidParam.optional(),
        pipelineId: uuidParam.optional(),
        stageId: uuidParam.optional(),
        status: crmOpportunityStatusSchema.optional(),
        ownerUserId: uuidParam.optional(),
        companyId: uuidParam.optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      })
      .parse({
        workspaceId: url.searchParams.get("workspaceId") ?? undefined,
        pipelineId: url.searchParams.get("pipelineId") ?? undefined,
        stageId: url.searchParams.get("stageId") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
        ownerUserId: url.searchParams.get("ownerUserId") ?? undefined,
        companyId: url.searchParams.get("companyId") ?? undefined,
        limit: url.searchParams.get("limit") ?? undefined,
      });

    const opportunities = await listOpportunitiesForUser(db, { organizationId, actorUserId: user.userId, ...query });
    return jsonSuccess({ opportunities });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/crm/opportunities */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createOpportunityBodySchema);
    const opportunity = await createOpportunity(db, { organizationId, actorUserId: user.userId, ...body });

    return jsonSuccess(opportunity, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
