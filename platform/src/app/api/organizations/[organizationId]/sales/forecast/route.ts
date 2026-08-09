import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { computeForecast } from "@/lib/sales-os/forecasting";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

/** GET /api/organizations/{organizationId}/sales/forecast?pipelineId=&periodStart=&periodEnd= — deterministic pipeline math; `weightedPipelineValueEstimate` is always labeled an estimate, never guaranteed revenue. */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const pipelineId = url.searchParams.get("pipelineId") ?? undefined;
    const periodStartRaw = url.searchParams.get("periodStart");
    const periodEndRaw = url.searchParams.get("periodEnd");

    const forecast = await computeForecast(db, {
      organizationId,
      pipelineId,
      periodStart: periodStartRaw ? new Date(periodStartRaw) : undefined,
      periodEnd: periodEndRaw ? new Date(periodEndRaw) : undefined,
      actorUserId: user.userId,
    });
    return jsonSuccess(forecast);
  } catch (err) {
    return handleRouteError(err);
  }
}
