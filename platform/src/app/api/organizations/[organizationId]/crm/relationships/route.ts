import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { createContactCompanyRelationship, listRelationshipsForContact } from "@/lib/crm/relationships";
import { crmRelationshipTypeSchema } from "@/lib/crm/validation";

export const dynamic = "force-dynamic";

const createRelationshipBodySchema = z.object({ contactId: uuidParam, companyId: uuidParam, relationshipType: crmRelationshipTypeSchema, isPrimary: z.boolean().optional() }).strict();

type RouteParams = { params: Promise<{ organizationId: string }> };

/** GET /api/organizations/{organizationId}/crm/relationships?contactId= */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const contactId = uuidParam.parse(url.searchParams.get("contactId"));

    const relationships = await listRelationshipsForContact(db, { organizationId, contactId, actorUserId: user.userId });
    return jsonSuccess({ relationships });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/crm/relationships — links a contact to a company; duplicate active relationships of the same type are rejected. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createRelationshipBodySchema);
    const relationship = await createContactCompanyRelationship(db, { organizationId, actorUserId: user.userId, ...body });

    return jsonSuccess(relationship, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
