import { SocialProviderError, SocialProviderNotSupportedError } from "../../errors";
import { jsonRequest, formBody, numberOrUndefined, nonIdempotentCreate, withQuery, providerErrorFromResponse, redactSecrets } from "./http";
import type { AccountInsights, DiscoveredAsset, FetchLike, PublishInput, PublishMediaInput, PublishResult, SocialAccountCredential, SocialProviderAdapter, SocialTokenBundle, VerifyResult } from "./types";

/**
 * YouTube adapter: posts vertical videos as YouTube Shorts through the
 * YouTube Data API v3 (`videos.insert`, resumable upload).
 *
 * External configuration: a Google Cloud OAuth web client with the
 * "YouTube Data API v3" enabled and
 * `${AUTH_BASE_URL}/api/social/oauth/youtube/callback` registered. The
 * client can be the same one Google Ads uses (`GOOGLE_ADS_CLIENT_ID`), so
 * `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` are optional overrides.
 *
 * Until the Cloud project passes YouTube's API compliance audit, YouTube
 * locks uploads from it to private (they can be made public in YouTube
 * Studio); publishing is otherwise identical. Each upload costs 1 call of
 * the daily upload quota.
 *
 * Shorts: YouTube treats any vertical video up to 3 minutes as a Short.
 * `#Shorts` is added to the title (when it fits) and the description.
 */

export interface YouTubeEnv {
  YOUTUBE_CLIENT_ID?: string;
  YOUTUBE_CLIENT_SECRET?: string;
  GOOGLE_ADS_CLIENT_ID?: string;
  GOOGLE_ADS_CLIENT_SECRET?: string;
}

export interface YouTubeAdapterDeps {
  fetchImpl?: FetchLike;
  now?: () => Date;
}

export const YOUTUBE_SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"] as const;
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos";

export function youtubeClient(env: YouTubeEnv): { clientId?: string; clientSecret?: string } {
  if (env.YOUTUBE_CLIENT_ID || env.YOUTUBE_CLIENT_SECRET) return { clientId: env.YOUTUBE_CLIENT_ID, clientSecret: env.YOUTUBE_CLIENT_SECRET };
  return { clientId: env.GOOGLE_ADS_CLIENT_ID, clientSecret: env.GOOGLE_ADS_CLIENT_SECRET };
}

export function buildYouTubeAuthorizationUrl(input: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", YOUTUBE_SCOPES.join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

export interface YouTubeTokenResult {
  accessToken: string;
  expiresAt?: string;
  refreshToken?: string;
  scopes?: string[];
}

function toResult(data: GoogleTokenResponse, now: Date): YouTubeTokenResult {
  if (!data?.access_token) throw new SocialProviderError("youtube", "token_exchange_failed", "Google did not return an access token", { retryable: false });
  return {
    accessToken: data.access_token,
    expiresAt: typeof data.expires_in === "number" ? new Date(now.getTime() + data.expires_in * 1000).toISOString() : undefined,
    refreshToken: data.refresh_token,
    scopes: data.scope ? data.scope.split(/\s+/).filter(Boolean) : undefined,
  };
}

export async function exchangeYouTubeCode(fetchImpl: FetchLike, input: { clientId: string; clientSecret: string; redirectUri: string; code: string; now?: Date }): Promise<YouTubeTokenResult> {
  const { data } = await jsonRequest<GoogleTokenResponse>(
    fetchImpl,
    TOKEN_URL,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: formBody({ grant_type: "authorization_code", code: input.code, client_id: input.clientId, client_secret: input.clientSecret, redirect_uri: input.redirectUri }) },
    { provider: "youtube" },
  );
  return toResult(data, input.now ?? new Date());
}

export async function refreshYouTubeToken(fetchImpl: FetchLike, input: { clientId: string; clientSecret: string; refreshToken: string; now?: Date }): Promise<YouTubeTokenResult> {
  const { data } = await jsonRequest<GoogleTokenResponse>(
    fetchImpl,
    TOKEN_URL,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: formBody({ grant_type: "refresh_token", refresh_token: input.refreshToken, client_id: input.clientId, client_secret: input.clientSecret }) },
    { provider: "youtube" },
  );
  return toResult(data, input.now ?? new Date());
}

interface ChannelItem {
  id: string;
  snippet?: { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } };
  statistics?: { subscriberCount?: string; viewCount?: string; videoCount?: string; hiddenSubscriberCount?: boolean };
}

export async function fetchYouTubeChannels(fetchImpl: FetchLike, accessToken: string, query: { mine: true } | { id: string }): Promise<ChannelItem[]> {
  const url = withQuery(`${API}/channels`, { part: "snippet,statistics", ...("mine" in query ? { mine: "true" } : { id: query.id }), maxResults: 50 });
  const { data } = await jsonRequest<{ items?: ChannelItem[] }>(fetchImpl, url, { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } }, { provider: "youtube" });
  return data?.items ?? [];
}

/** YouTube rejects `<` and `>` in titles and descriptions. */
function clean(text: string): string {
  return text.replace(/[<>]/g, "").trim();
}

/**
 * Title (≤100 characters, `#Shorts` appended when it fits), description
 * (≤5000, body plus hashtags with #Shorts first) and tags (≤500 characters
 * in total) for a Short. `platformOptions.title` wins over the derived title.
 */
export function youtubeShortsMetadata(input: { body: string; hashtags: string[]; title?: unknown }): { title: string; description: string; tags: string[] } {
  const tags = [...new Set(input.hashtags.map((t) => t.trim().replace(/^#+/, "")).filter(Boolean))];
  const body = clean(input.body);
  const explicit = typeof input.title === "string" ? clean(input.title) : "";
  const lead = explicit || body.split("\n").find((l) => l.trim())?.trim() || "New video";
  let title = lead.replace(/\s+/g, " ");
  if (!/#shorts\b/i.test(title)) {
    const room = 100 - " #Shorts".length;
    title = title.length > room ? `${title.slice(0, room - 3).trimEnd()}... #Shorts` : `${title} #Shorts`;
  }
  title = title.slice(0, 100);
  const tagLine = ["Shorts", ...tags.filter((t) => t.toLowerCase() !== "shorts")].map((t) => `#${t}`).join(" ");
  const description = `${body}\n\n${tagLine}`.trim().slice(0, 5000);
  const kept: string[] = [];
  let total = 0;
  for (const t of tags) {
    const cost = t.length + (t.includes(" ") ? 2 : 0) + (kept.length ? 1 : 0);
    if (total + cost > 500) break;
    kept.push(t);
    total += cost;
  }
  return { title, description, tags: kept };
}

export function createYouTubeAdapter(env: YouTubeEnv, deps: YouTubeAdapterDeps = {}): SocialProviderAdapter {
  const fetchImpl: FetchLike = deps.fetchImpl ?? ((input, init) => fetch(input, init));
  const now = deps.now ?? (() => new Date());

  async function discoverAssets(bundle: SocialTokenBundle): Promise<DiscoveredAsset[]> {
    const channels = await fetchYouTubeChannels(fetchImpl, bundle.accessToken, { mine: true });
    return channels.map((c) => {
      const handle = c.snippet?.customUrl?.replace(/^@?/, "@");
      return {
        platform: "youtube" as const,
        externalAccountId: c.id,
        displayName: c.snippet?.title || `YouTube channel ${c.id}`,
        handle,
        externalUrl: handle ? `https://www.youtube.com/${handle}` : `https://www.youtube.com/channel/${c.id}`,
        accountKind: "organic" as const,
        metadata: { subscribers: numberOrUndefined(c.statistics?.subscriberCount) ?? null, videos: numberOrUndefined(c.statistics?.videoCount) ?? null },
      };
    });
  }

  async function verify(credential: SocialAccountCredential): Promise<VerifyResult> {
    try {
      const [channel] = await fetchYouTubeChannels(fetchImpl, credential.bundle.accessToken, { id: credential.externalAccountId });
      if (!channel) return { ok: false, detail: "The channel is no longer reachable with this authorization", authorizationLost: true };
      return { ok: true, detail: channel.snippet?.title ?? channel.id, scopes: credential.bundle.scopes };
    } catch (err) {
      if (err instanceof SocialProviderError && err.authorizationLost) return { ok: false, detail: err.message, authorizationLost: true };
      throw err;
    }
  }

  async function refresh(bundle: SocialTokenBundle): Promise<SocialTokenBundle> {
    const { clientId, clientSecret } = youtubeClient(env);
    if (!bundle.refreshToken) throw new SocialProviderNotSupportedError("youtube", "token refresh without a refresh token (reconnect the channel)");
    if (!clientId || !clientSecret) throw new SocialProviderError("youtube", "not_configured", "YouTube client credentials are not configured", { retryable: false });
    const res = await refreshYouTubeToken(fetchImpl, { clientId, clientSecret, refreshToken: bundle.refreshToken, now: now() });
    return { ...bundle, accessToken: res.accessToken, expiresAt: res.expiresAt, refreshToken: res.refreshToken ?? bundle.refreshToken, scopes: res.scopes ?? bundle.scopes };
  }

  async function mediaBytes(m: PublishMediaInput): Promise<Uint8Array> {
    if (m.bytes) return m.bytes;
    if (!m.url) throw new SocialProviderError("youtube", "media_bytes_required", "YouTube uploads need the video bytes or a fetchable URL", { retryable: false });
    let res: Response;
    try {
      res = await fetchImpl(m.url, { method: "GET" });
    } catch {
      throw new SocialProviderError("youtube", "media_fetch_failed", "Could not download the video to upload to YouTube", { retryable: true });
    }
    if (!res.ok) throw new SocialProviderError("youtube", "media_fetch_failed", `Could not download the video to upload to YouTube (HTTP ${res.status})`, { retryable: res.status >= 500 });
    return new Uint8Array(await res.arrayBuffer());
  }

  async function publish(credential: SocialAccountCredential, input: PublishInput): Promise<PublishResult> {
    const video = input.media.find((m) => m.contentType.startsWith("video/"));
    if (!video) throw new SocialProviderError("youtube", "video_required", "A YouTube Short needs a video", { retryable: false });
    const token = credential.bundle.accessToken;
    const bytes = await mediaBytes(video);
    const meta = youtubeShortsMetadata({ body: input.body, hashtags: input.hashtags, title: input.platformOptions.title });
    const privacy = input.platformOptions.visibility === "private" || input.platformOptions.visibility === "unlisted" ? input.platformOptions.visibility : "public";
    const resource = {
      snippet: { title: meta.title, description: meta.description, tags: meta.tags, categoryId: typeof input.platformOptions.categoryId === "string" ? input.platformOptions.categoryId : "22" },
      status: { privacyStatus: privacy, selfDeclaredMadeForKids: input.platformOptions.madeForKids === true, embeddable: true },
    };

    // 1. Open a resumable upload session (creates nothing visible yet).
    let session: Response;
    try {
      session = await fetchImpl(withQuery(UPLOAD, { uploadType: "resumable", part: "snippet,status", notifySubscribers: "true" }), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Length": String(bytes.byteLength), "X-Upload-Content-Type": video.contentType },
        body: JSON.stringify(resource),
      });
    } catch (err) {
      throw new SocialProviderError("youtube", "network_error", redactSecrets(`could not start the upload: ${err instanceof Error ? err.message : "network failure"}`), { retryable: true });
    }
    if (!session.ok) {
      const text = await session.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = { message: text.slice(0, 200) };
      }
      throw providerErrorFromResponse("youtube", session.status, body, session.headers);
    }
    const uploadUrl = session.headers.get("location");
    if (!uploadUrl) throw new SocialProviderError("youtube", "upload_session_missing", "YouTube did not return an upload location", { retryable: true });

    // 2. Send the bytes. Completing the upload creates the video, so an ambiguous failure here is a human check, not a retry.
    const { data } = await nonIdempotentCreate("youtube", () =>
      jsonRequest<{ id?: string; status?: { uploadStatus?: string; rejectionReason?: string } }>(fetchImpl, uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": video.contentType, "Content-Length": String(bytes.byteLength) }, body: bytes as unknown as BodyInit }, { provider: "youtube" }),
    );
    if (!data?.id) throw new SocialProviderError("youtube", "missing_post_id", "YouTube finished the upload without a video id — check the channel before retrying", { retryable: false });
    if (data.status?.uploadStatus === "rejected" || data.status?.uploadStatus === "failed") {
      throw new SocialProviderError("youtube", `upload_${data.status.uploadStatus}`, `YouTube ${data.status.uploadStatus} the video${data.status.rejectionReason ? ` (${data.status.rejectionReason})` : ""}`, { retryable: false });
    }
    return { outcome: "published", externalPostId: data.id, externalPostUrl: `https://www.youtube.com/shorts/${data.id}` };
  }

  async function fetchAccountInsights(credential: SocialAccountCredential, range: { since: Date; until: Date }): Promise<AccountInsights | null> {
    const [channel] = await fetchYouTubeChannels(fetchImpl, credential.bundle.accessToken, { id: credential.externalAccountId });
    if (!channel) return null;
    const followers = channel.statistics?.hiddenSubscriberCount ? undefined : numberOrUndefined(channel.statistics?.subscriberCount);
    const totalViews = numberOrUndefined(channel.statistics?.viewCount);
    const videos = numberOrUndefined(channel.statistics?.videoCount);
    return {
      periodStart: range.since,
      periodEnd: range.until,
      followers,
      extra: { ...(totalViews !== undefined ? { lifetime_views: totalViews } : {}), ...(videos !== undefined ? { videos } : {}) },
    };
  }

  return {
    provider: "youtube",
    platforms: ["youtube"],
    missingConfiguration() {
      const { clientId, clientSecret } = youtubeClient(env);
      const missing: string[] = [];
      if (!clientId) missing.push("YOUTUBE_CLIENT_ID");
      if (!clientSecret) missing.push("YOUTUBE_CLIENT_SECRET");
      return missing;
    },
    verify,
    discoverAssets,
    refresh,
    publish,
    fetchAccountInsights,
  };
}
