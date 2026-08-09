import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { createContentDraftTask } from "@/lib/marketing-os/agents";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; contentId: string }> };

const draftBodySchema = z.object({ briefArtifactId: z.string().uuid().nullable().optional() }).strict();

/** POST /api/organizations/{organizationId}/marketing/content/{contentId}/draft — direct-launch the Content Draft Assistant (also reachable generically via a workflow's agent_execution node). */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, contentId: rawContent } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const contentItemId = parseUuidParam(rawContent);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, draftBodySchema);
    const result = await createContentDraftTask(db, { organizationId, contentItemId, briefArtifactId: body.briefArtifactId, actorUserId: user.userId });
    return jsonSuccess(result, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
