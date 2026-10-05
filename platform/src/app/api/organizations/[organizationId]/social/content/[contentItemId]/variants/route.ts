import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { addVariant } from "@/lib/social-os/content";
import { socialVariantInputSchema } from "@/lib/social-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; contentItemId: string }> };

/** POST /api/organizations/{organizationId}/social/content/{contentItemId}/variants — adds a platform variant (body: SocialVariantInput). */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, contentItemId: rawItem } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const contentItemId = parseUuidParam(rawItem);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const body = await parseJsonBody(request, socialVariantInputSchema);
    const variant = await addVariant(db, { organizationId, contentItemId, actorUserId: user.userId, input: body });
    return jsonSuccess(variant, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
