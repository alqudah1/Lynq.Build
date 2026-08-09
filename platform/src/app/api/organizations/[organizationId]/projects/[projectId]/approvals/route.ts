import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { linkApprovalToEntity, listApprovalLinks } from "@/lib/projects/links";
import { projectLinkedEntityTypeSchema } from "@/lib/projects/validation";

export const dynamic = "force-dynamic";

const linkApprovalBodySchema = z.object({ approvalRequestId: uuidParam, linkedEntityType: projectLinkedEntityTypeSchema, linkedEntityId: uuidParam }).strict();

type RouteParams = { params: Promise<{ organizationId: string; projectId: string }> };

/** GET /api/organizations/{organizationId}/projects/{projectId}/approvals — includes each link's live status, read from the Runtime's own approval record (never duplicated). */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, projectId: rawProjectId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const projectId = parseUuidParam(rawProjectId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const query = z
      .object({ linkedEntityType: projectLinkedEntityTypeSchema.optional(), linkedEntityId: uuidParam.optional() })
      .parse({ linkedEntityType: url.searchParams.get("linkedEntityType") ?? undefined, linkedEntityId: url.searchParams.get("linkedEntityId") ?? undefined });

    const links = await listApprovalLinks(db, { organizationId, projectId, actorUserId: user.userId, ...query });
    return jsonSuccess({ links });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/projects/{projectId}/approvals — links an EXISTING Runtime approval request; the decision itself is never duplicated here. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, projectId: rawProjectId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const projectId = parseUuidParam(rawProjectId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, linkApprovalBodySchema);
    const link = await linkApprovalToEntity(db, { organizationId, projectId, approvalRequestId: body.approvalRequestId, linkedEntityType: body.linkedEntityType, linkedEntityId: body.linkedEntityId, actorUserId: user.userId });

    return jsonSuccess(link, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
