import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { createActivity, listActivitiesForUser } from "@/lib/crm/activities";
import { crmActivityTypeSchema, crmActivityDirectionSchema, crmSubjectSchema, crmBoundedTextSchema } from "@/lib/crm/validation";

export const dynamic = "force-dynamic";

const createActivityBodySchema = z
  .object({
    contactId: uuidParam.optional(),
    companyId: uuidParam.optional(),
    leadId: uuidParam.optional(),
    opportunityId: uuidParam.optional(),
    activityType: crmActivityTypeSchema,
    direction: crmActivityDirectionSchema.optional(),
    occurredAt: z.coerce.date().optional(),
    subject: crmSubjectSchema.optional(),
    summary: crmBoundedTextSchema.optional(),
    externalReference: z.string().trim().max(500).optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string }> };

/** GET /api/organizations/{organizationId}/crm/activities — query params: contactId?, companyId?, leadId?, opportunityId?, limit? (at least one target should be given) */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const query = z
      .object({ contactId: uuidParam.optional(), companyId: uuidParam.optional(), leadId: uuidParam.optional(), opportunityId: uuidParam.optional(), limit: z.coerce.number().int().min(1).max(200).optional() })
      .parse({
        contactId: url.searchParams.get("contactId") ?? undefined,
        companyId: url.searchParams.get("companyId") ?? undefined,
        leadId: url.searchParams.get("leadId") ?? undefined,
        opportunityId: url.searchParams.get("opportunityId") ?? undefined,
        limit: url.searchParams.get("limit") ?? undefined,
      });

    const activities = await listActivitiesForUser(db, { organizationId, actorUserId: user.userId, ...query });
    return jsonSuccess({ activities });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/crm/activities */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createActivityBodySchema);
    const activity = await createActivity(db, { organizationId, actorUserId: user.userId, ...body });

    return jsonSuccess(activity, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
