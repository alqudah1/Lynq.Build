import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { createSalesTarget, listSalesTargets } from "@/lib/sales-os/targets";
import { salesTargetScopeTypeSchema, salesTargetMetricTypeSchema } from "@/lib/sales-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const createTargetBodySchema = z
  .object({
    workspaceId: z.string().uuid().optional(),
    scopeType: salesTargetScopeTypeSchema,
    userId: z.string().uuid().optional(),
    teamId: z.string().uuid().optional(),
    metricType: salesTargetMetricTypeSchema,
    periodStart: z.coerce.date(),
    periodEnd: z.coerce.date(),
    targetValue: z.number().min(0),
  })
  .strict();

/** GET /api/organizations/{organizationId}/sales/targets?scopeType=&userId=&teamId= */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const scopeType = salesTargetScopeTypeSchema.optional().parse(url.searchParams.get("scopeType") ?? undefined);
    const userId = url.searchParams.get("userId") ?? undefined;
    const teamId = url.searchParams.get("teamId") ?? undefined;

    const targets = await listSalesTargets(db, { organizationId, scopeType, userId, teamId, actorUserId: user.userId });
    return jsonSuccess({ targets });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/sales/targets */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createTargetBodySchema);
    const target = await createSalesTarget(db, { organizationId, actorUserId: user.userId, ...body });
    return jsonSuccess(target, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
