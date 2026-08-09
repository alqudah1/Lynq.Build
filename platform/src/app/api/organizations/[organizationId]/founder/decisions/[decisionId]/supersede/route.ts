import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam, parseJsonBody } from "@/lib/http/validation";
import { supersedeFounderDecision } from "@/lib/founder-os/decisions";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; decisionId: string }> };

const bodySchema = z.object({ expectedRevision: z.number().int().nonnegative(), supersededByDecisionId: z.string().uuid() }).strict();

/** POST — single-use: marks this decision superseded by a real replacement decision. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, decisionId: rawDecision } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const decisionId = parseUuidParam(rawDecision);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, bodySchema);
    const decision = await supersedeFounderDecision(db, { organizationId, decisionId, actorUserId: user.userId, ...body });
    return jsonSuccess(decision);
  } catch (err) {
    return handleRouteError(err);
  }
}
