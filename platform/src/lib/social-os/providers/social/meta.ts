import { SocialProviderError, SocialProviderNotSupportedError } from "../../errors";
import { socialAdChangePayloadSchemas, type SocialAdChangeType, SOCIAL_AD_CHANGE_TYPES } from "../../validation";
import { jsonRequest, withQuery, composeCaption, numberOrUndefined, defaultSleep, attachProviderState, isoDate, nonIdempotentCreate } from "./http";
import type {
  AccountInsights,
  AdCampaignRecord,
  AdChangeExecutionInput,
  AdChangeExecutionResult,
  DiscoveredAsset,
  FetchedEngagementItem,
  FetchLike,
  PostInsights,
  PublishInput,
  PublishMediaInput,
  PublishResult,
  SocialAccountCredential,
  SocialProviderAdapter,
  SocialTokenBundle,
  VerifyResult,
} from "./types";

/**
 * Module 19 — Meta adapter (Facebook Pages, Instagram professional accounts
 * through Facebook Login for Business, Meta Marketing API ad accounts).
 * Official Graph API only. Tokens travel in the `Authorization` header —
 * never in a URL we might log — except where Meta's OAuth endpoints require
 * query parameters (code exchange, debug_token).
 */

export interface MetaEnv {
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_GRAPH_API_VERSION?: string;
  /**
   * Facebook Login for Business configuration id. Business-type apps grant
   * permissions through a configuration (`config_id`) rather than a `scope`
   * list; when set, the dialog is built with `config_id` and no `scope`.
   */
  META_LOGIN_CONFIG_ID?: string;
}

export interface MetaAdapterDeps {
  fetchImpl?: FetchLike;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Max container status polls before returning `pending` (default 20 × 3s ≈ 60s). */
  containerPollAttempts?: number;
  containerPollIntervalMs?: number;
}

export const META_DEFAULT_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "pages_manage_engagement",
  "pages_read_user_content",
  "pages_manage_metadata",
  "read_insights",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_comments",
  "instagram_manage_insights",
  "ads_read",
  "ads_management",
  "business_management",
] as const;

export const META_DEFAULT_GRAPH_VERSION = "v25.0";

function graphBase(version: string): string {
  return `https://graph.facebook.com/${version}`;
}

export function buildMetaAuthorizationUrl(input: { appId: string; redirectUri: string; state: string; scopes?: readonly string[]; version?: string; configId?: string }): string {
  const version = input.version ?? META_DEFAULT_GRAPH_VERSION;
  const url = new URL(`https://www.facebook.com/${version}/dialog/oauth`);
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("response_type", "code");
  // Facebook Login for Business: the configuration carries the permissions; `scope` must not be sent alongside it.
  if (input.configId) url.searchParams.set("config_id", input.configId);
  else url.searchParams.set("scope", (input.scopes ?? META_DEFAULT_SCOPES).join(","));
  return url.toString();
}

/** Code → short-lived user token. */
export async function exchangeMetaCode(fetchImpl: FetchLike, input: { appId: string; appSecret: string; redirectUri: string; code: string; version?: string }): Promise<{ accessToken: string; expiresIn?: number }> {
  const url = withQuery(`${graphBase(input.version ?? META_DEFAULT_GRAPH_VERSION)}/oauth/access_token`, { client_id: input.appId, redirect_uri: input.redirectUri, client_secret: input.appSecret, code: input.code });
  const { data } = await jsonRequest<{ access_token?: string; expires_in?: number }>(fetchImpl, url, { method: "GET" }, { provider: "meta" });
  if (!data?.access_token) throw new SocialProviderError("meta", "token_exchange_failed", "Meta did not return an access token", { retryable: false });
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

/** Short-lived → long-lived (~60 day) user token. */
export async function exchangeMetaLongLivedToken(fetchImpl: FetchLike, input: { appId: string; appSecret: string; accessToken: string; version?: string }): Promise<{ accessToken: string; expiresIn?: number }> {
  const url = withQuery(`${graphBase(input.version ?? META_DEFAULT_GRAPH_VERSION)}/oauth/access_token`, { grant_type: "fb_exchange_token", client_id: input.appId, client_secret: input.appSecret, fb_exchange_token: input.accessToken });
  const { data } = await jsonRequest<{ access_token?: string; expires_in?: number }>(fetchImpl, url, { method: "GET" }, { provider: "meta" });
  if (!data?.access_token) throw new SocialProviderError("meta", "token_exchange_failed", "Meta did not return a long-lived access token", { retryable: false });
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

/** The granting user's id/name (non-secret identity for the connection row). */
export async function fetchMetaPrincipal(fetchImpl: FetchLike, input: { accessToken: string; version?: string }): Promise<{ externalId: string; name?: string }> {
  const { data } = await jsonRequest<{ id: string; name?: string }>(fetchImpl, `${graphBase(input.version ?? META_DEFAULT_GRAPH_VERSION)}/me?fields=id,name`, { method: "GET", headers: { Authorization: `Bearer ${input.accessToken}` } }, { provider: "meta" });
  return { externalId: String(data.id), name: data.name };
}

/** Reads `debug_token` for expiry/scopes. Returns null when the app credentials are unavailable. */
export async function debugMetaToken(fetchImpl: FetchLike, input: { appId?: string; appSecret?: string; token: string; version?: string }): Promise<{ isValid: boolean; expiresAt?: string; scopes: string[] } | null> {
  if (!input.appId || !input.appSecret) return null;
  const url = withQuery(`${graphBase(input.version ?? META_DEFAULT_GRAPH_VERSION)}/debug_token`, { input_token: input.token, access_token: `${input.appId}|${input.appSecret}` });
  const { data } = await jsonRequest<{ data?: { is_valid?: boolean; expires_at?: number; data_access_expires_at?: number; scopes?: string[] } }>(fetchImpl, url, { method: "GET" }, { provider: "meta" });
  const d = data?.data ?? {};
  const expiresAt = typeof d.expires_at === "number" && d.expires_at > 0 ? new Date(d.expires_at * 1000).toISOString() : undefined;
  return { isValid: d.is_valid !== false, expiresAt, scopes: Array.isArray(d.scopes) ? d.scopes : [] };
}

type GraphParams = Record<string, string | number | boolean | undefined | null>;

interface GraphPage<T> {
  data?: T[];
  paging?: { next?: string; cursors?: { after?: string } };
}

const INSIGHT_METRICS_FACEBOOK = ["page_media_view", "page_total_media_view_unique", "page_post_engagements", "page_follows", "page_views_total"];
const INSIGHT_METRICS_INSTAGRAM = ["reach", "views", "accounts_engaged", "total_interactions", "profile_links_taps"];
const POST_METRICS_FACEBOOK = ["post_media_view", "post_total_media_view_unique", "post_clicks", "post_reactions_by_type_total"];
const POST_METRICS_INSTAGRAM = ["reach", "likes", "comments", "shares", "saved", "views", "total_interactions"];

export function createMetaAdapter(env: MetaEnv, deps: MetaAdapterDeps = {}): SocialProviderAdapter {
  const fetchImpl: FetchLike = deps.fetchImpl ?? ((input, init) => fetch(input, init));
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? defaultSleep;
  const version = env.META_GRAPH_API_VERSION || META_DEFAULT_GRAPH_VERSION;
  const base = graphBase(version);
  const pollAttempts = deps.containerPollAttempts ?? 20;
  const pollInterval = deps.containerPollIntervalMs ?? 3000;

  async function graph<T>(method: "GET" | "POST" | "DELETE", path: string, token: string, options: { params?: GraphParams; body?: Record<string, unknown> } = {}): Promise<T> {
    const url = withQuery(path.startsWith("https://") ? path : `${base}${path.startsWith("/") ? "" : "/"}${path}`, options.params ?? {});
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    let body: string | undefined;
    if (options.body) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }
    // Throttling (X-App-Usage / X-Business-Use-Case-Usage at 100%, codes 4/17/80001–80004) is
    // classified retryable inside jsonRequest → classifyProviderError.
    const res = await jsonRequest<T>(fetchImpl, url, { method, headers, body }, { provider: "meta" });
    return res.data;
  }

  async function graphAll<T>(path: string, token: string, params: GraphParams, maxPages = 5): Promise<T[]> {
    const out: T[] = [];
    let page = await graph<GraphPage<T>>("GET", path, token, { params });
    for (let i = 0; i < maxPages; i++) {
      out.push(...(page.data ?? []));
      const next = page.paging?.next;
      if (!next || !next.startsWith(base.replace(/\/v[\d.]+$/, ""))) break;
      page = await graph<GraphPage<T>>("GET", next, token);
    }
    return out;
  }

  function tokenFor(credential: SocialAccountCredential): string {
    return credential.bundle.assets?.[credential.externalAccountId]?.accessToken ?? credential.bundle.accessToken;
  }

  function adAccountPath(externalAccountId: string): string {
    return externalAccountId.startsWith("act_") ? externalAccountId : `act_${externalAccountId}`;
  }

  // ---------------------------------------------------------------------------
  // Discovery & verification
  // ---------------------------------------------------------------------------

  async function discoverAssets(bundle: SocialTokenBundle): Promise<DiscoveredAsset[]> {
    const assets: DiscoveredAsset[] = [];
    const pages = await graphAll<{ id: string; name: string; access_token?: string; category?: string; link?: string; tasks?: string[] }>("/me/accounts", bundle.accessToken, { fields: "id,name,access_token,category,link,tasks", limit: 100 });
    for (const page of pages) {
      assets.push({
        platform: "facebook",
        externalAccountId: String(page.id),
        displayName: page.name,
        externalUrl: page.link ?? `https://www.facebook.com/${page.id}`,
        accountKind: "organic",
        metadata: { category: page.category ?? null, tasks: (page.tasks ?? []).join(",") || null },
        accessToken: page.access_token,
      });
      const pageToken = page.access_token ?? bundle.accessToken;
      const detail = await graph<{ instagram_business_account?: { id: string; username?: string; name?: string; followers_count?: number; profile_picture_url?: string } }>("GET", `/${page.id}`, pageToken, { params: { fields: "instagram_business_account{id,username,name,followers_count,profile_picture_url}" } });
      const ig = detail.instagram_business_account;
      if (ig?.id) {
        assets.push({
          platform: "instagram",
          externalAccountId: String(ig.id),
          displayName: ig.name || ig.username || `Instagram ${ig.id}`,
          handle: ig.username ? `@${ig.username}` : undefined,
          externalUrl: ig.username ? `https://www.instagram.com/${ig.username}` : undefined,
          accountKind: "organic",
          metadata: { followersAtDiscovery: ig.followers_count ?? null, profilePictureUrl: ig.profile_picture_url ?? null, facebookPageId: String(page.id) },
          accessToken: page.access_token,
        });
      }
    }
    let adAccounts: { id: string; account_id: string; name?: string; currency?: string; account_status?: number }[] = [];
    try {
      adAccounts = await graphAll("/me/adaccounts", bundle.accessToken, { fields: "id,account_id,name,currency,account_status", limit: 100 });
    } catch (err) {
      // Missing ads permissions is a normal "this grant has no ad accounts", not a failure.
      if (!(err instanceof SocialProviderError) || err.authorizationLost || err.retryable) throw err;
    }
    for (const acct of adAccounts) {
      assets.push({
        platform: "meta_ads",
        externalAccountId: String(acct.account_id),
        displayName: acct.name || `Ad account ${acct.account_id}`,
        externalUrl: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${acct.account_id}`,
        accountKind: "paid",
        metadata: { currency: acct.currency ?? null, accountStatus: acct.account_status ?? null },
        tokenExpiresAt: bundle.expiresAt,
      });
    }
    return assets;
  }

  async function verify(credential: SocialAccountCredential): Promise<VerifyResult> {
    const token = tokenFor(credential);
    const usesAssetToken = Boolean(credential.bundle.assets?.[credential.externalAccountId]?.accessToken);
    try {
      let detail: string;
      if (credential.platform === "facebook") {
        const d = await graph<{ id: string; name?: string }>("GET", `/${credential.externalAccountId}`, token, { params: { fields: "id,name" } });
        detail = d.name ?? d.id;
      } else if (credential.platform === "instagram") {
        const d = await graph<{ id: string; username?: string }>("GET", `/${credential.externalAccountId}`, token, { params: { fields: "id,username" } });
        detail = d.username ? `@${d.username}` : d.id;
      } else if (credential.platform === "meta_ads") {
        const d = await graph<{ id: string; name?: string }>("GET", `/${adAccountPath(credential.externalAccountId)}`, token, { params: { fields: "id,name" } });
        detail = d.name ?? d.id;
      } else {
        throw new SocialProviderNotSupportedError(credential.platform, "Meta verification");
      }
      let tokenExpiresAt: string | undefined;
      let scopes: string[] | undefined;
      try {
        const dbg = await debugMetaToken(fetchImpl, { appId: env.META_APP_ID, appSecret: env.META_APP_SECRET, token: credential.bundle.accessToken, version });
        if (dbg) {
          if (!dbg.isValid && !usesAssetToken) return { ok: false, detail: "Meta reports the authorization is no longer valid", authorizationLost: true };
          scopes = dbg.scopes;
          if (!usesAssetToken) tokenExpiresAt = dbg.expiresAt;
        }
      } catch {
        // debug_token is advisory — the asset call above is the source of truth.
      }
      return { ok: true, detail, tokenExpiresAt, scopes };
    } catch (err) {
      if (err instanceof SocialProviderError && err.authorizationLost) return { ok: false, detail: err.message, authorizationLost: true };
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Publishing
  // ---------------------------------------------------------------------------

  function mediaUrl(m: PublishMediaInput): string {
    if (!m.url) throw new SocialProviderError("meta", "media_url_required", "Meta needs a publicly reachable media URL", { retryable: false });
    return m.url;
  }

  function isVideo(m: PublishMediaInput): boolean {
    return m.contentType.startsWith("video/");
  }

  function orderedMedia(input: PublishInput): PublishMediaInput[] {
    return [...input.media].filter((m) => m.role !== "thumbnail" && m.role !== "cover").sort((a, b) => a.position - b.position);
  }

  async function publishFacebook(credential: SocialAccountCredential, input: PublishInput): Promise<PublishResult> {
    const token = tokenFor(credential);
    const pageId = credential.externalAccountId;
    const caption = composeCaption(input.body, input.hashtags);
    const media = orderedMedia(input);
    const nowMs = now().getTime();
    const nativeSchedule = input.scheduledFor && input.scheduledFor.getTime() - nowMs >= 10 * 60 * 1000 ? Math.floor(input.scheduledFor.getTime() / 1000) : null;
    const scheduleFields = nativeSchedule ? { published: false, scheduled_publish_time: nativeSchedule } : {};
    const outcome: PublishResult["outcome"] = nativeSchedule ? "scheduled_natively" : "published";

    if (typeof input.providerState.postId === "string") {
      return { outcome, externalPostId: input.providerState.postId, externalPostUrl: `https://www.facebook.com/${input.providerState.postId}` };
    }

    if (input.format === "video" || (media.length === 1 && isVideo(media[0]))) {
      const video = media[0];
      if (!video) throw new SocialProviderError("meta", "media_required", "A video post needs a video", { retryable: false });
      const res = await nonIdempotentCreate("meta", () => graph<{ id: string }>("POST", `/${pageId}/videos`, token, { body: { file_url: mediaUrl(video), description: caption, ...scheduleFields } }));
      return { outcome, externalPostId: res.id, externalPostUrl: `https://www.facebook.com/${pageId}/videos/${res.id}` };
    }

    if (media.length === 1 && (input.format === "image" || input.format === "carousel")) {
      const res = await nonIdempotentCreate("meta", () => graph<{ id: string; post_id?: string }>("POST", `/${pageId}/photos`, token, { body: { url: mediaUrl(media[0]), message: caption, ...scheduleFields } }));
      const postId = res.post_id ?? res.id;
      return { outcome, externalPostId: postId, externalPostUrl: `https://www.facebook.com/${postId}` };
    }

    if (media.length > 1) {
      const existing = Array.isArray(input.providerState.photoIds) ? (input.providerState.photoIds as string[]) : [];
      const photoIds: string[] = existing.length === media.length ? [...existing] : [];
      try {
        for (let i = photoIds.length; i < media.length; i++) {
          const res = await graph<{ id: string }>("POST", `/${pageId}/photos`, token, { body: { url: mediaUrl(media[i]), published: false, ...(media[i].altText ? { alt_text_custom: media[i].altText } : {}) } });
          photoIds.push(res.id);
        }
        const res = await nonIdempotentCreate("meta", () => graph<{ id: string }>("POST", `/${pageId}/feed`, token, { body: { message: caption, attached_media: photoIds.map((id) => ({ media_fbid: id })), ...scheduleFields } }));
        return { outcome, externalPostId: res.id, externalPostUrl: `https://www.facebook.com/${res.id}` };
      } catch (err) {
        if (err instanceof Error) attachProviderState(err, { ...input.providerState, photoIds });
        throw err;
      }
    }

    const res = await nonIdempotentCreate("meta", () => graph<{ id: string }>("POST", `/${pageId}/feed`, token, { body: { message: caption, ...(input.linkUrl ? { link: input.linkUrl } : {}), ...scheduleFields } }));
    return { outcome, externalPostId: res.id, externalPostUrl: `https://www.facebook.com/${res.id}` };
  }

  async function containerStatus(containerId: string, token: string): Promise<string> {
    const res = await graph<{ status_code?: string }>("GET", `/${containerId}`, token, { params: { fields: "status_code" } });
    return res.status_code ?? "IN_PROGRESS";
  }

  /** Polls until FINISHED/PUBLISHED; returns null when still in progress after the poll budget. */
  async function waitForContainer(containerId: string, token: string): Promise<"FINISHED" | "PUBLISHED" | null> {
    for (let i = 0; i < pollAttempts; i++) {
      const status = await containerStatus(containerId, token);
      if (status === "FINISHED" || status === "PUBLISHED") return status;
      if (status === "ERROR" || status === "EXPIRED") throw new SocialProviderError("meta", `ig_container_${status.toLowerCase()}`, `Instagram could not process the media (container ${status})`, { retryable: false });
      if (i < pollAttempts - 1) await sleep(pollInterval);
    }
    return null;
  }

  async function igPermalink(mediaId: string, token: string): Promise<string | undefined> {
    try {
      const res = await graph<{ permalink?: string }>("GET", `/${mediaId}`, token, { params: { fields: "permalink" } });
      return res.permalink;
    } catch {
      return undefined;
    }
  }

  async function publishInstagram(credential: SocialAccountCredential, input: PublishInput): Promise<PublishResult> {
    const token = tokenFor(credential);
    const igId = credential.externalAccountId;
    const caption = composeCaption(input.body, input.hashtags);
    const media = orderedMedia(input);
    const state: Record<string, unknown> = { ...input.providerState };

    if (typeof state.mediaId === "string") {
      return { outcome: "published", externalPostId: state.mediaId, externalPostUrl: await igPermalink(state.mediaId, token), providerState: state };
    }

    try {
      let containerId = typeof state.containerId === "string" ? state.containerId : null;
      if (containerId) {
        const status = await containerStatus(containerId, token);
        if (status === "PUBLISHED") return { outcome: "published", externalPostId: containerId, providerState: state };
        if (status === "ERROR" || status === "EXPIRED") {
          delete state.containerId;
          delete state.childContainerIds;
          throw new SocialProviderError("meta", `ig_container_${status.toLowerCase()}`, `Instagram could not process the media (container ${status}) — retry to upload again`, { retryable: false });
        }
      }

      if (!containerId) {
        if (!media.length) throw new SocialProviderError("meta", "media_required", "Instagram posts need at least one image or video", { retryable: false });
        if (input.format === "carousel" && media.length > 1) {
          const children: string[] = Array.isArray(state.childContainerIds) ? [...(state.childContainerIds as string[])] : [];
          for (let i = children.length; i < media.length; i++) {
            const m = media[i];
            const body: Record<string, unknown> = isVideo(m) ? { media_type: "VIDEO", video_url: mediaUrl(m), is_carousel_item: true } : { image_url: mediaUrl(m), is_carousel_item: true };
            const res = await graph<{ id: string }>("POST", `/${igId}/media`, token, { body });
            children.push(res.id);
            state.childContainerIds = children;
          }
          for (const child of children) {
            const s = await waitForContainer(child, token);
            if (!s) return { outcome: "pending", externalPostId: "", providerState: state };
          }
          const parent = await graph<{ id: string }>("POST", `/${igId}/media`, token, { body: { media_type: "CAROUSEL", children: children.join(","), caption } });
          containerId = parent.id;
        } else {
          const m = media[0];
          let body: Record<string, unknown>;
          if (input.format === "reel" || (isVideo(m) && input.format !== "story")) {
            body = { media_type: "REELS", video_url: mediaUrl(m), caption, ...(typeof input.platformOptions.shareToFeed === "boolean" ? { share_to_feed: input.platformOptions.shareToFeed } : {}) };
          } else if (input.format === "story") {
            body = isVideo(m) ? { media_type: "STORIES", video_url: mediaUrl(m) } : { media_type: "STORIES", image_url: mediaUrl(m) };
          } else {
            body = { image_url: mediaUrl(m), caption };
          }
          const res = await graph<{ id: string }>("POST", `/${igId}/media`, token, { body });
          containerId = res.id;
        }
        // Persisted before publishing so a retry resumes this container instead of creating another.
        state.containerId = containerId;
      }

      const ready = await waitForContainer(containerId, token);
      if (!ready) return { outcome: "pending", externalPostId: "", providerState: state };
      if (ready === "PUBLISHED") return { outcome: "published", externalPostId: containerId, providerState: state };

      const published = await graph<{ id: string }>("POST", `/${igId}/media_publish`, token, { body: { creation_id: containerId } });
      state.mediaId = published.id;
      return { outcome: "published", externalPostId: published.id, externalPostUrl: await igPermalink(published.id, token), providerState: state };
    } catch (err) {
      if (err instanceof Error) attachProviderState(err, state);
      throw err;
    }
  }

  async function publish(credential: SocialAccountCredential, input: PublishInput): Promise<PublishResult> {
    if (credential.platform === "facebook") return publishFacebook(credential, input);
    if (credential.platform === "instagram") return publishInstagram(credential, input);
    throw new SocialProviderNotSupportedError(credential.platform, "publishing");
  }

  // ---------------------------------------------------------------------------
  // Insights
  // ---------------------------------------------------------------------------

  type InsightRow = { name: string; values?: { value: unknown }[]; total_value?: { value: unknown } };

  function sumValue(value: unknown): number | undefined {
    const n = numberOrUndefined(value);
    if (n !== undefined) return n;
    if (value && typeof value === "object") {
      let total = 0;
      let any = false;
      for (const v of Object.values(value as Record<string, unknown>)) {
        const x = numberOrUndefined(v);
        if (x !== undefined) {
          total += x;
          any = true;
        }
      }
      return any ? total : undefined;
    }
    return undefined;
  }

  function totals(rows: InsightRow[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const row of rows) {
      let total: number | undefined;
      if (row.total_value) total = sumValue(row.total_value.value);
      else
        for (const v of row.values ?? []) {
          const x = sumValue(v.value);
          if (x !== undefined) total = (total ?? 0) + x;
        }
      if (total !== undefined) out[row.name] = total;
    }
    return out;
  }

  /** Requests all metrics at once; if Meta rejects the set (a deprecated metric → code 100), falls back to one metric per call, skipping the invalid ones. */
  async function insightsResilient(path: string, token: string, metrics: string[], params: GraphParams): Promise<InsightRow[]> {
    try {
      const res = await graph<{ data?: InsightRow[] }>("GET", path, token, { params: { ...params, metric: metrics.join(",") } });
      return res.data ?? [];
    } catch (err) {
      if (!(err instanceof SocialProviderError) || err.authorizationLost || err.retryable || metrics.length === 1) throw err;
      const rows: InsightRow[] = [];
      for (const metric of metrics) {
        try {
          const res = await graph<{ data?: InsightRow[] }>("GET", path, token, { params: { ...params, metric } });
          rows.push(...(res.data ?? []));
        } catch (inner) {
          if (inner instanceof SocialProviderError && (inner.authorizationLost || inner.retryable)) throw inner;
        }
      }
      return rows;
    }
  }

  async function fetchAccountInsights(credential: SocialAccountCredential, range: { since: Date; until: Date }): Promise<AccountInsights | null> {
    const token = tokenFor(credential);
    const id = credential.externalAccountId;
    const since = Math.floor(range.since.getTime() / 1000);
    const until = Math.floor(range.until.getTime() / 1000);
    if (credential.platform === "facebook") {
      const rows = await insightsResilient(`/${id}/insights`, token, INSIGHT_METRICS_FACEBOOK, { period: "day", since, until });
      const t = totals(rows);
      const page = await graph<{ followers_count?: number; fan_count?: number }>("GET", `/${id}`, token, { params: { fields: "followers_count,fan_count" } });
      return {
        periodStart: range.since,
        periodEnd: range.until,
        followers: numberOrUndefined(page.followers_count) ?? numberOrUndefined(page.fan_count),
        views: t.page_media_view,
        reach: t.page_total_media_view_unique,
        engagements: t.page_post_engagements,
        profileViews: t.page_views_total,
        extra: t,
      };
    }
    if (credential.platform === "instagram") {
      const rows = await insightsResilient(`/${id}/insights`, token, INSIGHT_METRICS_INSTAGRAM, { period: "day", metric_type: "total_value", since, until });
      const t = totals(rows);
      const ig = await graph<{ followers_count?: number }>("GET", `/${id}`, token, { params: { fields: "followers_count" } });
      return {
        periodStart: range.since,
        periodEnd: range.until,
        followers: numberOrUndefined(ig.followers_count),
        reach: t.reach,
        views: t.views,
        engagements: t.total_interactions,
        extra: t,
      };
    }
    return null;
  }

  async function fetchPostInsights(credential: SocialAccountCredential, externalPostIds: string[]): Promise<PostInsights[]> {
    const token = tokenFor(credential);
    const out: PostInsights[] = [];
    for (const postId of externalPostIds) {
      try {
        if (credential.platform === "facebook") {
          const rows = await insightsResilient(`/${postId}/insights`, token, POST_METRICS_FACEBOOK, {});
          const t = totals(rows);
          out.push({ externalPostId: postId, views: t.post_media_view, reach: t.post_total_media_view_unique, clicks: t.post_clicks, likes: t.post_reactions_by_type_total, extra: t });
        } else if (credential.platform === "instagram") {
          const rows = await insightsResilient(`/${postId}/insights`, token, POST_METRICS_INSTAGRAM, {});
          const t = totals(rows);
          out.push({ externalPostId: postId, reach: t.reach, likes: t.likes, comments: t.comments, shares: t.shares, saves: t.saved, views: t.views, extra: t });
        }
      } catch (err) {
        if (err instanceof SocialProviderError && (err.authorizationLost || err.retryable)) throw err;
        // A single deleted/unsupported post must not sink the whole sync.
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Engagement
  // ---------------------------------------------------------------------------

  async function fetchEngagement(credential: SocialAccountCredential, options: { since?: Date | null; externalPostIds?: string[] }): Promise<FetchedEngagementItem[]> {
    const token = tokenFor(credential);
    const id = credential.externalAccountId;
    const sinceMs = options.since?.getTime() ?? 0;
    const items: FetchedEngagementItem[] = [];

    if (credential.platform === "facebook") {
      const postIds = options.externalPostIds?.length ? options.externalPostIds : (await graph<GraphPage<{ id: string }>>("GET", `/${id}/feed`, token, { params: { fields: "id", limit: 25 } })).data?.map((p) => p.id) ?? [];
      for (const postId of postIds) {
        const res = await graph<GraphPage<{ id: string; message?: string; from?: { id: string; name?: string }; created_time: string; parent?: { id: string }; permalink_url?: string }>>("GET", `/${postId}/comments`, token, {
          params: { fields: "id,message,from{id,name},created_time,parent{id},permalink_url", filter: "stream", limit: 100, ...(sinceMs ? { since: Math.floor(sinceMs / 1000) } : {}) },
        });
        for (const c of res.data ?? []) {
          if (c.from?.id === id) continue; // our own replies
          const postedAt = new Date(c.created_time);
          if (sinceMs && postedAt.getTime() < sinceMs) continue;
          items.push({ itemType: "comment", externalId: c.id, externalParentId: c.parent?.id ?? null, externalPostId: postId, externalUrl: c.permalink_url ?? null, authorExternalId: c.from?.id ?? null, authorName: c.from?.name ?? null, authorHandle: null, text: c.message ?? "", postedAt });
        }
      }
      return items;
    }

    if (credential.platform === "instagram") {
      let username: string | null = null;
      const media = options.externalPostIds?.length
        ? options.externalPostIds.map((mid) => ({ id: mid, permalink: undefined as string | undefined }))
        : ((await graph<GraphPage<{ id: string; permalink?: string }>>("GET", `/${id}/media`, token, { params: { fields: "id,permalink", limit: 25 } })).data ?? []);
      try {
        username = (await graph<{ username?: string }>("GET", `/${id}`, token, { params: { fields: "username" } })).username ?? null;
      } catch (err) {
        if (err instanceof SocialProviderError && err.authorizationLost) throw err;
      }
      for (const m of media) {
        const res = await graph<GraphPage<{ id: string; text?: string; username?: string; timestamp: string; from?: { id: string; username?: string }; parent_id?: string }>>("GET", `/${m.id}/comments`, token, {
          params: { fields: "id,text,username,timestamp,from{id,username},parent_id", limit: 100, ...(sinceMs ? { since: Math.floor(sinceMs / 1000) } : {}) },
        });
        for (const c of res.data ?? []) {
          const author = c.from?.username ?? c.username ?? null;
          if (username && author === username) continue;
          const postedAt = new Date(c.timestamp);
          if (sinceMs && postedAt.getTime() < sinceMs) continue;
          items.push({ itemType: "comment", externalId: c.id, externalParentId: c.parent_id ?? null, externalPostId: m.id, externalUrl: m.permalink ?? null, authorExternalId: c.from?.id ?? null, authorName: null, authorHandle: author ? `@${author}` : null, text: c.text ?? "", postedAt });
        }
      }
      try {
        const tags = await graph<GraphPage<{ id: string; caption?: string; permalink?: string; timestamp: string; username?: string }>>("GET", `/${id}/tags`, token, { params: { fields: "id,caption,permalink,timestamp,username", limit: 25 } });
        for (const t of tags.data ?? []) {
          const postedAt = new Date(t.timestamp);
          if (sinceMs && postedAt.getTime() < sinceMs) continue;
          items.push({ itemType: "mention", externalId: t.id, externalParentId: null, externalPostId: t.id, externalUrl: t.permalink ?? null, authorExternalId: null, authorName: null, authorHandle: t.username ? `@${t.username}` : null, text: t.caption ?? "", postedAt });
        }
      } catch (err) {
        if (err instanceof SocialProviderError && (err.authorizationLost || err.retryable)) throw err;
      }
      return items;
    }

    throw new SocialProviderNotSupportedError(credential.platform, "engagement sync");
  }

  async function replyToEngagement(credential: SocialAccountCredential, item: { itemType: string; externalId: string; externalPostId?: string | null }, message: string): Promise<{ externalReplyId: string }> {
    const token = tokenFor(credential);
    if (item.itemType !== "comment") throw new SocialProviderNotSupportedError(credential.platform, `replying to a ${item.itemType}`);
    if (credential.platform === "facebook") {
      const res = await nonIdempotentCreate("meta", () => graph<{ id: string }>("POST", `/${item.externalId}/comments`, token, { body: { message } }));
      return { externalReplyId: res.id };
    }
    if (credential.platform === "instagram") {
      const res = await nonIdempotentCreate("meta", () => graph<{ id: string }>("POST", `/${item.externalId}/replies`, token, { body: { message } }));
      return { externalReplyId: res.id };
    }
    throw new SocialProviderNotSupportedError(credential.platform, "replies");
  }

  async function hideEngagement(credential: SocialAccountCredential, item: { itemType: string; externalId: string }): Promise<void> {
    const token = tokenFor(credential);
    if (item.itemType !== "comment") throw new SocialProviderNotSupportedError(credential.platform, `hiding a ${item.itemType}`);
    if (credential.platform === "facebook") {
      await graph("POST", `/${item.externalId}`, token, { body: { is_hidden: true } });
      return;
    }
    if (credential.platform === "instagram") {
      await graph("POST", `/${item.externalId}`, token, { body: { hide: true } });
      return;
    }
    throw new SocialProviderNotSupportedError(credential.platform, "hiding comments");
  }

  // ---------------------------------------------------------------------------
  // Ads
  // ---------------------------------------------------------------------------

  async function listAdCampaigns(credential: SocialAccountCredential, range: { since: Date; until: Date }): Promise<AdCampaignRecord[]> {
    if (credential.platform !== "meta_ads") throw new SocialProviderNotSupportedError(credential.platform, "ad campaigns");
    const token = tokenFor(credential);
    const act = adAccountPath(credential.externalAccountId);
    const account = await graph<{ currency?: string }>("GET", `/${act}`, token, { params: { fields: "currency" } });
    const currency = account.currency ?? "USD";
    const campaigns = await graphAll<{ id: string; name: string; status: string; objective?: string; daily_budget?: string; lifetime_budget?: string }>(`/${act}/campaigns`, token, { fields: "id,name,status,objective,daily_budget,lifetime_budget", limit: 100 });
    const insights = await graphAll<{ campaign_id: string; spend?: string; impressions?: string; clicks?: string; reach?: string; cpc?: string; cpm?: string; ctr?: string; actions?: { action_type: string; value: string }[] }>(`/${act}/insights`, token, {
      level: "campaign",
      fields: "campaign_id,spend,impressions,clicks,reach,cpc,cpm,ctr,actions",
      time_range: JSON.stringify({ since: isoDate(range.since), until: isoDate(range.until) }),
      limit: 100,
    });
    const byCampaign = new Map(insights.map((i) => [String(i.campaign_id), i]));
    return campaigns.map((c) => {
      const i = byCampaign.get(String(c.id));
      const metrics: Record<string, number | string> = {};
      for (const key of ["cpc", "cpm", "ctr"] as const) {
        const v = numberOrUndefined(i?.[key]);
        if (v !== undefined) metrics[key] = v;
      }
      for (const a of i?.actions ?? []) {
        const v = numberOrUndefined(a.value);
        if (v !== undefined) metrics[`action:${a.action_type}`] = v;
      }
      const spend = numberOrUndefined(i?.spend);
      return {
        externalCampaignId: String(c.id),
        name: c.name,
        status: c.status,
        objective: c.objective ?? null,
        currency,
        dailyBudgetMinor: numberOrUndefined(c.daily_budget) ?? null,
        lifetimeBudgetMinor: numberOrUndefined(c.lifetime_budget) ?? null,
        periodStart: range.since,
        periodEnd: range.until,
        spendMinor: spend === undefined ? null : Math.round(spend * 100),
        impressions: numberOrUndefined(i?.impressions) ?? null,
        clicks: numberOrUndefined(i?.clicks) ?? null,
        reach: numberOrUndefined(i?.reach) ?? null,
        conversions: null,
        metrics,
      };
    });
  }

  async function executeAdChange(credential: SocialAccountCredential, input: AdChangeExecutionInput): Promise<AdChangeExecutionResult> {
    if (credential.platform !== "meta_ads") throw new SocialProviderNotSupportedError(credential.platform, "ad changes");
    if (!(SOCIAL_AD_CHANGE_TYPES as readonly string[]).includes(input.changeType)) throw new SocialProviderNotSupportedError("meta_ads", input.changeType);
    const changeType = input.changeType as SocialAdChangeType;
    const token = tokenFor(credential);
    const act = adAccountPath(credential.externalAccountId);
    switch (changeType) {
      case "create_campaign": {
        const p = socialAdChangePayloadSchemas.create_campaign.parse(input.payload);
        const body: Record<string, unknown> = { name: p.name, objective: p.objective, status: "PAUSED", special_ad_categories: p.specialAdCategories };
        if (p.dailyBudgetMinor !== undefined) body.daily_budget = p.dailyBudgetMinor;
        if (p.lifetimeBudgetMinor !== undefined) body.lifetime_budget = p.lifetimeBudgetMinor;
        if (p.dailyBudgetMinor === undefined && p.lifetimeBudgetMinor === undefined) body.is_adset_budget_sharing_enabled = false;
        const res = await graph<{ id: string }>("POST", `/${act}/campaigns`, token, { body });
        return { externalIds: { campaignId: res.id }, summary: `Created paused campaign "${p.name}"` };
      }
      case "update_budget": {
        const p = socialAdChangePayloadSchemas.update_budget.parse(input.payload);
        const body: Record<string, unknown> = {};
        if (p.dailyBudgetMinor !== undefined) body.daily_budget = p.dailyBudgetMinor;
        if (p.lifetimeBudgetMinor !== undefined) body.lifetime_budget = p.lifetimeBudgetMinor;
        await graph("POST", `/${p.externalCampaignId}`, token, { body });
        return { externalIds: { campaignId: p.externalCampaignId }, summary: `Updated budget on campaign ${p.externalCampaignId}` };
      }
      case "pause_campaign":
      case "resume_campaign": {
        const p = socialAdChangePayloadSchemas[changeType].parse(input.payload);
        const status = changeType === "pause_campaign" ? "PAUSED" : "ACTIVE";
        await graph("POST", `/${p.externalCampaignId}`, token, { body: { status } });
        return { externalIds: { campaignId: p.externalCampaignId }, summary: `Set campaign ${p.externalCampaignId} to ${status}` };
      }
      default:
        throw new SocialProviderNotSupportedError("meta_ads", changeType);
    }
  }

  return {
    provider: "meta",
    platforms: ["facebook", "instagram", "meta_ads"],
    missingConfiguration() {
      const missing: string[] = [];
      if (!env.META_APP_ID) missing.push("META_APP_ID");
      if (!env.META_APP_SECRET) missing.push("META_APP_SECRET");
      return missing;
    },
    verify,
    discoverAssets,
    publish,
    fetchAccountInsights,
    fetchPostInsights,
    fetchEngagement,
    replyToEngagement,
    hideEngagement,
    listAdCampaigns,
    executeAdChange,
  };
}
