import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { computeCrmFunnel, computeSalesFunnel, computeMarketingFunnel, computeAllFunnels } from "@/lib/analytics-os/funnels";
import { resolveDateRangeForStrategy } from "@/lib/analytics-os/time";
import { resolveEffectiveAnalyticsConfiguration } from "@/lib/analytics-os/configuration";
import { ANALYTICS_DATE_RANGE_STRATEGIES } from "@/lib/analytics-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const querySchema = z.object({
  workspaceId: z.string().uuid().optional(),
  dateRangeStrategy: z.enum(ANALYTICS_DATE_RANGE_STRATEGIES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  funnel: z.enum(["crm", "sales", "marketing"]).optional(),
});

/** GET /api/organizations/{organizationId}/analytics/funnels?funnel=crm|sales|marketing — deterministic stage counts and conversion rates only, no causal attribution beyond real canonical links. */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const parsed = querySchema.parse(Object.fromEntries(url.searchParams));

    const config = await resolveEffectiveAnalyticsConfiguration(db, { organizationId, workspaceId: parsed.workspaceId ?? null, actorUserId: user.userId });
    const strategy = parsed.dateRangeStrategy ?? config.defaultDateRangeStrategy;
    const range = resolveDateRangeForStrategy(strategy, config.businessTimezone, parsed.from && parsed.to ? { from: parsed.from, to: parsed.to } : null);

    const funnelCtx = { db, organizationId, workspaceId: parsed.workspaceId ?? null, from: range.from, to: range.to, actorUserId: user.userId };

    const funnels = parsed.funnel
      ? [await { crm: computeCrmFunnel, sales: computeSalesFunnel, marketing: computeMarketingFunnel }[parsed.funnel](funnelCtx)]
      : await computeAllFunnels(funnelCtx);

    return jsonSuccess({ range, funnels });
  } catch (err) {
    return handleRouteError(err);
  }
}
