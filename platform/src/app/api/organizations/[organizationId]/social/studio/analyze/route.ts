import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { analyzePerformance } from "@/lib/social-os/studio";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const bodySchema = z.object({ brandProfileId: z.string().uuid(), days: z.number().int().min(1).max(180).optional() }).strict();

/** POST /api/organizations/{organizationId}/social/studio/analyze — returns { available: false, reason } without calling a model when there is no real performance data. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, bodySchema);
    const result = await analyzePerformance(db, { organizationId, actorUserId: user.userId, ...body });
    return jsonSuccess(result, 200);
  } catch (err) {
    return handleRouteError(err);
  }
}
