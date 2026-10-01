import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { getInboxSummary, listEngagementItems } from "@/lib/social-os/engagement";
import { socialEngagementStatusSchema, socialEngagementTypeSchema, socialPlatformSchema } from "@/lib/social-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const querySchema = z.object({
  brandProfileId: z.string().uuid().optional(),
  platform: socialPlatformSchema.optional(),
  status: socialEngagementStatusSchema.optional(),
  itemType: socialEngagementTypeSchema.optional(),
  assignedUserId: z.string().uuid().optional(),
  isLead: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/** GET /api/organizations/{organizationId}/social/inbox?brandProfileId=&platform=&status=&itemType=&assignedUserId=&isLead=&limit= — engagement items plus the inbox summary. */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const q = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const [items, summary] = await Promise.all([
      listEngagementItems(db, { organizationId, actorUserId: user.userId, ...q }),
      getInboxSummary(db, { organizationId, actorUserId: user.userId, brandProfileId: q.brandProfileId }),
    ]);
    return jsonSuccess({ items, summary });
  } catch (err) {
    return handleRouteError(err);
  }
}
