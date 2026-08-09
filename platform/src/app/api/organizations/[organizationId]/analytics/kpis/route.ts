import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { computeExecutiveKpis } from "@/lib/analytics-os/kpis";
import { ANALYTICS_DATE_RANGE_STRATEGIES } from "@/lib/analytics-os/validation";
import { COMPARISON_STRATEGIES } from "@/lib/analytics-os/time";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const querySchema = z.object({
  workspaceId: z.string().uuid().optional(),
  dateRangeStrategy: z.enum(ANALYTICS_DATE_RANGE_STRATEGIES).optional(),
  comparisonStrategy: z.enum(COMPARISON_STRATEGIES).optional(),
});

/** GET /api/organizations/{organizationId}/analytics/kpis — the curated executive KPI groups (Growth/Sales/Marketing/Delivery/Operations/Communications/AI), each metric independently authorized. */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const parsed = querySchema.parse(Object.fromEntries(url.searchParams));

    const groups = await computeExecutiveKpis(db, {
      organizationId,
      workspaceId: parsed.workspaceId ?? null,
      actorUserId: user.userId,
      dateRangeStrategy: parsed.dateRangeStrategy,
      comparisonStrategy: parsed.comparisonStrategy,
    });
    return jsonSuccess({ groups });
  } catch (err) {
    return handleRouteError(err);
  }
}
