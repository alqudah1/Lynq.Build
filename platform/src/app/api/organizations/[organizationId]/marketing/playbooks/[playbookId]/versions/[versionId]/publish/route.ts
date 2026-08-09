import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { publishPlaybookVersion } from "@/lib/marketing-os/playbooks";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; playbookId: string; versionId: string }> };

const publishBodySchema = z.object({ expectedRevision: z.number().int().min(1) }).strict();

/** POST /api/organizations/{organizationId}/marketing/playbooks/{playbookId}/versions/{versionId}/publish */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, playbookId: rawPlaybook, versionId: rawVersion } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const playbookId = parseUuidParam(rawPlaybook);
    const versionId = parseUuidParam(rawVersion);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, publishBodySchema);
    const version = await publishPlaybookVersion(db, { organizationId, playbookId, versionId, actorUserId: user.userId, ...body });
    return jsonSuccess(version);
  } catch (err) {
    return handleRouteError(err);
  }
}
