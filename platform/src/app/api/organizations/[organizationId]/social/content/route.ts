import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { createContentItem, listContentItemsForUser } from "@/lib/social-os/content";
import { marketingContentTypeSchema } from "@/lib/marketing-os/validation";
import { SOCIAL_ORGANIC_PLATFORMS, socialContentBriefSchema, socialOrganicPlatformSchema, socialVariantStatusSchema } from "@/lib/social-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const createBodySchema = z
  .object({
    brandProfileId: z.string().uuid(),
    campaignId: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(1).max(200),
    platforms: z.array(socialOrganicPlatformSchema).min(1).max(SOCIAL_ORGANIC_PLATFORMS.length),
    brief: socialContentBriefSchema,
    scheduledFor: z.coerce.date().nullable().optional(),
    contentType: marketingContentTypeSchema.optional(),
  })
  .strict();

const listQuerySchema = z.object({
  brandProfileId: z.string().uuid().optional(),
  status: socialVariantStatusSchema.optional(),
  platform: socialOrganicPlatformSchema.optional(),
  campaignId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  includeArchived: z.enum(["true", "false"]).optional(),
});

/** GET /api/organizations/{organizationId}/social/content?brandProfileId=&status=&platform=&campaignId=&limit=&includeArchived= */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const q = listQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const items = await listContentItemsForUser(db, { organizationId, actorUserId: user.userId, brandProfileId: q.brandProfileId, status: q.status, platform: q.platform, campaignId: q.campaignId, limit: q.limit, includeArchived: q.includeArchived === "true" });
    return jsonSuccess({ items });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** POST /api/organizations/{organizationId}/social/content — creates a content item and one draft variant per platform. */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, createBodySchema);
    const item = await createContentItem(db, { organizationId, actorUserId: user.userId, ...body });
    return jsonSuccess(item, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
