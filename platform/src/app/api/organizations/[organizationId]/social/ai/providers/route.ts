import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { summarizeGenerationUsage } from "@/lib/social-os/generation";
import { describeAiProviders, loadSocialAiEnv } from "@/lib/social-os/providers/ai/registry";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

/** GET /api/organizations/{organizationId}/social/ai/providers?days= — which creative AI providers this server can use (from env, never assumed) plus generation usage and today's media spend vs. the daily budget. */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const daysParam = Number(new URL(request.url).searchParams.get("days") ?? "30");
    const aiEnv = await loadSocialAiEnv();
    // The usage summary checks marketing_view; provider availability is only returned after that check passes.
    const usage = await summarizeGenerationUsage(db, { organizationId, actorUserId: user.userId, days: Number.isFinite(daysParam) ? daysParam : 30, env: aiEnv });
    return jsonSuccess({ providers: describeAiProviders(aiEnv), usage });
  } catch (err) {
    return handleRouteError(err);
  }
}
