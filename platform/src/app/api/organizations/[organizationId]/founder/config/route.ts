import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam, parseJsonBody } from "@/lib/http/validation";
import { resolveEffectiveFounderConfiguration, upsertFounderWorkspaceConfiguration } from "@/lib/founder-os/configuration";
import { ANALYTICS_DATE_RANGE_STRATEGIES } from "@/lib/analytics-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const querySchema = z.object({ workspaceId: z.string().uuid().optional() });

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const parsed = querySchema.parse(Object.fromEntries(url.searchParams));

    const config = await resolveEffectiveFounderConfiguration(db, { organizationId, workspaceId: parsed.workspaceId ?? null, actorUserId: user.userId });
    return jsonSuccess(config);
  } catch (err) {
    return handleRouteError(err);
  }
}

const updateBodySchema = z
  .object({
    workspaceId: z.string().uuid().nullable().optional(),
    visibleKpiGroups: z.array(z.string()).optional(),
    widgetOrder: z.array(z.string()).optional(),
    selectedSavedReportIds: z.array(z.string().uuid()).optional(),
    defaultDateRangeStrategy: z.enum(ANALYTICS_DATE_RANGE_STRATEGIES).optional(),
    defaultWorkspaceId: z.string().uuid().nullable().optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
  })
  .strict();

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, updateBodySchema);
    const config = await upsertFounderWorkspaceConfiguration(db, { organizationId, actorUserId: user.userId, ...body });
    return jsonSuccess(config);
  } catch (err) {
    return handleRouteError(err);
  }
}
