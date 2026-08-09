import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { getContactForUser, updateContact, archiveContact } from "@/lib/crm/contacts";
import { crmDisplayNameSchema, crmEmailSchema, crmPhoneSchema, crmLifecycleStageSchema } from "@/lib/crm/validation";

export const dynamic = "force-dynamic";

const updateContactBodySchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    archive: z.boolean().optional(),
    firstName: z.string().trim().max(200).nullable().optional(),
    lastName: z.string().trim().max(200).nullable().optional(),
    displayName: crmDisplayNameSchema.optional(),
    primaryEmail: crmEmailSchema.nullable().optional(),
    primaryPhone: crmPhoneSchema.nullable().optional(),
    jobTitle: z.string().trim().max(200).nullable().optional(),
    department: z.string().trim().max(200).nullable().optional(),
    lifecycleStage: crmLifecycleStageSchema.optional(),
    ownerUserId: uuidParam.nullable().optional(),
    sourceId: uuidParam.nullable().optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string; contactId: string }> };

/** GET /api/organizations/{organizationId}/crm/contacts/{contactId} */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, contactId: rawContactId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const contactId = parseUuidParam(rawContactId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const contact = await getContactForUser(db, { organizationId, contactId, actorUserId: user.userId });
    return jsonSuccess(contact);
  } catch (err) {
    return handleRouteError(err);
  }
}

/** PATCH /api/organizations/{organizationId}/crm/contacts/{contactId} — `archive: true` archives instead of updating fields. */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId, contactId: rawContactId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);
    const contactId = parseUuidParam(rawContactId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, updateContactBodySchema);

    if (body.archive) {
      const archived = await archiveContact(db, { organizationId, contactId, expectedRevision: body.expectedRevision, actorUserId: user.userId });
      return jsonSuccess(archived);
    }

    const { archive: _archive, expectedRevision, ...fields } = body;
    void _archive;
    const updated = await updateContact(db, { organizationId, contactId, expectedRevision, actorUserId: user.userId, ...fields });
    return jsonSuccess(updated);
  } catch (err) {
    return handleRouteError(err);
  }
}
