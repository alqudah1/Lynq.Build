import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { createCustomFieldDefinition, listCustomFieldDefinitions } from "@/lib/crm/custom-fields";
import { crmNameSchema, crmKeySchema, crmCustomFieldEntityTypeSchema, crmCustomFieldTypeSchema, crmCustomFieldOptionsSchema, crmCustomFieldValidationRulesSchema } from "@/lib/crm/validation";

export const dynamic = "force-dynamic";

const createFieldBodySchema = z
  .object({
    entityType: crmCustomFieldEntityTypeSchema,
    fieldKey: crmKeySchema,
    label: crmNameSchema,
    fieldType: crmCustomFieldTypeSchema,
    isRequired: z.boolean().optional(),
    options: crmCustomFieldOptionsSchema,
    validationRules: crmCustomFieldValidationRulesSchema,
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string }> };

/** GET /api/organizations/{organizationId}/crm/custom-fields?entityType= */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const entityType = crmCustomFieldEntityTypeSchema.parse(url.searchParams.get("entityType"));

    const definitions = await listCustomFieldDefinitions(db, { organizationId, entityType, actorUserId: user.userId });
    return jsonSuccess({ definitions });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/crm/custom-fields — org owner/admin only. A safe foundation, never a dynamic schema engine — no code, SQL, or formula fields. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createFieldBodySchema);
    const definition = await createCustomFieldDefinition(db, { organizationId, actorUserId: user.userId, ...body });

    return jsonSuccess(definition, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
