import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam, uuidParam } from "@/lib/http/validation";
import { createFollowUp, listFollowUpsForUser } from "@/lib/crm/follow-ups";
import { crmNameSchema, crmPrioritySchema, crmFollowUpStatusSchema } from "@/lib/crm/validation";

export const dynamic = "force-dynamic";

const createFollowUpBodySchema = z
  .object({
    contactId: uuidParam.optional(),
    companyId: uuidParam.optional(),
    leadId: uuidParam.optional(),
    opportunityId: uuidParam.optional(),
    assignedUserId: uuidParam,
    title: crmNameSchema,
    dueAt: z.coerce.date().optional(),
    priority: crmPrioritySchema.optional(),
  })
  .strict();

type RouteParams = { params: Promise<{ organizationId: string }> };

/** GET /api/organizations/{organizationId}/crm/follow-ups — query params: contactId?, companyId?, leadId?, opportunityId?, assignedUserId?, status?, limit? */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const query = z
      .object({
        contactId: uuidParam.optional(),
        companyId: uuidParam.optional(),
        leadId: uuidParam.optional(),
        opportunityId: uuidParam.optional(),
        assignedUserId: uuidParam.optional(),
        status: crmFollowUpStatusSchema.optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      })
      .parse({
        contactId: url.searchParams.get("contactId") ?? undefined,
        companyId: url.searchParams.get("companyId") ?? undefined,
        leadId: url.searchParams.get("leadId") ?? undefined,
        opportunityId: url.searchParams.get("opportunityId") ?? undefined,
        assignedUserId: url.searchParams.get("assignedUserId") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
        limit: url.searchParams.get("limit") ?? undefined,
      });

    const followUps = await listFollowUpsForUser(db, { organizationId, actorUserId: user.userId, ...query });
    return jsonSuccess({ followUps });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/crm/follow-ups */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createFollowUpBodySchema);
    const followUp = await createFollowUp(db, { organizationId, actorUserId: user.userId, ...body });

    return jsonSuccess(followUp, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
