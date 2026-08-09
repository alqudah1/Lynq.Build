import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { createContact, listContactsForUser } from "@/lib/crm/contacts";
import { crmDisplayNameSchema, crmEmailSchema, crmPhoneSchema, crmLifecycleStageSchema, crmRecordStatusSchema, crmIdempotencyKeySchema } from "@/lib/crm/validation";

export const dynamic = "force-dynamic";

const createContactBodySchema = z
  .object({
    workspaceId: uuidParam.optional(),
    firstName: z.string().trim().max(200).optional(),
    lastName: z.string().trim().max(200).optional(),
    displayName: crmDisplayNameSchema.optional(),
    primaryEmail: crmEmailSchema.optional(),
    primaryPhone: crmPhoneSchema.optional(),
    jobTitle: z.string().trim().max(200).optional(),
    department: z.string().trim().max(200).optional(),
    lifecycleStage: crmLifecycleStageSchema.optional(),
    ownerUserId: uuidParam.optional(),
    sourceId: uuidParam.optional(),
    idempotencyKey: crmIdempotencyKeySchema.optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string }> };

/** GET /api/organizations/{organizationId}/crm/contacts — query params: workspaceId?, status?, ownerUserId?, limit? */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const query = z
      .object({ workspaceId: uuidParam.optional(), status: crmRecordStatusSchema.optional(), ownerUserId: uuidParam.optional(), limit: z.coerce.number().int().min(1).max(200).optional() })
      .parse({ workspaceId: url.searchParams.get("workspaceId") ?? undefined, status: url.searchParams.get("status") ?? undefined, ownerUserId: url.searchParams.get("ownerUserId") ?? undefined, limit: url.searchParams.get("limit") ?? undefined });

    const contacts = await listContactsForUser(db, { organizationId, actorUserId: user.userId, ...query });
    return jsonSuccess({ contacts });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/crm/contacts */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createContactBodySchema);
    const result = await createContact(db, { organizationId, actorUserId: user.userId, ...body });

    return jsonSuccess(result, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
