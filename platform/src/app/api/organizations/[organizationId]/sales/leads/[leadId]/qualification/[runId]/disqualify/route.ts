import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { disqualifyLeadViaRun } from "@/lib/sales-os/qualification";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; runId: string }> };

const decideBodySchema = z.object({ expectedRevision: z.number().int().min(1), reason: z.string().trim().max(1000).optional() }).strict();

/** POST /api/organizations/{organizationId}/sales/leads/{leadId}/qualification/{runId}/disqualify — disqualifies through CRM Core's own service. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, runId: rawRun } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const runId = parseUuidParam(rawRun);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, decideBodySchema);
    const result = await disqualifyLeadViaRun(db, { organizationId, runId, expectedRevision: body.expectedRevision, reason: body.reason, actorUserId: user.userId });
    return jsonSuccess(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
