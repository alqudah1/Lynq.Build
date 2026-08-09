import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { createContentItem, listContentItemsForUser } from "@/lib/marketing-os/content";
import { marketingTitleSchema, marketingContentTypeSchema, marketingContentStatusSchema } from "@/lib/marketing-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const createContentBodySchema = z
  .object({
    campaignId: z.string().uuid(),
    title: marketingTitleSchema,
    contentType: marketingContentTypeSchema,
    ownerUserId: z.string().uuid().nullable().optional(),
    intendedChannel: z.string().trim().max(100).nullable().optional(),
    plannedPublishAt: z.coerce.date().nullable().optional(),
    projectTaskId: z.string().uuid().nullable().optional(),
  })
  .strict();

/** GET /api/organizations/{organizationId}/marketing/content?status=&ownerUserId= */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status");
    const status = statusParam ? marketingContentStatusSchema.parse(statusParam) : undefined;
    const ownerUserId = url.searchParams.get("ownerUserId") ?? undefined;

    const items = await listContentItemsForUser(db, { organizationId, actorUserId: user.userId, status, ownerUserId });
    return jsonSuccess({ items });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/marketing/content */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    const body = await parseJsonBody(request, createContentBodySchema);
    const item = await createContentItem(db, { organizationId, actorUserId: user.userId, ...body });
    return jsonSuccess(item, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
