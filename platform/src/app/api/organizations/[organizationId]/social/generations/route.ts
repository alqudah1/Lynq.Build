import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { listGenerations } from "@/lib/social-os/generation";
import { socialGenerationTypeSchema } from "@/lib/social-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

/** GET /api/organizations/{organizationId}/social/generations?brandProfileId=&contentItemId=&contentVariantId=&type=&limit= */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const url = new URL(request.url);
    const optionalUuid = (key: string) => {
      const v = url.searchParams.get(key);
      return v ? parseUuidParam(v) : undefined;
    };
    const type = url.searchParams.get("type");
    const limit = Number(url.searchParams.get("limit") ?? "50");
    const generations = await listGenerations(db, {
      organizationId,
      actorUserId: user.userId,
      brandProfileId: optionalUuid("brandProfileId"),
      contentItemId: optionalUuid("contentItemId"),
      contentVariantId: optionalUuid("contentVariantId"),
      generationType: type ? socialGenerationTypeSchema.parse(type) : undefined,
      limit: Number.isFinite(limit) ? limit : 50,
    });
    return jsonSuccess({ generations });
  } catch (err) {
    return handleRouteError(err);
  }
}
