import "server-only";
import { loadEnv } from "@/lib/env";
import { loadAuthEnv } from "@/lib/auth/env";
import { createDbClient } from "@/db/client";
import { uuidParam } from "@/lib/http/validation";
import { openAssetStream, resolveAssetForDelivery, verifyAssetDeliveryToken } from "@/lib/social-os/assets";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ assetId: string }> };

const NOT_FOUND = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/**
 * GET /api/social/assets/{assetId}?token=… — PUBLIC media delivery for
 * platforms that pull media by URL (Facebook, Instagram). No session: the
 * HMAC-signed, one-hour token (bound to this asset id, signed with
 * AUTH_SECRET) is the only authorization. Any failure is a plain 404.
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { assetId: raw } = await params;
    const parsed = uuidParam.safeParse(raw);
    if (!parsed.success) return NOT_FOUND();
    const assetId = parsed.data;
    const token = new URL(request.url).searchParams.get("token");
    if (!verifyAssetDeliveryToken(assetId, token, { secret: loadAuthEnv().AUTH_SECRET })) return NOT_FOUND();
    const db = createDbClient(loadEnv());
    const asset = await resolveAssetForDelivery(db, assetId);
    if (!asset) return NOT_FOUND();
    const opened = await openAssetStream(asset);
    if (!opened) return NOT_FOUND();
    return new Response(opened.stream, {
      headers: {
        "Content-Type": opened.contentType,
        ...(opened.size ? { "Content-Length": String(opened.size) } : {}),
        "Cache-Control": "private, max-age=600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NOT_FOUND();
  }
}
