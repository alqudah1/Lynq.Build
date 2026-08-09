import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { setCustomFieldValue, listCustomFieldValuesForEntity } from "@/lib/crm/custom-fields";
import { crmCustomFieldEntityTypeSchema } from "@/lib/crm/validation";

export const dynamic = "force-dynamic";

const setValueBodySchema = z.object({ fieldDefinitionId: uuidParam, entityType: crmCustomFieldEntityTypeSchema, entityId: uuidParam, value: z.unknown() }).strict();

type RouteParams = { params: Promise<{ organizationId: string }> };

/** GET /api/organizations/{organizationId}/crm/custom-fields/values?entityType=&entityId= */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const entityType = crmCustomFieldEntityTypeSchema.parse(url.searchParams.get("entityType"));
    const entityId = uuidParam.parse(url.searchParams.get("entityId"));

    const values = await listCustomFieldValuesForEntity(db, { organizationId, entityType, entityId, actorUserId: user.userId });
    return jsonSuccess({ values });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/crm/custom-fields/values — validated server-side against the field's own definition (type + bounded rules) before being stored. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, setValueBodySchema);
    await setCustomFieldValue(db, { organizationId, actorUserId: user.userId, ...body });

    return jsonSuccess({ saved: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
