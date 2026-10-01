import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { generateAdCreativeConcepts } from "@/lib/social-os/advertising";
import { socialPlatformSchema } from "@/lib/social-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const bodySchema = z.object({ brandProfileId: z.string().uuid(), objective: z.string().trim().min(1).max(500), audience: z.string().trim().max(1000).default(""), platform: socialPlatformSchema, count: z.number().int().min(1).max(8).optional() }).strict();

/** POST /api/organizations/{organizationId}/social/advertising/creative-concepts — ad copy + visual concepts (returned, not persisted). */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, bodySchema);
    const result = await generateAdCreativeConcepts(db, { organizationId, actorUserId: user.userId, ...body });
    return jsonSuccess(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
