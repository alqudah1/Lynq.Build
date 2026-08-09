import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { createProjectLink, listProjectLinksForCrmEntity } from "@/lib/crm/project-links";
import { crmProjectLinkEntityTypeSchema } from "@/lib/crm/validation";

export const dynamic = "force-dynamic";

const createLinkBodySchema = z.object({ projectId: uuidParam, crmEntityType: crmProjectLinkEntityTypeSchema, crmEntityId: uuidParam }).strict();

type RouteParams = { params: Promise<{ organizationId: string }> };

/** GET /api/organizations/{organizationId}/crm/project-links?crmEntityType=&crmEntityId= */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const crmEntityType = crmProjectLinkEntityTypeSchema.parse(url.searchParams.get("crmEntityType"));
    const crmEntityId = uuidParam.parse(url.searchParams.get("crmEntityId"));

    const links = await listProjectLinksForCrmEntity(db, { organizationId, crmEntityType, crmEntityId, actorUserId: user.userId });
    return jsonSuccess({ links });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/crm/project-links — typed CRM↔Projects link; duplicate links are rejected. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createLinkBodySchema);
    const link = await createProjectLink(db, { organizationId, actorUserId: user.userId, ...body });

    return jsonSuccess(link, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
