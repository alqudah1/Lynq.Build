import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { getContentItemForUser, updateContentItem } from "@/lib/marketing-os/content";
import { marketingTitleSchema } from "@/lib/marketing-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; contentId: string }> };

const updateContentBodySchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    title: marketingTitleSchema.optional(),
    ownerUserId: z.string().uuid().nullable().optional(),
    intendedChannel: z.string().trim().max(100).nullable().optional(),
    plannedPublishAt: z.coerce.date().nullable().optional(),
    projectTaskId: z.string().uuid().nullable().optional(),
  })
  .strict();

/** GET /api/organizations/{organizationId}/marketing/content/{contentId} */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, contentId: rawContent } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const contentItemId = parseUuidParam(rawContent);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const item = await getContentItemForUser(db, { organizationId, contentItemId, actorUserId: user.userId });
    return jsonSuccess(item);
  } catch (err) {
    return handleRouteError(err);
  }
}

/** PATCH /api/organizations/{organizationId}/marketing/content/{contentId} */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, contentId: rawContent } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const contentItemId = parseUuidParam(rawContent);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, updateContentBodySchema);
    const item = await updateContentItem(db, { organizationId, contentItemId, actorUserId: user.userId, ...body });
    return jsonSuccess(item);
  } catch (err) {
    return handleRouteError(err);
  }
}
