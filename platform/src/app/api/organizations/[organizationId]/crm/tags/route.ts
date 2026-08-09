import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { createTag, listTagsForUser } from "@/lib/crm/tags";
import { crmNameSchema, crmKeySchema } from "@/lib/crm/validation";

export const dynamic = "force-dynamic";

const createTagBodySchema = z.object({ name: crmNameSchema, tagKey: crmKeySchema, color: z.string().trim().max(20).optional() }).strict();

type RouteParams = { params: Promise<{ organizationId: string }> };

/** GET /api/organizations/{organizationId}/crm/tags */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const tags = await listTagsForUser(db, { organizationId, actorUserId: user.userId });
    return jsonSuccess({ tags });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/crm/tags */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createTagBodySchema);
    const tag = await createTag(db, { organizationId, actorUserId: user.userId, ...body });

    return jsonSuccess(tag, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
