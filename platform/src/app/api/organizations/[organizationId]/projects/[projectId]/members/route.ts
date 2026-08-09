import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { addProjectMember, listProjectMembers } from "@/lib/projects/members";
import { projectMemberRoleSchema } from "@/lib/projects/validation";

export const dynamic = "force-dynamic";

const addMemberBodySchema = z.object({ userId: uuidParam, role: projectMemberRoleSchema }).strict();

type RouteParams = { params: Promise<{ organizationId: string; projectId: string }> };

/** GET /api/organizations/{organizationId}/projects/{projectId}/members */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, projectId: rawProjectId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const projectId = parseUuidParam(rawProjectId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const members = await listProjectMembers(db, { organizationId, projectId, actorUserId: user.userId });
    return jsonSuccess({ members });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/projects/{projectId}/members */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, projectId: rawProjectId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const projectId = parseUuidParam(rawProjectId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, addMemberBodySchema);
    const member = await addProjectMember(db, { organizationId, projectId, targetUserId: body.userId, role: body.role, actorUserId: user.userId });

    return jsonSuccess(member, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
