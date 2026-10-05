import "server-only";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseUuidParam } from "@/lib/http/validation";
import { archiveAsset, getAssetForUser } from "@/lib/social-os/assets";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string; assetId: string }> };

/** GET /api/organizations/{organizationId}/social/assets/{assetId} */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, assetId: rawAsset } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const assetId = parseUuidParam(rawAsset);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const asset = await getAssetForUser(db, { organizationId, assetId, actorUserId: user.userId });
    return jsonSuccess(asset);
  } catch (err) {
    return handleRouteError(err);
  }
}

/** DELETE /api/organizations/{organizationId}/social/assets/{assetId} — archives (the bytes are kept; published posts may reference them). */
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { organizationId: rawOrg, assetId: rawAsset } = await params;
    const organizationId = parseUuidParam(rawOrg);
    const assetId = parseUuidParam(rawAsset);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const asset = await archiveAsset(db, { organizationId, assetId, actorUserId: user.userId });
    return jsonSuccess(asset);
  } catch (err) {
    return handleRouteError(err);
  }
}
