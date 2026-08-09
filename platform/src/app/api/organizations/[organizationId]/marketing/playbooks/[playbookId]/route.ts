import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { getPlaybookForUser, listPlaybookVersions } from "@/lib/marketing-os/playbooks";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; playbookId: string }> };

/** GET /api/organizations/{organizationId}/marketing/playbooks/{playbookId} */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, playbookId: rawPlaybook } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const playbookId = parseUuidParam(rawPlaybook);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const [playbook, versions] = await Promise.all([getPlaybookForUser(db, { organizationId, playbookId, actorUserId: user.userId }), listPlaybookVersions(db, { organizationId, playbookId, actorUserId: user.userId })]);
    return jsonSuccess({ playbook, versions });
  } catch (err) {
    return handleRouteError(err);
  }
}
