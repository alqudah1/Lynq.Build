import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { changeProjectMemberRole, removeProjectMember } from "@/lib/projects/members";
import { projectMemberRoleSchema } from "@/lib/projects/validation";

export const dynamic = "force-dynamic";

const changeRoleBodySchema = z.object({ role: projectMemberRoleSchema }).strict();

type RouteParams = { params: Promise<{ organizationId: string; projectId: string; userId: string }> };

/** PATCH /api/organizations/{organizationId}/projects/{projectId}/members/{userId} */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, projectId: rawProjectId, userId: rawUserId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const projectId = parseUuidParam(rawProjectId);
    const targetUserId = parseUuidParam(rawUserId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, changeRoleBodySchema);
    await changeProjectMemberRole(db, { organizationId, projectId, targetUserId, newRole: body.role, actorUserId: user.userId });

    return jsonSuccess({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** DELETE /api/organizations/{organizationId}/projects/{projectId}/members/{userId} */
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, projectId: rawProjectId, userId: rawUserId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const projectId = parseUuidParam(rawProjectId);
    const targetUserId = parseUuidParam(rawUserId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    await removeProjectMember(db, { organizationId, projectId, targetUserId, actorUserId: user.userId });

    return jsonSuccess({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
