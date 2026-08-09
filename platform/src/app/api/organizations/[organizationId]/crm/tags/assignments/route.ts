import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { assignTag, unassignTag, listTagAssignmentsForEntity } from "@/lib/crm/tags";
import { crmTagEntityTypeSchema } from "@/lib/crm/validation";

export const dynamic = "force-dynamic";

const assignBodySchema = z.object({ tagId: uuidParam, entityType: crmTagEntityTypeSchema, entityId: uuidParam }).strict();

type RouteParams = { params: Promise<{ organizationId: string }> };

/** GET /api/organizations/{organizationId}/crm/tags/assignments?entityType=&entityId= */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const entityType = crmTagEntityTypeSchema.parse(url.searchParams.get("entityType"));
    const entityId = uuidParam.parse(url.searchParams.get("entityId"));

    const assignments = await listTagAssignmentsForEntity(db, { organizationId, entityType, entityId, actorUserId: user.userId });
    return jsonSuccess({ assignments });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/crm/tags/assignments — assigns a tag to a contact/company/lead/opportunity; duplicate active assignments are rejected. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, assignBodySchema);
    const assignment = await assignTag(db, { organizationId, actorUserId: user.userId, ...body });

    return jsonSuccess(assignment, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}

/** DELETE /api/organizations/{organizationId}/crm/tags/assignments — body: { tagId, entityType, entityId } */
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, assignBodySchema);
    await unassignTag(db, { organizationId, actorUserId: user.userId, ...body });

    return jsonSuccess({ removed: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
