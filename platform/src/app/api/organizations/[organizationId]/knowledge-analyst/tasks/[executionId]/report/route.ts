import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { getKnowledgeAnalystReport } from "@/lib/agents/knowledge-analyst";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; executionId: string }> };

/** GET /api/organizations/{organizationId}/knowledge-analyst/tasks/{executionId}/report */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, executionId: rawExecutionId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const executionId = parseUuidParam(rawExecutionId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const report = await getKnowledgeAnalystReport(db, { organizationId, executionId, actorUserId: user.userId });
    return jsonSuccess(report);
  } catch (err) {
    return handleRouteError(err);
  }
}
