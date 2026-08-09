import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { getSalesConfiguration, upsertSalesConfiguration } from "@/lib/sales-os/configuration";
import { salesLeadAssignmentStrategySchema } from "@/lib/sales-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const updateConfigBodySchema = z
  .object({
    workspaceId: z.string().uuid().nullable().optional(),
    expectedRevision: z.number().int().min(1).optional(),
    businessTimezone: z.string().trim().min(1).max(100).optional(),
    currency: z.string().trim().length(3).toUpperCase().optional(),
    defaultLeadAssignmentStrategy: salesLeadAssignmentStrategySchema.optional(),
    staleLeadThresholdDays: z.number().int().min(1).max(365).optional(),
    staleOpportunityThresholdDays: z.number().int().min(1).max(365).optional(),
  })
  .strict();

/** GET /api/organizations/{organizationId}/sales/config?workspaceId= */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId");

    const config = await getSalesConfiguration(db, { organizationId, workspaceId, actorUserId: user.userId });
    return jsonSuccess({ config });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** PATCH /api/organizations/{organizationId}/sales/config */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, updateConfigBodySchema);
    const { workspaceId, ...updates } = body;
    const config = await upsertSalesConfiguration(db, { organizationId, workspaceId: workspaceId ?? null, actorUserId: user.userId, ...updates });
    return jsonSuccess(config);
  } catch (err) {
    return handleRouteError(err);
  }
}
