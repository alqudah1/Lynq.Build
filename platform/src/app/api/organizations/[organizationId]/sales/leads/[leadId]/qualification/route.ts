import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { startQualificationRun, listQualificationRunsForLead } from "@/lib/sales-os/qualification";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; leadId: string }> };

const startRunBodySchema = z.object({ playbookVersionId: z.string().uuid().optional() }).strict();

/** GET /api/organizations/{organizationId}/sales/leads/{leadId}/qualification */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, leadId: rawLead } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const leadId = parseUuidParam(rawLead);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const runs = await listQualificationRunsForLead(db, { organizationId, leadId, actorUserId: user.userId });
    return jsonSuccess({ runs });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/sales/leads/{leadId}/qualification — starts a new qualification run. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, leadId: rawLead } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const leadId = parseUuidParam(rawLead);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, startRunBodySchema);
    const result = await startQualificationRun(db, { organizationId, leadId, playbookVersionId: body.playbookVersionId, actorUserId: user.userId });
    return jsonSuccess(result, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
