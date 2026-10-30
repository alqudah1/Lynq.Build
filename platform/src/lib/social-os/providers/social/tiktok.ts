import { SocialProviderError, SocialProviderNotSupportedError } from "../../errors";
import { jsonRequest, formBody, composeCaption, nonIdempotentCreate, withQuery, providerErrorFromResponse, withProviderState } from "./http";
import type { DiscoveredAsset, FetchLike, PublishInput, PublishMediaInput, PublishResult, SocialAccountCredential, SocialProviderAdapter, SocialTokenBundle, VerifyResult } from "./types";

/**
 * TikTok adapter (Login Kit v2 + Content Posting API, FILE_UPLOAD).
 *
 * Two modes:
 *  - inbox (default, scope `video.upload`): the video lands in the
 *    account's TikTok inbox and the creator taps Post in the app, adding
 *    the caption there. This works before TikTok audits the app.
 *  - direct (`TIKTOK_DIRECT_POST=1`, scope `video.publish`): the video is
 *    posted with its caption. TikTok only allows public direct posts from
 *    audited apps; an unaudited app can post SELF_ONLY (private) videos.
 *
 * External configuration: a TikTok developer app with Login Kit and the
 * Content Posting API, the scopes above, and
 * `${AUTH_BASE_URL}/api/social/oauth/tiktok/callback` as a redirect URI.
 * Access tokens last 24 hours and the refresh token 365 days, so the
 * connection refreshes itself.
 */

export interface TikTokEnv {
  TIKTOK_CLIENT_KEY?: string;
  TIKTOK_CLIENT_SECRET?: string;
  TIKTOK_DIRECT_POST?: string;
}

export interface TikTokAdapterDeps {
  fetchImpl?: FetchLike;
  now?: () => Date;
}

const OPEN_API = "https://open.tiktokapis.com/v2";
const TOKEN_URL = `${OPEN_API}/oauth/token/`;

export function tiktokDirectPost(env: Pick<TikTokEnv, "TIKTOK_DIRECT_POST">): boolean {
  return env.TIKTOK_DIRECT_POST === "1";
}

export function tiktokScopes(env: Pick<TikTokEnv, "TIKTOK_DIRECT_POST">): string[] {
  return tiktokDirectPost(env) ? ["user.info.basic", "video.upload", "video.publish"] : ["user.info.basic", "video.upload"];
}

export function buildTikTokAuthorizationUrl(input: { clientKey: string; redirectUri: string; state: string; scopes: readonly string[] }): string {
  const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
  url.searchParams.set("client_key", input.clientKey);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", input.scopes.join(","));
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  return url.toString();
}

interface TikTokTokenResponse {
  access_token?: string;
  expires_in?: number;
  open_id?: string;
  refresh_token?: string;
  refresh_expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

export interface TikTokTokenResult {
  accessToken: string;
  expiresAt?: string;
  refreshToken?: string;
  refreshTokenExpiresAt?: string;
  openId?: string;
  scopes?: string[];
}

async function tokenCall(fetchImpl: FetchLike, params: Record<string, string>, now: Date): Promise<TikTokTokenResult> {
  const { data } = await jsonRequest<TikTokTokenResponse>(fetchImpl, TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" }, body: formBody(params) }, { provider: "tiktok" });
  // The token endpoint answers 200 with an OAuth error envelope.
  if (data?.error) throw providerErrorFromResponse("tiktok", 400, { error: data.error, error_description: data.error_description });
  if (!data?.access_token) throw new SocialProviderError("tiktok", "token_exchange_failed", "TikTok did not return an access token", { retryable: false });
  return {
    accessToken: data.access_token,
    expiresAt: typeof data.expires_in === "number" ? new Date(now.getTime() + data.expires_in * 1000).toISOString() : undefined,
    refreshToken: data.refresh_token,
    refreshTokenExpiresAt: typeof data.refresh_expires_in === "number" ? new Date(now.getTime() + data.refresh_expires_in * 1000).toISOString() : undefined,
    openId: data.open_id,
    scopes: data.scope ? data.scope.split(/[\s,]+/).filter(Boolean) : undefined,
  };
}

export function exchangeTikTokCode(fetchImpl: FetchLike, input: { clientKey: string; clientSecret: string; redirectUri: string; code: string; now?: Date }): Promise<TikTokTokenResult> {
  return tokenCall(fetchImpl, { client_key: input.clientKey, client_secret: input.clientSecret, code: input.code, grant_type: "authorization_code", redirect_uri: input.redirectUri }, input.now ?? new Date());
}

export function refreshTikTokToken(fetchImpl: FetchLike, input: { clientKey: string; clientSecret: string; refreshToken: string; now?: Date }): Promise<TikTokTokenResult> {
  return tokenCall(fetchImpl, { client_key: input.clientKey, client_secret: input.clientSecret, grant_type: "refresh_token", refresh_token: input.refreshToken }, input.now ?? new Date());
}

export interface TikTokUser {
  openId: string;
  displayName?: string;
  avatarUrl?: string;
}

export async function fetchTikTokUser(fetchImpl: FetchLike, accessToken: string): Promise<TikTokUser> {
  const { data } = await jsonRequest<{ data?: { user?: { open_id?: string; display_name?: string; avatar_url?: string } } }>(
    fetchImpl,
    withQuery(`${OPEN_API}/user/info/`, { fields: "open_id,avatar_url,display_name" }),
    { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } },
    { provider: "tiktok" },
  );
  const user = data?.data?.user;
  if (!user?.open_id) throw new SocialProviderError("tiktok", "user_missing", "TikTok did not return the account", { retryable: false });
  return { openId: user.open_id, displayName: user.display_name, avatarUrl: user.avatar_url };
}

/**
 * FILE_UPLOAD chunk plan. TikTok wants chunks of 5–64 MB with the last one
 * absorbing the remainder; a video up to 64 MB goes in one chunk.
 */
export function tiktokChunkPlan(size: number): { chunkSize: number; totalChunkCount: number; ranges: [number, number][] } {
  const MB = 1024 * 1024;
  if (size <= 64 * MB) return { chunkSize: size, totalChunkCount: 1, ranges: [[0, size - 1]] };
  const chunkSize = 10 * MB;
  const totalChunkCount = Math.floor(size / chunkSize);
  const ranges: [number, number][] = [];
  for (let i = 0; i < totalChunkCount; i++) ranges.push([i * chunkSize, i === totalChunkCount - 1 ? size - 1 : (i + 1) * chunkSize - 1]);
  return { chunkSize, totalChunkCount, ranges };
}

export const TIKTOK_INBOX_PREFIX = "inbox:";

type StatusData = { status?: string; fail_reason?: string; publicaly_available_post_id?: (number | string)[] };

export function createTikTokAdapter(env: TikTokEnv, deps: TikTokAdapterDeps = {}): SocialProviderAdapter {
  const fetchImpl: FetchLike = deps.fetchImpl ?? ((input, init) => fetch(input, init));
  const now = deps.now ?? (() => new Date());
  const direct = tiktokDirectPost(env);

  function post<T>(path: string, token: string, body: unknown) {
    return jsonRequest<{ data?: T }>(fetchImpl, `${OPEN_API}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" }, body: JSON.stringify(body) }, { provider: "tiktok" });
  }

  async function discoverAssets(bundle: SocialTokenBundle): Promise<DiscoveredAsset[]> {
    const user = await fetchTikTokUser(fetchImpl, bundle.accessToken);
    let handle: string | undefined;
    if (direct) {
      try {
        const { data } = await post<{ creator_username?: string }>("/post/publish/creator_info/query/", bundle.accessToken, {});
        handle = data?.data?.creator_username ? `@${data.data.creator_username}` : undefined;
      } catch (err) {
        if (err instanceof SocialProviderError && (err.authorizationLost || err.retryable)) throw err;
      }
    }
    return [
      {
        platform: "tiktok",
        externalAccountId: user.openId,
        displayName: user.displayName || "TikTok account",
        handle,
        externalUrl: handle ? `https://www.tiktok.com/${handle}` : undefined,
        accountKind: "organic",
        metadata: { mode: direct ? "direct" : "inbox" },
      },
    ];
  }

  async function verify(credential: SocialAccountCredential): Promise<VerifyResult> {
    try {
      const user = await fetchTikTokUser(fetchImpl, credential.bundle.accessToken);
      if (user.openId !== credential.externalAccountId) return { ok: false, detail: "This authorization belongs to a different TikTok account", authorizationLost: true };
      return { ok: true, detail: user.displayName ?? user.openId, scopes: credential.bundle.scopes };
    } catch (err) {
      if (err instanceof SocialProviderError && err.authorizationLost) return { ok: false, detail: err.message, authorizationLost: true };
      throw err;
    }
  }

  async function refresh(bundle: SocialTokenBundle): Promise<SocialTokenBundle> {
    if (!bundle.refreshToken) throw new SocialProviderNotSupportedError("tiktok", "token refresh without a refresh token (reconnect the account)");
    if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) throw new SocialProviderError("tiktok", "not_configured", "TikTok client credentials are not configured", { retryable: false });
    const res = await refreshTikTokToken(fetchImpl, { clientKey: env.TIKTOK_CLIENT_KEY, clientSecret: env.TIKTOK_CLIENT_SECRET, refreshToken: bundle.refreshToken, now: now() });
    return {
      ...bundle,
      accessToken: res.accessToken,
      expiresAt: res.expiresAt,
      refreshToken: res.refreshToken ?? bundle.refreshToken,
      scopes: res.scopes ?? bundle.scopes,
      ...(res.refreshTokenExpiresAt ? { refreshTokenExpiresAt: res.refreshTokenExpiresAt } : {}),
    } as SocialTokenBundle;
  }

  async function mediaBytes(m: PublishMediaInput): Promise<Uint8Array> {
    if (m.bytes) return m.bytes;
    if (!m.url) throw new SocialProviderError("tiktok", "media_bytes_required", "TikTok uploads need the video bytes or a fetchable URL", { retryable: false });
    let res: Response;
    try {
      res = await fetchImpl(m.url, { method: "GET" });
    } catch {
      throw new SocialProviderError("tiktok", "media_fetch_failed", "Could not download the video to upload to TikTok", { retryable: true });
    }
    if (!res.ok) throw new SocialProviderError("tiktok", "media_fetch_failed", `Could not download the video to upload to TikTok (HTTP ${res.status})`, { retryable: res.status >= 500 });
    return new Uint8Array(await res.arrayBuffer());
  }

  async function uploadChunks(uploadUrl: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const plan = tiktokChunkPlan(bytes.byteLength);
    for (const [first, last] of plan.ranges) {
      let res: Response;
      try {
        res = await fetchImpl(uploadUrl, { method: "PUT", headers: { "Content-Type": contentType, "Content-Length": String(last - first + 1), "Content-Range": `bytes ${first}-${last}/${bytes.byteLength}` }, body: bytes.subarray(first, last + 1) as unknown as BodyInit });
      } catch {
        throw new SocialProviderError("tiktok", "upload_failed", "The video upload to TikTok did not get through", { retryable: true });
      }
      if (res.status !== 201 && res.status !== 206 && !res.ok) throw new SocialProviderError("tiktok", "upload_failed", `TikTok refused the video upload (HTTP ${res.status})`, { retryable: res.status >= 500 || res.status === 429 });
    }
  }

  function pickPrivacy(options: string[], wanted: unknown): string {
    if (typeof wanted === "string" && options.includes(wanted)) return wanted;
    for (const level of ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"]) if (options.includes(level)) return level;
    return "SELF_ONLY";
  }

  function interpret(publishId: string, mode: "inbox" | "direct", status: StatusData | undefined): PublishResult {
    const state = { tiktokPublishId: publishId, tiktokMode: mode };
    const s = status?.status ?? "PROCESSING_UPLOAD";
    if (s === "FAILED") throw new SocialProviderError("tiktok", `publish_failed${status?.fail_reason ? `_${status.fail_reason}` : ""}`, `TikTok could not process the video${status?.fail_reason ? ` (${status.fail_reason})` : ""}`, { retryable: false });
    const postId = status?.publicaly_available_post_id?.[0];
    if (s === "PUBLISH_COMPLETE") return { outcome: "published", externalPostId: postId ? String(postId) : `${mode === "inbox" ? TIKTOK_INBOX_PREFIX : ""}${publishId}` };
    // Inbox uploads end here: the creator finishes the post in the TikTok app.
    if (s === "SEND_TO_USER_INBOX" && mode === "inbox") return { outcome: "published", externalPostId: `${TIKTOK_INBOX_PREFIX}${publishId}` };
    return { outcome: "pending", externalPostId: "", providerState: state };
  }

  async function fetchStatus(token: string, publishId: string): Promise<StatusData | undefined> {
    const { data } = await post<StatusData>("/post/publish/status/fetch/", token, { publish_id: publishId });
    return data?.data;
  }

  async function publish(credential: SocialAccountCredential, input: PublishInput): Promise<PublishResult> {
    const token = credential.bundle.accessToken;
    const existing = typeof input.providerState.tiktokPublishId === "string" ? input.providerState.tiktokPublishId : null;
    const existingMode = input.providerState.tiktokMode === "direct" ? "direct" : "inbox";
    if (existing) return interpret(existing, existingMode, await fetchStatus(token, existing));

    const video = input.media.find((m) => m.contentType.startsWith("video/"));
    if (!video) throw new SocialProviderError("tiktok", "video_required", "A TikTok post needs a video", { retryable: false });
    const bytes = await mediaBytes(video);
    const plan = tiktokChunkPlan(bytes.byteLength);
    const sourceInfo = { source: "FILE_UPLOAD", video_size: bytes.byteLength, chunk_size: plan.chunkSize, total_chunk_count: plan.totalChunkCount };
    const mode: "inbox" | "direct" = direct ? "direct" : "inbox";

    let init: { publish_id?: string; upload_url?: string } | undefined;
    if (mode === "direct") {
      const { data: creator } = await post<{ privacy_level_options?: string[]; comment_disabled?: boolean; duet_disabled?: boolean; stitch_disabled?: boolean }>("/post/publish/creator_info/query/", token, {});
      const c = creator?.data ?? {};
      const postInfo = {
        title: composeCaption(input.body, input.hashtags).slice(0, 2200),
        privacy_level: pickPrivacy(c.privacy_level_options ?? [], input.platformOptions.privacyLevel),
        disable_comment: c.comment_disabled === true || input.platformOptions.disableComment === true,
        disable_duet: c.duet_disabled === true || input.platformOptions.disableDuet === true,
        disable_stitch: c.stitch_disabled === true || input.platformOptions.disableStitch === true,
        video_cover_timestamp_ms: typeof input.platformOptions.coverTimestampMs === "number" ? input.platformOptions.coverTimestampMs : 1000,
      };
      // A direct post goes live once processed, so an ambiguous init is a human check.
      init = (await nonIdempotentCreate("tiktok", () => post<{ publish_id?: string; upload_url?: string }>("/post/publish/video/init/", token, { post_info: postInfo, source_info: sourceInfo }))).data.data;
    } else {
      // An inbox upload only drafts; a retried init at worst leaves a second draft in the inbox.
      init = (await post<{ publish_id?: string; upload_url?: string }>("/post/publish/inbox/video/init/", token, { source_info: sourceInfo })).data.data;
    }
    if (!init?.publish_id || !init.upload_url) throw new SocialProviderError("tiktok", "init_failed", "TikTok did not return an upload location", { retryable: true });
    const publishId = init.publish_id;
    const uploadUrl = init.upload_url;

    // A failed upload leaves an empty session TikTok discards, so a retry starts over.
    await uploadChunks(uploadUrl, bytes, video.contentType);
    // From here the video exists on TikTok's side: keep the publish id so a retry only checks its status.
    return withProviderState(
      () => ({ tiktokPublishId: publishId, tiktokMode: mode }),
      async () => interpret(publishId, mode, await fetchStatus(token, publishId)),
    );
  }

  return {
    provider: "tiktok",
    platforms: ["tiktok"],
    missingConfiguration() {
      const missing: string[] = [];
      if (!env.TIKTOK_CLIENT_KEY) missing.push("TIKTOK_CLIENT_KEY");
      if (!env.TIKTOK_CLIENT_SECRET) missing.push("TIKTOK_CLIENT_SECRET");
      return missing;
    },
    verify,
    discoverAssets,
    refresh,
    publish,
  };
}
