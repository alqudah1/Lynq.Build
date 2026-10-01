import "server-only";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { getAuthenticatedUser } from "@/lib/http/auth";
import { jsonSuccess, handleRouteError } from "@/lib/http/responses";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validation";
import { createExternalAsset, createUploadedAsset, listAssets, SOCIAL_ASSET_MAX_BYTES } from "@/lib/social-os/assets";
import { SocialAssetNotUsableError } from "@/lib/social-os/errors";
import { socialAssetTypeSchema, socialPlatformSchema } from "@/lib/social-os/validation";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ organizationId: string }> };

const listQuerySchema = z.object({
  brandProfileId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
  contentItemId: z.string().uuid().optional(),
  assetType: socialAssetTypeSchema.optional(),
  platform: socialPlatformSchema.optional(),
  provider: z.string().trim().min(1).max(60).optional(),
  since: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  includeArchived: z.enum(["true", "false"]).optional(),
});

const optionalUuid = z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().uuid().optional());

const uploadFieldsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  altText: z.string().trim().max(1000).optional(),
  assetType: socialAssetTypeSchema,
  brandProfileId: optionalUuid,
  contentItemId: optionalUuid,
  contentVariantId: optionalUuid,
  platformHint: z.preprocess((v) => (v === "" ? undefined : v), socialPlatformSchema.optional()),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
});

const externalBodySchema = z
  .object({
    url: z.string().trim().url().max(2000),
    contentType: z.string().trim().min(3).max(100),
    title: z.string().trim().min(1).max(200),
    altText: z.string().trim().max(1000).optional(),
    assetType: socialAssetTypeSchema,
    brandProfileId: z.string().uuid().nullable().optional(),
    contentItemId: z.string().uuid().nullable().optional(),
    contentVariantId: z.string().uuid().nullable().optional(),
    platformHint: socialPlatformSchema.nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  })
  .strict();

function parseTags(raw: FormDataEntryValue | null): string[] | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const text = raw.trim();
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed.map(String) : undefined;
    } catch {
      return undefined;
    }
  }
  return text.split(",").map((t) => t.trim()).filter(Boolean);
}

/** GET /api/organizations/{organizationId}/social/assets?brandProfileId=&campaignId=&contentItemId=&assetType=&platform=&provider=&since=&limit=&includeArchived= */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);
    const q = listQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const assets = await listAssets(db, { organizationId, actorUserId: user.userId, ...q, includeArchived: q.includeArchived === "true" });
    return jsonSuccess({ assets });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * POST /api/organizations/{organizationId}/social/assets
 * multipart/form-data (file, title, altText, assetType, brandProfileId, contentItemId, contentVariantId, platformHint, tags) → private Blob upload;
 * application/json ({ url, contentType, title, assetType, … }) → an external-URL asset.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { organizationId: raw } = await params;
    const organizationId = parseUuidParam(raw);
    const env = loadEnv();
    const db = createDbClient(env);
    const user = await getAuthenticatedUser(db);

    if ((request.headers.get("content-type") ?? "").includes("application/json")) {
      const body = await parseJsonBody(request, externalBodySchema);
      const asset = await createExternalAsset(db, { organizationId, actorUserId: user.userId, ...body });
      return jsonSuccess(asset, 201);
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") throw new SocialAssetNotUsableError("a file is required");
    if (file.size > SOCIAL_ASSET_MAX_BYTES) throw new SocialAssetNotUsableError(`the file is larger than ${SOCIAL_ASSET_MAX_BYTES / 1024 / 1024}MB`);
    const field = (name: string) => {
      const v = form.get(name);
      return typeof v === "string" ? v : undefined;
    };
    const fields = uploadFieldsSchema.parse({
      title: field("title") || file.name || "Upload",
      altText: field("altText"),
      assetType: field("assetType"),
      brandProfileId: field("brandProfileId"),
      contentItemId: field("contentItemId"),
      contentVariantId: field("contentVariantId"),
      platformHint: field("platformHint"),
      tags: parseTags(form.get("tags")),
    });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const asset = await createUploadedAsset(db, { organizationId, actorUserId: user.userId, ...fields, file: { bytes, contentType: file.type || "application/octet-stream", filename: file.name } });
    return jsonSuccess(asset, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}
