import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { z } from "zod";
import { marketingContentItems, socialAssets, socialContentVariants } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { requireTenantScopedResource } from "@/lib/authz/helpers";
import { loadEnv } from "@/lib/env";
import { resolveMarketingAuthContext, requireMarketingViewAuthority, requireMarketingManageContentAuthority } from "@/lib/marketing-os/authz";
import { requireActiveBrand } from "./brands";
import { SocialAssetNotUsableError, SocialProviderNotConfiguredError, StaleSocialUpdateError } from "./errors";
import { socialAssetTypeSchema, socialPlatformSchema, type SocialAssetType, type SocialPlatform, type SocialVariantMedia } from "./validation";
import type { FetchLike } from "./providers/social/types";

type Db = NeonHttpDatabase<Record<string, unknown>>;
export type SocialAssetRow = typeof socialAssets.$inferSelect;

/**
 * Module 19 — the social asset library. `social_assets` holds metadata
 * only; bytes live in a PRIVATE Vercel Blob store (or at an external URL
 * we do not control). Platforms that pull media by URL (Facebook,
 * Instagram) get a short-lived HMAC-signed delivery URL served by
 * `/api/social/assets/[assetId]?token=…`; upload-based platforms
 * (LinkedIn) get the bytes via `resolveAssetBytes`.
 */

export const SOCIAL_ASSET_MAX_BYTES = 50 * 1024 * 1024;
export const SOCIAL_ASSET_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/quicktime", "application/pdf"] as const;
const DELIVERY_TOKEN_TTL_SECONDS = 3600;
const EXTERNAL_FETCH_MAX_REDIRECTS = 3;

// ---------------------------------------------------------------------------
// External URLs (SSRF guard)
// ---------------------------------------------------------------------------

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

/**
 * An external asset URL we are willing to fetch server-side (LinkedIn
 * uploads, the public delivery route): https only, a public DNS name or a
 * public IPv4 literal — never loopback, link-local (cloud metadata),
 * private ranges, IPv6 literals, single-label or `.local`/`.internal`
 * names. (Hostnames are not resolved here; see the audit notes on DNS
 * rebinding.)
 */
export function isPublicHttpsUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host.startsWith("[") || host.includes(":")) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa") || !host.includes(".")) return false;
  return !isPrivateIpv4(host);
}

/** GET with redirects followed by hand (max 3), each hop re-checked with `isPublicHttpsUrl`. */
async function fetchExternal(fetchImpl: FetchLike, raw: string): Promise<Response | null> {
  let current = raw;
  for (let hop = 0; hop <= EXTERNAL_FETCH_MAX_REDIRECTS; hop++) {
    if (!isPublicHttpsUrl(current)) return null;
    const res = await fetchImpl(current, { method: "GET", redirect: "manual" });
    if (res.status < 300 || res.status >= 400) return res;
    const location = res.headers.get("location");
    if (!location) return null;
    current = new URL(location, current).toString();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Storage (injectable)
// ---------------------------------------------------------------------------

export interface SocialAssetStorage {
  put(pathname: string, bytes: Uint8Array, options: { contentType: string }): Promise<{ pathname: string; url: string }>;
  get(pathname: string): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string | null; size: number | null } | null>;
}

/** The default private Vercel Blob storage. Fails closed when the store token is not configured. */
export function vercelBlobStorage(token: string | undefined = loadEnv().BLOB_READ_WRITE_TOKEN): SocialAssetStorage {
  if (!token) throw new SocialProviderNotConfiguredError("Vercel Blob", ["BLOB_READ_WRITE_TOKEN"]);
  return {
    async put(pathname, bytes, options) {
      const { put } = await import("@vercel/blob");
      const result = await put(pathname, Buffer.from(bytes), { access: "private", contentType: options.contentType, addRandomSuffix: true, token });
      return { pathname: result.pathname, url: result.url };
    },
    async get(pathname) {
      const { get } = await import("@vercel/blob");
      const result = await get(pathname, { access: "private", token });
      if (!result || result.statusCode !== 200 || !result.stream) return null;
      return { stream: result.stream, contentType: result.blob.contentType ?? null, size: typeof result.blob.size === "number" ? result.blob.size : null };
    },
  };
}

function storageOrDefault(storage?: SocialAssetStorage): SocialAssetStorage {
  return storage ?? vercelBlobStorage();
}

// ---------------------------------------------------------------------------
// Pure helpers: dimension sniffing, filenames, delivery tokens
// ---------------------------------------------------------------------------

/** Reads pixel dimensions from PNG (IHDR), GIF (logical screen) or JPEG (SOFn) headers. Returns null for anything else or a malformed header. */
export function sniffImageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    // 8-byte signature, 4-byte chunk length, "IHDR", then width/height (big-endian u32).
    if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (bytes.length >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    const width = bytes[6] | (bytes[7] << 8);
    const height = bytes[8] | (bytes[9] << 8);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 3 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      let marker = bytes[i + 1];
      while (marker === 0xff && i + 2 < bytes.length) {
        i += 1;
        marker = bytes[i + 1];
      }
      // Standalone markers carry no length.
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      if (marker === 0xd9 || marker === 0xda) return null;
      if (i + 3 >= bytes.length) return null;
      const length = (bytes[i + 2] << 8) | bytes[i + 3];
      if (length < 2) return null;
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        if (i + 8 >= bytes.length) return null;
        const height = (bytes[i + 5] << 8) | bytes[i + 6];
        const width = (bytes[i + 7] << 8) | bytes[i + 8];
        return width > 0 && height > 0 ? { width, height } : null;
      }
      i += 2 + length;
    }
    return null;
  }
  return null;
}

export function safeAssetFilename(filename: string | undefined, contentType: string): string {
  const ext = contentType === "image/jpeg" ? "jpg" : contentType === "video/quicktime" ? "mov" : (contentType.split("/")[1] ?? "bin");
  const base = (filename ?? "asset")
    .replace(/\.[^.]+$/, "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return `${base || "asset"}.${ext}`;
}

function signDelivery(secret: string, assetId: string, exp: number): string {
  return createHmac("sha256", secret).update(`social-asset-delivery:${assetId}:${exp}`).digest("base64url");
}

/** `<expiryUnixSeconds>.<hmac>` — binds one asset id to an expiry; signed with AUTH_SECRET. */
export function createAssetDeliveryToken(assetId: string, options: { secret: string; now?: Date; ttlSeconds?: number }): string {
  const nowSec = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const exp = nowSec + (options.ttlSeconds ?? DELIVERY_TOKEN_TTL_SECONDS);
  return `${exp}.${signDelivery(options.secret, assetId, exp)}`;
}

export function verifyAssetDeliveryToken(assetId: string, token: string | null | undefined, options: { secret: string; now?: Date }): boolean {
  if (!token) return false;
  const match = /^(\d{1,12})\.([A-Za-z0-9_-]{20,100})$/.exec(token);
  if (!match) return false;
  const exp = Number(match[1]);
  if (!Number.isSafeInteger(exp) || exp * 1000 < (options.now ?? new Date()).getTime()) return false;
  const expected = Buffer.from(signDelivery(options.secret, assetId, exp));
  const given = Buffer.from(match[2]);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Publicly fetchable, 1-hour URL for a private blob asset (what Meta pulls from). */
export function assetPublicUrl(env: { AUTH_BASE_URL: string; AUTH_SECRET: string }, assetId: string, now?: Date): string {
  const token = createAssetDeliveryToken(assetId, { secret: env.AUTH_SECRET, now });
  return `${env.AUTH_BASE_URL.replace(/\/+$/, "")}/api/social/assets/${assetId}?token=${encodeURIComponent(token)}`;
}

/** URL the app UI uses for previews (session-gated). */
export function assetPreviewPath(organizationId: string, assetId: string): string {
  return `/api/organizations/${organizationId}/social/assets/${assetId}/media`;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface SocialAssetView {
  id: string;
  organizationId: string;
  brandProfileId: string | null;
  campaignId: string | null;
  contentItemId: string | null;
  contentVariantId: string | null;
  assetType: SocialAssetType;
  source: string;
  storageKind: string;
  /** External URL (external assets only). Blob assets are private and never expose their store URL. */
  url: string | null;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationSeconds: string | null;
  title: string;
  altText: string;
  tags: string[];
  platformHint: SocialPlatform | null;
  provider: string | null;
  model: string | null;
  generationId: string | null;
  createdByUserId: string | null;
  previewUrl: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toAssetView(row: SocialAssetRow): SocialAssetView {
  return {
    id: row.id,
    organizationId: row.organizationId,
    brandProfileId: row.brandProfileId,
    campaignId: row.campaignId,
    contentItemId: row.contentItemId,
    contentVariantId: row.contentVariantId,
    assetType: row.assetType,
    source: row.source,
    storageKind: row.storageKind,
    url: row.storageKind === "external_url" ? row.url : null,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height,
    durationSeconds: row.durationSeconds,
    title: row.title,
    altText: row.altText,
    tags: Array.isArray(row.tags) ? row.tags.filter((t): t is string => typeof t === "string") : [],
    platformHint: row.platformHint,
    provider: row.provider,
    model: row.model,
    generationId: row.generationId,
    createdByUserId: row.createdByUserId,
    previewUrl: assetPreviewPath(row.organizationId, row.id),
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const tagsSchema = z.array(z.string().trim().min(1).max(60)).max(30);

function assertContentType(assetType: SocialAssetType, contentType: string): void {
  if (!(SOCIAL_ASSET_CONTENT_TYPES as readonly string[]).includes(contentType)) throw new SocialAssetNotUsableError(`content type ${contentType} is not supported (allowed: ${SOCIAL_ASSET_CONTENT_TYPES.join(", ")})`);
  const isImage = contentType.startsWith("image/");
  const isVideo = contentType.startsWith("video/");
  if ((assetType === "image" || assetType === "logo" || assetType === "thumbnail") && !isImage) throw new SocialAssetNotUsableError(`a ${assetType} asset must be an image`);
  if (assetType === "video" && !isVideo) throw new SocialAssetNotUsableError("a video asset must be a video file");
}

async function assertLinks(db: Db, organizationId: string, input: { brandProfileId?: string | null; contentItemId?: string | null; contentVariantId?: string | null }): Promise<{ brandProfileId: string | null; campaignId: string | null; contentItemId: string | null }> {
  let brandProfileId = input.brandProfileId ?? null;
  let campaignId: string | null = null;
  let contentItemId = input.contentItemId ?? null;
  if (input.contentVariantId) {
    const variant = await requireTenantScopedResource(async () => {
      const [row] = await db.select({ contentItemId: socialContentVariants.contentItemId }).from(socialContentVariants).where(and(eq(socialContentVariants.id, input.contentVariantId!), eq(socialContentVariants.organizationId, organizationId)));
      return row;
    });
    if (contentItemId && contentItemId !== variant.contentItemId) throw new SocialAssetNotUsableError("the variant does not belong to that content item");
    contentItemId = variant.contentItemId;
  }
  if (contentItemId) {
    const item = await requireTenantScopedResource(async () => {
      const [row] = await db.select({ brandProfileId: marketingContentItems.brandProfileId, campaignId: marketingContentItems.campaignId }).from(marketingContentItems).where(and(eq(marketingContentItems.id, contentItemId!), eq(marketingContentItems.organizationId, organizationId)));
      return row;
    });
    campaignId = item.campaignId;
    if (!brandProfileId) brandProfileId = item.brandProfileId;
  }
  if (brandProfileId) await requireActiveBrand(db, organizationId, brandProfileId);
  return { brandProfileId, campaignId, contentItemId };
}

/**
 * Every media reference on a variant must point at a non-archived asset of
 * this organization. Returns the asset rows in media order.
 */
export async function requireUsableAssets(db: Db, organizationId: string, media: SocialVariantMedia): Promise<SocialAssetRow[]> {
  if (!media.length) return [];
  const ids = [...new Set(media.map((m) => m.assetId))];
  const rows = await db.select().from(socialAssets).where(and(eq(socialAssets.organizationId, organizationId), inArray(socialAssets.id, ids)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) throw new SocialAssetNotUsableError(`asset ${id} does not exist`);
    if (row.archivedAt) throw new SocialAssetNotUsableError(`"${row.title}" is archived`);
  }
  return media.map((m) => byId.get(m.assetId)!);
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface AssetFileInput {
  bytes: Uint8Array;
  contentType: string;
  filename?: string;
}

async function insertBlobAsset(
  db: Db,
  input: {
    organizationId: string;
    actorUserId: string | null;
    links: { brandProfileId: string | null; campaignId: string | null; contentItemId: string | null };
    contentVariantId: string | null;
    assetType: SocialAssetType;
    source: "uploaded" | "generated" | "rendered";
    title: string;
    altText: string;
    tags: string[];
    platformHint: SocialPlatform | null;
    provider?: string | null;
    model?: string | null;
    generationId?: string | null;
    file: AssetFileInput;
    storage?: SocialAssetStorage;
  }
): Promise<SocialAssetRow> {
  const contentType = input.file.contentType.toLowerCase().split(";")[0].trim();
  assertContentType(input.assetType, contentType);
  if (input.file.bytes.byteLength === 0) throw new SocialAssetNotUsableError("the file is empty");
  if (input.file.bytes.byteLength > SOCIAL_ASSET_MAX_BYTES) throw new SocialAssetNotUsableError(`the file is larger than ${SOCIAL_ASSET_MAX_BYTES / 1024 / 1024}MB`);
  const storage = storageOrDefault(input.storage);
  const assetId = randomUUID();
  const dims = contentType.startsWith("image/") ? sniffImageDimensions(input.file.bytes) : null;
  const stored = await storage.put(`social/${input.organizationId}/${assetId}/${safeAssetFilename(input.file.filename, contentType)}`, input.file.bytes, { contentType });
  const [row] = await db
    .insert(socialAssets)
    .values({
      id: assetId,
      organizationId: input.organizationId,
      brandProfileId: input.links.brandProfileId,
      campaignId: input.links.campaignId,
      contentItemId: input.links.contentItemId,
      contentVariantId: input.contentVariantId,
      assetType: input.assetType,
      source: input.source,
      storageKind: "blob",
      pathname: stored.pathname,
      url: null,
      contentType,
      sizeBytes: input.file.bytes.byteLength,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      title: input.title,
      altText: input.altText,
      tags: input.tags,
      platformHint: input.platformHint,
      provider: input.provider ?? null,
      model: input.model ?? null,
      generationId: input.generationId ?? null,
      createdByUserId: input.actorUserId,
    })
    .returning();
  await recordAuditEvent(db, { eventType: "social_asset_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_asset", targetId: row.id, metadata: { source: input.source, assetType: input.assetType, contentType, sizeBytes: row.sizeBytes } });
  return row;
}

const titleSchema = z.string().trim().min(1).max(200);
const altTextSchema = z.string().trim().max(1000);

export async function createUploadedAsset(
  db: Db,
  input: {
    organizationId: string;
    actorUserId: string;
    brandProfileId?: string | null;
    contentItemId?: string | null;
    contentVariantId?: string | null;
    assetType: SocialAssetType;
    title: string;
    altText?: string;
    tags?: string[];
    file: AssetFileInput;
    platformHint?: SocialPlatform | null;
    storage?: SocialAssetStorage;
  }
): Promise<SocialAssetView> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageContentAuthority(db, ctx, "social_asset", "new");
  const links = await assertLinks(db, input.organizationId, input);
  const row = await insertBlobAsset(db, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    links,
    contentVariantId: input.contentVariantId ?? null,
    assetType: socialAssetTypeSchema.parse(input.assetType),
    source: "uploaded",
    title: titleSchema.parse(input.title),
    altText: altTextSchema.parse(input.altText ?? ""),
    tags: tagsSchema.parse(input.tags ?? []),
    platformHint: input.platformHint ? socialPlatformSchema.parse(input.platformHint) : null,
    file: input.file,
    storage: input.storage,
  });
  return toAssetView(row);
}

export async function createExternalAsset(
  db: Db,
  input: {
    organizationId: string;
    actorUserId: string;
    brandProfileId?: string | null;
    contentItemId?: string | null;
    contentVariantId?: string | null;
    assetType: SocialAssetType;
    title: string;
    altText?: string;
    tags?: string[];
    url: string;
    contentType: string;
    platformHint?: SocialPlatform | null;
  }
): Promise<SocialAssetView> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageContentAuthority(db, ctx, "social_asset", "new");
  const url = z.string().trim().url().max(2000).parse(input.url);
  if (!url.startsWith("https://")) throw new SocialAssetNotUsableError("external assets must be served over https");
  if (!isPublicHttpsUrl(url)) throw new SocialAssetNotUsableError("external assets must be on a public internet host");
  const contentType = input.contentType.toLowerCase().split(";")[0].trim();
  const assetType = socialAssetTypeSchema.parse(input.assetType);
  assertContentType(assetType, contentType);
  const links = await assertLinks(db, input.organizationId, input);
  const [row] = await db
    .insert(socialAssets)
    .values({
      organizationId: input.organizationId,
      brandProfileId: links.brandProfileId,
      campaignId: links.campaignId,
      contentItemId: links.contentItemId,
      contentVariantId: input.contentVariantId ?? null,
      assetType,
      source: "external",
      storageKind: "external_url",
      pathname: null,
      url,
      contentType,
      title: titleSchema.parse(input.title),
      altText: altTextSchema.parse(input.altText ?? ""),
      tags: tagsSchema.parse(input.tags ?? []),
      platformHint: input.platformHint ? socialPlatformSchema.parse(input.platformHint) : null,
      createdByUserId: input.actorUserId,
    })
    .returning();
  await recordAuditEvent(db, { eventType: "social_asset_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_asset", targetId: row.id, metadata: { source: "external", assetType, contentType } });
  return toAssetView(row);
}

/** Internal (AI slice): stores a generated media output. Callers have already checked `marketing_generate_content` and recorded the `social_ai_generations` row. */
export async function createGeneratedAsset(
  db: Db,
  input: {
    organizationId: string;
    brandProfileId: string | null;
    contentItemId?: string | null;
    contentVariantId?: string | null;
    assetType: SocialAssetType;
    title: string;
    provider: string;
    model: string;
    generationId: string;
    file: AssetFileInput;
    altText?: string;
    actorUserId?: string | null;
    storage?: SocialAssetStorage;
  }
): Promise<SocialAssetView> {
  const links = await assertLinks(db, input.organizationId, input);
  const row = await insertBlobAsset(db, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId ?? null,
    links,
    contentVariantId: input.contentVariantId ?? null,
    assetType: input.assetType,
    source: "generated",
    title: input.title.slice(0, 200) || "Generated asset",
    altText: (input.altText ?? "").slice(0, 1000),
    tags: [],
    platformHint: null,
    provider: input.provider,
    model: input.model,
    generationId: input.generationId,
    file: input.file,
    storage: input.storage,
  });
  return toAssetView(row);
}

// ---------------------------------------------------------------------------
// Read / archive
// ---------------------------------------------------------------------------

export async function resolveAssetRow(db: Db, organizationId: string, assetId: string): Promise<SocialAssetRow> {
  return requireTenantScopedResource(async () => {
    const [row] = await db.select().from(socialAssets).where(and(eq(socialAssets.id, assetId), eq(socialAssets.organizationId, organizationId)));
    return row;
  });
}

export async function listAssets(
  db: Db,
  input: {
    organizationId: string;
    actorUserId: string;
    brandProfileId?: string;
    campaignId?: string;
    contentItemId?: string;
    assetType?: SocialAssetType;
    platform?: SocialPlatform;
    provider?: string;
    since?: Date;
    limit?: number;
    includeArchived?: boolean;
  }
): Promise<SocialAssetView[]> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "social_asset", "list");
  const conditions = [eq(socialAssets.organizationId, input.organizationId)];
  if (input.brandProfileId) conditions.push(eq(socialAssets.brandProfileId, input.brandProfileId));
  if (input.campaignId) conditions.push(eq(socialAssets.campaignId, input.campaignId));
  if (input.contentItemId) conditions.push(eq(socialAssets.contentItemId, input.contentItemId));
  if (input.assetType) conditions.push(eq(socialAssets.assetType, input.assetType));
  if (input.platform) conditions.push(eq(socialAssets.platformHint, input.platform));
  if (input.provider) conditions.push(eq(socialAssets.provider, input.provider));
  if (input.since) conditions.push(gte(socialAssets.createdAt, input.since));
  if (!input.includeArchived) conditions.push(isNull(socialAssets.archivedAt));
  const limit = Math.min(Math.max(input.limit ?? 60, 1), 200);
  const rows = await db.select().from(socialAssets).where(and(...conditions)).orderBy(desc(socialAssets.createdAt)).limit(limit);
  return rows.map(toAssetView);
}

export async function getAssetForUser(db: Db, input: { organizationId: string; assetId: string; actorUserId: string }): Promise<SocialAssetView> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingViewAuthority(db, ctx, "social_asset", input.assetId);
  return toAssetView(await resolveAssetRow(db, input.organizationId, input.assetId));
}

export async function archiveAsset(db: Db, input: { organizationId: string; assetId: string; actorUserId: string }): Promise<SocialAssetView> {
  const ctx = await resolveMarketingAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireMarketingManageContentAuthority(db, ctx, "social_asset", input.assetId);
  const existing = await resolveAssetRow(db, input.organizationId, input.assetId);
  if (existing.archivedAt) return toAssetView(existing);
  const [row] = await db
    .update(socialAssets)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(socialAssets.id, existing.id), eq(socialAssets.organizationId, input.organizationId), isNull(socialAssets.archivedAt)))
    .returning();
  if (!row) throw new StaleSocialUpdateError("asset");
  await recordAuditEvent(db, { eventType: "social_asset_archived", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "social_asset", targetId: row.id });
  return toAssetView(row);
}

// ---------------------------------------------------------------------------
// Bytes (internal — publishing and the delivery/media routes)
// ---------------------------------------------------------------------------

async function streamToBytes(stream: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new SocialAssetNotUsableError("the stored file is larger than the allowed maximum");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Opens a stream of an asset's bytes. Blob → private store read; external → fetch. */
export async function openAssetStream(asset: SocialAssetRow, deps: { storage?: SocialAssetStorage; fetchImpl?: FetchLike } = {}): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string; size: number | null } | null> {
  if (asset.storageKind === "blob" && asset.pathname) {
    const result = await storageOrDefault(deps.storage).get(asset.pathname);
    if (!result) return null;
    return { stream: result.stream, contentType: asset.contentType, size: result.size ?? asset.sizeBytes };
  }
  if (asset.storageKind === "external_url" && asset.url) {
    const fetchImpl = deps.fetchImpl ?? ((i, init) => fetch(i, init));
    const res = await fetchExternal(fetchImpl, asset.url);
    if (!res || !res.ok || !res.body) return null;
    const len = Number(res.headers.get("content-length"));
    return { stream: res.body, contentType: asset.contentType, size: Number.isFinite(len) && len > 0 ? len : null };
  }
  return null;
}

export async function resolveAssetBytes(db: Db, input: { organizationId: string; assetId: string; storage?: SocialAssetStorage; fetchImpl?: FetchLike }): Promise<{ bytes: Uint8Array; contentType: string }> {
  const asset = await resolveAssetRow(db, input.organizationId, input.assetId);
  const opened = await openAssetStream(asset, { storage: input.storage, fetchImpl: input.fetchImpl });
  if (!opened) throw new SocialAssetNotUsableError(`the file for "${asset.title}" could not be read`);
  return { bytes: await streamToBytes(opened.stream, SOCIAL_ASSET_MAX_BYTES), contentType: asset.contentType };
}

/** For the public delivery route: loads an asset by id alone (the signed token is the authorization). */
export async function resolveAssetForDelivery(db: Db, assetId: string): Promise<SocialAssetRow | null> {
  const [row] = await db.select().from(socialAssets).where(eq(socialAssets.id, assetId));
  return row && !row.archivedAt ? row : null;
}
