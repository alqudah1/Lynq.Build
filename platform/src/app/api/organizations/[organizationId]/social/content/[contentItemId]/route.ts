import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { getContentItemForUser, updateContentItem } from "@/lib/social-os/content";
import type { SocialContentBrief } from "@/lib/social-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; contentItemId: string }> };

const patchBodySchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    changes: z
      .object({
        title: z.string().trim().min(1).max(200).optional(),
        // A partial brief: merged onto the stored brief and validated as a whole by the service.
        brief: z.record(z.string(), z.unknown()).optional(),
        campaignId: z.string().uuid().optional(),
        plannedPublishAt: z.coerce.date().nullable().optional(),
      })
      .strict(),
  })
  .strict();

/** GET /api/organizations/{organizationId}/social/content/{contentItemId} */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, contentItemId: rawItem } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const contentItemId = parseUuidParam(rawItem);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const item = await getContentItemForUser(db, { organizationId, contentItemId, actorUserId: user.userId });
    return jsonSuccess(item);
  } catch (err) {
    return handleRouteError(err);
  }
}

/** PATCH /api/organizations/{organizationId}/social/content/{contentItemId} */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, contentItemId: rawItem } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const contentItemId = parseUuidParam(rawItem);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, patchBodySchema);
    const { brief, ...rest } = body.changes;
    const item = await updateContentItem(db, { organizationId, contentItemId, actorUserId: user.userId, expectedRevision: body.expectedRevision, changes: { ...rest, ...(brief !== undefined ? { brief: brief as Partial<SocialContentBrief> } : {}) } });
    return jsonSuccess(item);
  } catch (err) {
    return handleRouteError(err);
  }
}
