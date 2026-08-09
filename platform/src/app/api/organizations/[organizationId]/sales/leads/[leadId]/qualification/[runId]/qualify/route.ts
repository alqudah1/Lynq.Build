import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { qualifyLeadViaRun } from "@/lib/sales-os/qualification";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; runId: string }> };

const decideBodySchema = z.object({ expectedRevision: z.number().int().min(1) }).strict();

/** POST /api/organizations/{organizationId}/sales/leads/{leadId}/qualification/{runId}/qualify — qualifies through CRM Core's own service. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, runId: rawRun } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const runId = parseUuidParam(rawRun);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, decideBodySchema);
    const result = await qualifyLeadViaRun(db, { organizationId, runId, expectedRevision: body.expectedRevision, actorUserId: user.userId });
    return jsonSuccess(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
