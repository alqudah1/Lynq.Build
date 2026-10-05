import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { getAssetForUser, openAssetStream, resolveAssetRow } from "@/lib/social-os/assets";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; assetId: string }> };

/** GET /api/organizations/{organizationId}/social/assets/{assetId}/media — the bytes, for in-app previews (requires marketing_view). */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, assetId: rawAsset } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const assetId = parseUuidParam(rawAsset);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    await getAssetForUser(db, { organizationId, assetId, actorUserId: user.userId });
    const asset = await resolveAssetRow(db, organizationId, assetId);
    if (asset.storageKind === "external_url" && asset.url) return Response.redirect(asset.url, 302);
    const opened = await openAssetStream(asset);
    if (!opened) return new Response("Not found", { status: 404 });
    return new Response(opened.stream, {
      headers: {
        "Content-Type": opened.contentType,
        ...(opened.size ? { "Content-Length": String(opened.size) } : {}),
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
