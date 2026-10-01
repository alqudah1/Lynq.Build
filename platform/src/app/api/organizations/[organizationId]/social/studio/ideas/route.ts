import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { generateContentIdeas } from "@/lib/social-os/studio";
import { socialOrganicPlatformSchema } from "@/lib/social-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const bodySchema = z
  .object({
    brandProfileId: z.string().uuid(),
    count: z.number().int().min(1).max(10).optional(),
    platforms: z.array(socialOrganicPlatformSchema).max(6).optional(),
    theme: z.string().trim().max(500).optional(),
  })
  .strict();

/** POST /api/organizations/{organizationId}/social/studio/ideas — brainstorms ideas (not saved). */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, bodySchema);
    const result = await generateContentIdeas(db, { organizationId, actorUserId: user.userId, ...body });
    return jsonSuccess(result, 200);
  } catch (err) {
    return handleRouteError(err);
  }
}
