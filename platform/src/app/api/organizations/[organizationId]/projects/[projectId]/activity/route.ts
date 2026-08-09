import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { getProjectForUser } from "@/lib/projects/projects";
import { listProjectEvents } from "@/lib/projects/events";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; projectId: string }> };

/** GET /api/organizations/{organizationId}/projects/{projectId}/activity — the user-facing project timeline, distinct from audit_logs. */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, projectId: rawProjectId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const projectId = parseUuidParam(rawProjectId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    await getProjectForUser(db, { organizationId, projectId, actorUserId: user.userId });

    const url = new URL(request.url);
    const limit = z.coerce.number().int().min(1).max(200).default(50).parse(url.searchParams.get("limit") ?? undefined);

    const events = await listProjectEvents(db, projectId, limit);
    return jsonSuccess({ events });
  } catch (err) {
    return handleRouteError(err);
  }
}
