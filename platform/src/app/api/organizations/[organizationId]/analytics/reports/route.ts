import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam, parseJsonBody } from "@/lib/http/validation";
import { createSavedReport, listSavedReports } from "@/lib/analytics-os/reports";
import { ANALYTICS_DATE_RANGE_STRATEGIES, ANALYTICS_TIME_GRAINS, ANALYTICS_VISUALIZATIONS, ANALYTICS_REPORT_VISIBILITIES, reportNameSchema } from "@/lib/analytics-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const createReportBodySchema = z
  .object({
    workspaceId: z.string().uuid().nullable().optional(),
    name: reportNameSchema,
    description: z.string().trim().max(2000).nullable().optional(),
    metricKeys: z.array(z.string().min(1)).min(1),
    dateRangeStrategy: z.enum(ANALYTICS_DATE_RANGE_STRATEGIES),
    customStartDate: z.coerce.date().nullable().optional(),
    customEndDate: z.coerce.date().nullable().optional(),
    comparisonEnabled: z.boolean(),
    timeGrain: z.enum(ANALYTICS_TIME_GRAINS),
    dimensions: z.array(z.string()).optional(),
    visualization: z.enum(ANALYTICS_VISUALIZATIONS),
    visibility: z.enum(ANALYTICS_REPORT_VISIBILITIES),
  })
  .strict();

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId");

    const reports = await listSavedReports(db, { organizationId, workspaceId, actorUserId: user.userId });
    return jsonSuccess({ reports });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const parsed = await parseJsonBody(request, createReportBodySchema);

    const report = await createSavedReport(db, {
      organizationId,
      workspaceId: parsed.workspaceId ?? null,
      actorUserId: user.userId,
      name: parsed.name,
      description: parsed.description ?? null,
      metricKeys: parsed.metricKeys,
      dateRangeStrategy: parsed.dateRangeStrategy,
      customStartDate: parsed.customStartDate ?? null,
      customEndDate: parsed.customEndDate ?? null,
      comparisonEnabled: parsed.comparisonEnabled,
      timeGrain: parsed.timeGrain,
      dimensions: parsed.dimensions,
      visualization: parsed.visualization,
      visibility: parsed.visibility,
    });
    return jsonSuccess(report, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
