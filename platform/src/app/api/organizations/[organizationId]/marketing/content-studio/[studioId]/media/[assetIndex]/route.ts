import "server-only";

import { get } from "@vercel/blob";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { getStudioDraftForUser } from "@/lib/marketing-os/content-studio";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; studioId: string; assetIndex: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const values = await params;
    const organizationId = parseUuidParam(values.organizationId);
    const studioId = parseUuidParam(values.studioId);
    const assetIndex = Number(values.assetIndex);
    if (!Number.isInteger(assetIndex) || assetIndex < 0 || assetIndex > 9) return new Response("Not found", { status: 404 });

    const db = createDbClient(loadEnv());
    const user = await getAuthenticatedUser(db);
    const studio = await getStudioDraftForUser(db, { organizationId, studioId, actorUserId: user.userId });
    const asset = studio.productionPackage?.renderedAssets[assetIndex];
    if (!asset) return new Response("Not found", { status: 404 });

    const result = await get(asset.pathname, { access: "private" });
    if (!result || !result.stream) return new Response("Not found", { status: 404 });
    const download = new URL(request.url).searchParams.get("download") === "1";
    const extension = asset.contentType.includes("png") ? "png" : asset.contentType.includes("webm") ? "webm" : "mp4";
    const safeName = `${studio.productionPackage?.title ?? "content-studio-media"}-${assetIndex + 1}`.replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();

    return new Response(result.stream, {
      headers: {
        "Content-Type": asset.contentType,
        "Content-Length": String(asset.size),
        "Cache-Control": "private, max-age=300",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeName}.${extension}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
