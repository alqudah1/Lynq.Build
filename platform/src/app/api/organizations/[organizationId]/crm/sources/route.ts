import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { createSource, listSourcesForUser } from "@/lib/crm/sources";
import { crmNameSchema, crmKeySchema, crmSourceTypeSchema } from "@/lib/crm/validation";

export const dynamic = "force-dynamic";

const createSourceBodySchema = z.object({ sourceKey: crmKeySchema, name: crmNameSchema, sourceType: crmSourceTypeSchema, description: z.string().trim().max(2000).optional() }).strict();

type RouteParams = { params: Promise<{ organizationId: string }> };

/** GET /api/organizations/{organizationId}/crm/sources — query params: activeOnly? */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const activeOnly = url.searchParams.get("activeOnly") === "true";

    const sources = await listSourcesForUser(db, { organizationId, actorUserId: user.userId, activeOnly });
    return jsonSuccess({ sources });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/crm/sources — org owner/admin only; extends the built-in source list with a custom source. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrganizationId } = await params;
    const organizationId = parseUuidParam(rawOrganizationId);

    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createSourceBodySchema);
    const source = await createSource(db, { organizationId, actorUserId: user.userId, ...body });

    return jsonSuccess(source, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
