import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam, parseJsonBody } from "@/lib/http/validation";
import { getSavedReport, updateSavedReport, deleteSavedReport, runSavedReport } from "@/lib/analytics-os/reports";
import { ANALYTICS_DATE_RANGE_STRATEGIES, ANALYTICS_TIME_GRAINS, ANALYTICS_VISUALIZATIONS, ANALYTICS_REPORT_VISIBILITIES, reportNameSchema } from "@/lib/analytics-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; reportId: string }> };

const updateReportBodySchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    name: reportNameSchema.optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    metricKeys: z.array(z.string().min(1)).min(1).optional(),
    dateRangeStrategy: z.enum(ANALYTICS_DATE_RANGE_STRATEGIES).optional(),
    customStartDate: z.coerce.date().nullable().optional(),
    customEndDate: z.coerce.date().nullable().optional(),
    comparisonEnabled: z.boolean().optional(),
    timeGrain: z.enum(ANALYTICS_TIME_GRAINS).optional(),
    dimensions: z.array(z.string()).optional(),
    visualization: z.enum(ANALYTICS_VISUALIZATIONS).optional(),
    visibility: z.enum(ANALYTICS_REPORT_VISIBILITIES).optional(),
  })
  .strict();

/** GET .../reports/{reportId}?run=true — without `run`, returns the report's own definition; with it, also executes the report through the query engine and records `analytics_report_viewed`. */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, reportId: rawReport } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const reportId = parseUuidParam(rawReport);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    if (url.searchParams.get("run") === "true") {
      const { report, result } = await runSavedReport(db, { organizationId, actorUserId: user.userId, reportId });
      return jsonSuccess({ report, result });
    }

    const report = await getSavedReport(db, { organizationId, actorUserId: user.userId, reportId });
    return jsonSuccess(report);
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, reportId: rawReport } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const reportId = parseUuidParam(rawReport);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const parsed = await parseJsonBody(request, updateReportBodySchema);
    const report = await updateSavedReport(db, { organizationId, actorUserId: user.userId, reportId, ...parsed });
    return jsonSuccess(report);
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, reportId: rawReport } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const reportId = parseUuidParam(rawReport);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    await deleteSavedReport(db, { organizationId, actorUserId: user.userId, reportId });
    return jsonSuccess({ deleted: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
