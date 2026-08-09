import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { evaluateAudience, snapshotAudience } from "@/lib/marketing-os/audiences";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; audienceId: string }> };

const snapshotBodySchema = z.object({ expectedRevision: z.number().int().min(1) }).strict();

/** GET /api/organizations/{organizationId}/marketing/audiences/{audienceId}/evaluate — live (or snapshot) count + record ids only, never PII. */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, audienceId: rawAudience } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const audienceId = parseUuidParam(rawAudience);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const forceLive = url.searchParams.get("forceLive") === "true";

    const evaluation = await evaluateAudience(db, { organizationId, audienceId, actorUserId: user.userId, forceLive });
    return jsonSuccess(evaluation);
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/marketing/audiences/{audienceId}/evaluate — freezes a snapshot for campaign reproducibility. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, audienceId: rawAudience } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const audienceId = parseUuidParam(rawAudience);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, snapshotBodySchema);

    const audience = await snapshotAudience(db, { organizationId, audienceId, actorUserId: user.userId, expectedRevision: body.expectedRevision });
    return jsonSuccess(audience);
  } catch (err) {
    return handleRouteError(err);
  }
}
