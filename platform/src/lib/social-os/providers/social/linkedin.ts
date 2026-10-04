import { SocialProviderError, SocialProviderNotSupportedError } from "../../errors";
import { socialAdChangePayloadSchemas, SOCIAL_AD_CHANGE_TYPES, type SocialAdChangeType } from "../../validation";
import { jsonRequest, formBody, numberOrUndefined, defaultSleep, attachProviderState, nonIdempotentCreate } from "./http";
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
 * Module 19 — LinkedIn adapter (organization Pages + the member's own
 * profile through the Posts API, and Campaign Manager ad accounts).
 *
 * External configuration: the LinkedIn developer app must have the
 * "Sign In with LinkedIn using OpenID Connect", "Community Management API"
 * (organization posting, comments, page statistics) and "Advertising API"
 * (ad accounts, campaigns, analytics) products enabled — without them the
 * corresponding scopes are refused at consent time and discovery simply
 * returns fewer assets.
 *
 * Every REST call sends `LinkedIn-Version: YYYYMM` and
 * `X-Restli-Protocol-Version: 2.0.0`. Rest.li query syntax (`List(...)`,
 * `(key:value)`) is built by hand: URN components are percent-encoded,
 * structural characters are not.
 */

export interface LinkedInEnv {
  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;
  LINKEDIN_API_VERSION?: string;
  /** Space-separated scope override — set to `LINKEDIN_FULL_SCOPES` once Community Management / Advertising API access is approved. */
  LINKEDIN_SCOPES?: string;
}

export interface LinkedInAdapterDeps {
  fetchImpl?: FetchLike;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  videoPollAttempts?: number;
  videoPollIntervalMs?: number;
}

/**
 * Scopes every LinkedIn app can request without an approved partner
 * product ("Sign In with LinkedIn using OpenID Connect" + "Share on
 * LinkedIn"): posting as the member. LinkedIn rejects the whole
 * authorization request if any scope the app isn't approved for is
 * included, so this is the default; organization pages and ads need
 * `LINKEDIN_SCOPES` set to the full list below after approval.
 */
export const LINKEDIN_DEFAULT_SCOPES = ["openid", "profile", "email", "w_member_social"] as const;

/** Community Management API + Advertising API scopes (require approved products on the app). */
export const LINKEDIN_FULL_SCOPES = [
  "openid",
  "profile",
  "email",
  "r_basicprofile",
  "r_organization_social",
  "w_organization_social",
  "rw_organization_admin",
  "r_organization_admin",
  "w_member_social",
  "r_ads",
  "r_ads_reporting",
  "rw_ads",
] as const;

/** `LINKEDIN_SCOPES` (space/comma separated) when set and well-formed, otherwise the self-serve default. */
export function resolveLinkedInScopes(env: Pick<LinkedInEnv, "LINKEDIN_SCOPES">): string[] {
  const raw = env.LINKEDIN_SCOPES?.trim();
  if (!raw) return [...LINKEDIN_DEFAULT_SCOPES];
  const scopes = raw.split(/[\s,]+/).filter((s) => /^[a-z_]+$/.test(s));
  return scopes.length ? Array.from(new Set(scopes)) : [...LINKEDIN_DEFAULT_SCOPES];
}

export const LINKEDIN_DEFAULT_API_VERSION = "202509";
const REST = "https://api.linkedin.com/rest";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";

export function buildLinkedInAuthorizationUrl(input: { clientId: string; redirectUri: string; state: string; scopes?: readonly string[] }): string {
  const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("scope", (input.scopes ?? LINKEDIN_DEFAULT_SCOPES).join(" "));
  return url.toString();
}

interface LinkedInTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
}

export interface LinkedInTokenResult {
  accessToken: string;
  expiresAt?: string;
  refreshToken?: string;
  refreshTokenExpiresAt?: string;
  scopes?: string[];
}

function toTokenResult(data: LinkedInTokenResponse, now: Date): LinkedInTokenResult {
  if (!data?.access_token) throw new SocialProviderError("linkedin", "token_exchange_failed", "LinkedIn did not return an access token", { retryable: false });
  return {
    accessToken: data.access_token,
    expiresAt: typeof data.expires_in === "number" ? new Date(now.getTime() + data.expires_in * 1000).toISOString() : undefined,
    refreshToken: data.refresh_token,
    refreshTokenExpiresAt: typeof data.refresh_token_expires_in === "number" ? new Date(now.getTime() + data.refresh_token_expires_in * 1000).toISOString() : undefined,
    scopes: data.scope ? data.scope.split(/[ ,]+/).filter(Boolean) : undefined,
  };
}

export async function exchangeLinkedInCode(fetchImpl: FetchLike, input: { clientId: string; clientSecret: string; redirectUri: string; code: string; now?: Date }): Promise<LinkedInTokenResult> {
  const { data } = await jsonRequest<LinkedInTokenResponse>(
    fetchImpl,
    TOKEN_URL,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: formBody({ grant_type: "authorization_code", code: input.code, client_id: input.clientId, client_secret: input.clientSecret, redirect_uri: input.redirectUri }) },
    { provider: "linkedin" },
  );
  return toTokenResult(data, input.now ?? new Date());
}

export async function refreshLinkedInToken(fetchImpl: FetchLike, input: { clientId: string; clientSecret: string; refreshToken: string; now?: Date }): Promise<LinkedInTokenResult> {
  const { data } = await jsonRequest<LinkedInTokenResponse>(
    fetchImpl,
    TOKEN_URL,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: formBody({ grant_type: "refresh_token", refresh_token: input.refreshToken, client_id: input.clientId, client_secret: input.clientSecret }) },
    { provider: "linkedin" },
  );
  return toTokenResult(data, input.now ?? new Date());
}

/** OIDC userinfo — the member's stable id (`sub`) and name. */
export async function fetchLinkedInPrincipal(fetchImpl: FetchLike, accessToken: string): Promise<{ externalId: string; name?: string }> {
  const { data } = await jsonRequest<{ sub: string; name?: string }>(fetchImpl, "https://api.linkedin.com/v2/userinfo", { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } }, { provider: "linkedin" });
  return { externalId: String(data.sub), name: data.name };
}

/** `person:{id}` → member author; anything else is an organization id. */
export function linkedInAuthorUrn(externalAccountId: string): string {
  return externalAccountId.startsWith("person:") ? `urn:li:person:${externalAccountId.slice("person:".length)}` : `urn:li:organization:${externalAccountId}`;
}

/** LinkedIn "little text" format: reserved characters must be escaped or the commentary is truncated/rejected. */
export function escapeLittleText(text: string): string {
  return text.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);
}

export function linkedInCommentary(body: string, hashtags: string[]): string {
  const tags = hashtags
    .map((t) => t.trim().replace(/^#+/, ""))
    .filter(Boolean)
    .map((t) => `{hashtag|\\#|${t}}`);
  const text = escapeLittleText(body.trim());
  if (!tags.length) return text;
  return text ? `${text}\n\n${tags.join(" ")}` : tags.join(" ");
}

function ymd(d: Date): string {
  return `(year:${d.getUTCFullYear()},month:${d.getUTCMonth() + 1},day:${d.getUTCDate()})`;
}

export function createLinkedInAdapter(env: LinkedInEnv, deps: LinkedInAdapterDeps = {}): SocialProviderAdapter {
  const fetchImpl: FetchLike = deps.fetchImpl ?? ((input, init) => fetch(input, init));
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? defaultSleep;
  const apiVersion = env.LINKEDIN_API_VERSION || LINKEDIN_DEFAULT_API_VERSION;
  const videoPollAttempts = deps.videoPollAttempts ?? 20;
  const videoPollInterval = deps.videoPollIntervalMs ?? 3000;

  function headers(token: string, extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${token}`, "LinkedIn-Version": apiVersion, "X-Restli-Protocol-Version": "2.0.0", ...extra };
  }

  async function rest<T>(method: "GET" | "POST" | "DELETE", pathAndQuery: string, token: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
    const init: RequestInit = { method, headers: headers(token, body !== undefined ? { "Content-Type": "application/json", ...extraHeaders } : extraHeaders) };
    if (body !== undefined) init.body = JSON.stringify(body);
    return jsonRequest<T>(fetchImpl, `${REST}${pathAndQuery}`, init, { provider: "linkedin" });
  }

  const enc = encodeURIComponent;

  function isSoftFailure(err: unknown): boolean {
    return err instanceof SocialProviderError && !err.authorizationLost && !err.retryable;
  }

  // ---------------------------------------------------------------------------
  // Discovery & verification
  // ---------------------------------------------------------------------------

  async function discoverAssets(bundle: SocialTokenBundle): Promise<DiscoveredAsset[]> {
    const token = bundle.accessToken;
    const assets: DiscoveredAsset[] = [];

    // Organizations the member administers. (The `organization~` projection
    // decoration is not reliably available on the versioned REST API, so we
    // resolve each organization individually.)
    try {
      const { data } = await rest<{ elements?: { organization?: string; role?: string; state?: string }[] }>("GET", "/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED", token);
      for (const acl of data?.elements ?? []) {
        const urn = acl.organization;
        if (!urn) continue;
        const id = urn.split(":").pop()!;
        let name = `LinkedIn organization ${id}`;
        let vanity: string | undefined;
        try {
          const org = await rest<{ localizedName?: string; vanityName?: string }>("GET", `/organizations/${enc(id)}`, token);
          name = org.data?.localizedName ?? name;
          vanity = org.data?.vanityName;
        } catch (err) {
          if (!isSoftFailure(err)) throw err;
        }
        assets.push({
          platform: "linkedin",
          externalAccountId: id,
          displayName: name,
          handle: vanity,
          externalUrl: vanity ? `https://www.linkedin.com/company/${vanity}` : `https://www.linkedin.com/company/${id}`,
          accountKind: "organic",
          metadata: { authorUrn: urn, principalType: "organization", role: acl.role ?? null },
        });
      }
    } catch (err) {
      if (!isSoftFailure(err)) throw err;
    }

    // The member's own profile (posting as a person, w_member_social).
    try {
      const member = await fetchLinkedInPrincipal(fetchImpl, token);
      assets.push({
        platform: "linkedin",
        externalAccountId: `person:${member.externalId}`,
        displayName: member.name ?? "LinkedIn member",
        accountKind: "organic",
        metadata: { authorUrn: `urn:li:person:${member.externalId}`, principalType: "member" },
      });
    } catch (err) {
      if (!isSoftFailure(err)) throw err;
    }

    // Campaign Manager ad accounts (Advertising API).
    try {
      const { data } = await rest<{ elements?: { id: number | string; name?: string; currency?: string; status?: string; reference?: string; type?: string }[] }>("GET", "/adAccounts?q=search&search=(status:(values:List(ACTIVE)))", token);
      for (const acct of data?.elements ?? []) {
        assets.push({
          platform: "linkedin_ads",
          externalAccountId: String(acct.id),
          displayName: acct.name || `LinkedIn ad account ${acct.id}`,
          externalUrl: `https://www.linkedin.com/campaignmanager/accounts/${acct.id}/campaigns`,
          accountKind: "paid",
          metadata: { currency: acct.currency ?? null, status: acct.status ?? null, type: acct.type ?? null },
        });
      }
    } catch (err) {
      if (!isSoftFailure(err)) throw err;
    }
    return assets;
  }

  async function verify(credential: SocialAccountCredential): Promise<VerifyResult> {
    const token = credential.bundle.accessToken;
    try {
      let detail: string;
      if (credential.platform === "linkedin_ads") {
        const { data } = await rest<{ id: number; name?: string }>("GET", `/adAccounts/${enc(credential.externalAccountId)}`, token);
        detail = data?.name ?? String(credential.externalAccountId);
      } else if (credential.externalAccountId.startsWith("person:")) {
        const member = await fetchLinkedInPrincipal(fetchImpl, token);
        detail = member.name ?? member.externalId;
      } else {
        const { data } = await rest<{ localizedName?: string }>("GET", `/organizations/${enc(credential.externalAccountId)}`, token);
        detail = data?.localizedName ?? credential.externalAccountId;
      }
      return { ok: true, detail, tokenExpiresAt: credential.bundle.refreshToken ? undefined : credential.bundle.expiresAt };
    } catch (err) {
      if (err instanceof SocialProviderError && err.authorizationLost) return { ok: false, detail: err.message, authorizationLost: true };
      throw err;
    }
  }

  async function refresh(bundle: SocialTokenBundle): Promise<SocialTokenBundle> {
    if (!bundle.refreshToken) throw new SocialProviderNotSupportedError("linkedin", "token refresh without a refresh token (programmatic refresh is limited to approved partners)");
    if (!env.LINKEDIN_CLIENT_ID || !env.LINKEDIN_CLIENT_SECRET) throw new SocialProviderError("linkedin", "not_configured", "LinkedIn client credentials are not configured", { retryable: false });
    const res = await refreshLinkedInToken(fetchImpl, { clientId: env.LINKEDIN_CLIENT_ID, clientSecret: env.LINKEDIN_CLIENT_SECRET, refreshToken: bundle.refreshToken, now: now() });
    return {
      ...bundle,
      accessToken: res.accessToken,
      expiresAt: res.expiresAt,
      refreshToken: res.refreshToken ?? bundle.refreshToken,
      scopes: res.scopes ?? bundle.scopes,
      ...(res.refreshTokenExpiresAt ? { refreshTokenExpiresAt: res.refreshTokenExpiresAt } : {}),
    } as SocialTokenBundle;
  }

  // ---------------------------------------------------------------------------
  // Publishing
  // ---------------------------------------------------------------------------

  async function mediaBytes(m: PublishMediaInput): Promise<Uint8Array> {
    if (m.bytes) return m.bytes;
    if (!m.url) throw new SocialProviderError("linkedin", "media_bytes_required", "LinkedIn uploads need the media bytes or a fetchable URL", { retryable: false });
    let res: Response;
    try {
      res = await fetchImpl(m.url, { method: "GET" });
    } catch {
      throw new SocialProviderError("linkedin", "media_fetch_failed", "Could not download the media to upload to LinkedIn", { retryable: true });
    }
    if (!res.ok) throw new SocialProviderError("linkedin", "media_fetch_failed", `Could not download the media to upload to LinkedIn (HTTP ${res.status})`, { retryable: res.status >= 500 });
    return new Uint8Array(await res.arrayBuffer());
  }

  async function putBytes(uploadUrl: string, token: string, bytes: Uint8Array, contentType: string): Promise<string | null> {
    let res: Response;
    try {
      res = await fetchImpl(uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType || "application/octet-stream" }, body: bytes as unknown as BodyInit });
    } catch {
      throw new SocialProviderError("linkedin", "upload_failed", "Uploading media to LinkedIn failed", { retryable: true });
    }
    if (!res.ok) throw new SocialProviderError("linkedin", "upload_failed", `Uploading media to LinkedIn failed (HTTP ${res.status})`, { retryable: res.status === 429 || res.status >= 500, authorizationLost: res.status === 401 });
    return res.headers.get("etag");
  }

  async function uploadImage(token: string, owner: string, m: PublishMediaInput): Promise<string> {
    const { data } = await rest<{ value?: { uploadUrl?: string; image?: string } }>("POST", "/images?action=initializeUpload", token, { initializeUploadRequest: { owner } });
    const uploadUrl = data?.value?.uploadUrl;
    const image = data?.value?.image;
    if (!uploadUrl || !image) throw new SocialProviderError("linkedin", "upload_init_failed", "LinkedIn did not return an image upload URL", { retryable: true });
    await putBytes(uploadUrl, token, await mediaBytes(m), m.contentType);
    return image;
  }

  async function uploadVideo(token: string, owner: string, m: PublishMediaInput): Promise<string> {
    const bytes = await mediaBytes(m);
    const { data } = await rest<{ value?: { video?: string; uploadToken?: string; uploadInstructions?: { uploadUrl: string; firstByte: number; lastByte: number }[] } }>("POST", "/videos?action=initializeUpload", token, {
      initializeUploadRequest: { owner, fileSizeBytes: bytes.byteLength, uploadCaptions: false, uploadThumbnail: false },
    });
    const video = data?.value?.video;
    const instructions = data?.value?.uploadInstructions ?? [];
    if (!video || !instructions.length) throw new SocialProviderError("linkedin", "upload_init_failed", "LinkedIn did not return video upload instructions", { retryable: true });
    const etags: string[] = [];
    for (const part of instructions) {
      const etag = await putBytes(part.uploadUrl, token, bytes.subarray(part.firstByte, part.lastByte + 1), "application/octet-stream");
      if (!etag) throw new SocialProviderError("linkedin", "upload_failed", "LinkedIn did not acknowledge a video part", { retryable: true });
      etags.push(etag);
    }
    await rest("POST", "/videos?action=finalizeUpload", token, { finalizeUploadRequest: { video, uploadToken: data?.value?.uploadToken ?? "", uploadedPartIds: etags } });
    return video;
  }

  async function waitForVideo(token: string, video: string): Promise<boolean> {
    for (let i = 0; i < videoPollAttempts; i++) {
      const { data } = await rest<{ status?: string }>("GET", `/videos/${enc(video)}`, token);
      if (data?.status === "AVAILABLE") return true;
      if (data?.status === "PROCESSING_FAILED") throw new SocialProviderError("linkedin", "video_processing_failed", "LinkedIn could not process the video", { retryable: false });
      if (i < videoPollAttempts - 1) await sleep(videoPollInterval);
    }
    return false;
  }

  async function publish(credential: SocialAccountCredential, input: PublishInput): Promise<PublishResult> {
    if (credential.platform !== "linkedin") throw new SocialProviderNotSupportedError(credential.platform, "publishing");
    const token = credential.bundle.accessToken;
    const author = linkedInAuthorUrn(credential.externalAccountId);
    const state: Record<string, unknown> = { ...input.providerState };
    if (typeof state.postUrn === "string") return { outcome: "published", externalPostId: state.postUrn, externalPostUrl: `https://www.linkedin.com/feed/update/${state.postUrn}`, providerState: state };

    const mediaUrns: Record<string, string> = state.mediaUrns && typeof state.mediaUrns === "object" ? { ...(state.mediaUrns as Record<string, string>) } : {};
    const media = [...input.media].filter((m) => m.role !== "thumbnail" && m.role !== "cover").sort((a, b) => a.position - b.position);

    try {
      let content: Record<string, unknown> | undefined;
      if (input.format === "video") {
        const m = media[0];
        if (!m) throw new SocialProviderError("linkedin", "media_required", "A video post needs a video", { retryable: false });
        if (!mediaUrns[m.assetId]) {
          mediaUrns[m.assetId] = await uploadVideo(token, author, m);
          state.mediaUrns = mediaUrns;
        }
        const ready = await waitForVideo(token, mediaUrns[m.assetId]);
        if (!ready) return { outcome: "pending", externalPostId: "", providerState: state };
        content = { media: { id: mediaUrns[m.assetId], ...(typeof input.platformOptions.title === "string" ? { title: input.platformOptions.title } : {}) } };
      } else if ((input.format === "image" || input.format === "carousel") && media.length) {
        for (const m of media) {
          if (!mediaUrns[m.assetId]) {
            mediaUrns[m.assetId] = await uploadImage(token, author, m);
            state.mediaUrns = mediaUrns;
          }
        }
        if (media.length === 1) content = { media: { id: mediaUrns[media[0].assetId], ...(media[0].altText ? { altText: media[0].altText } : {}) } };
        else content = { multiImage: { images: media.map((m) => ({ id: mediaUrns[m.assetId], ...(m.altText ? { altText: m.altText } : {}) })) } };
      } else if ((input.format === "link" || input.format === "article") && input.linkUrl) {
        content = { article: { source: input.linkUrl, title: typeof input.platformOptions.linkTitle === "string" ? input.platformOptions.linkTitle : input.linkUrl } };
      } else if (input.format !== "text" && input.format !== "link" && input.format !== "article") {
        throw new SocialProviderError("linkedin", "media_required", `A LinkedIn ${input.format} post needs media`, { retryable: false });
      }

      const post: Record<string, unknown> = {
        author,
        commentary: linkedInCommentary(input.body, input.hashtags),
        visibility: input.platformOptions.visibility === "connections" && author.startsWith("urn:li:person:") ? "CONNECTIONS" : "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
        ...(content ? { content } : {}),
      };
      const res = await nonIdempotentCreate("linkedin", () => rest<unknown>("POST", "/posts", token, post));
      const urn = res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id");
      if (!urn) throw new SocialProviderError("linkedin", "missing_post_id", "LinkedIn accepted the post but returned no id", { retryable: false });
      state.postUrn = urn;
      return { outcome: "published", externalPostId: urn, externalPostUrl: `https://www.linkedin.com/feed/update/${urn}`, providerState: state };
    } catch (err) {
      if (err instanceof Error) attachProviderState(err, state);
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Insights
  // ---------------------------------------------------------------------------

  interface ShareStats {
    impressionCount?: number;
    uniqueImpressionsCount?: number;
    clickCount?: number;
    likeCount?: number;
    commentCount?: number;
    shareCount?: number;
    engagement?: number;
  }

  async function fetchAccountInsights(credential: SocialAccountCredential, range: { since: Date; until: Date }): Promise<AccountInsights | null> {
    if (credential.platform !== "linkedin" || credential.externalAccountId.startsWith("person:")) return null;
    const token = credential.bundle.accessToken;
    const orgUrn = enc(`urn:li:organization:${credential.externalAccountId}`);
    const { data } = await rest<{ elements?: { totalShareStatistics?: ShareStats }[] }>(
      "GET",
      `/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${orgUrn}&timeIntervals=(timeRange:(start:${range.since.getTime()},end:${range.until.getTime()}),timeGranularityType:DAY)`,
      token,
    );
    const sums: Record<string, number> = {};
    const engagementRates: number[] = [];
    for (const el of data?.elements ?? []) {
      const s = el.totalShareStatistics ?? {};
      for (const [k, v] of Object.entries(s)) {
        const n = numberOrUndefined(v);
        if (n === undefined) continue;
        if (k === "engagement") engagementRates.push(n);
        else sums[k] = (sums[k] ?? 0) + n;
      }
    }
    let followers: number | undefined;
    try {
      const sizes = await rest<{ firstDegreeSize?: number }>("GET", `/networkSizes/${orgUrn}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`, token);
      followers = numberOrUndefined(sizes.data?.firstDegreeSize);
    } catch (err) {
      if (!isSoftFailure(err)) throw err;
    }
    const interactions = ["likeCount", "commentCount", "shareCount", "clickCount"].filter((k) => sums[k] !== undefined);
    const extra: Record<string, number> = { ...sums };
    if (engagementRates.length) extra.engagementRate = engagementRates.reduce((a, b) => a + b, 0) / engagementRates.length;
    return {
      periodStart: range.since,
      periodEnd: range.until,
      followers,
      impressions: sums.impressionCount,
      reach: sums.uniqueImpressionsCount,
      websiteClicks: sums.clickCount,
      engagements: interactions.length ? interactions.reduce((a, k) => a + sums[k], 0) : undefined,
      extra,
    };
  }

  async function fetchPostInsights(credential: SocialAccountCredential, externalPostIds: string[]): Promise<PostInsights[]> {
    if (credential.platform !== "linkedin" || credential.externalAccountId.startsWith("person:") || !externalPostIds.length) return [];
    const token = credential.bundle.accessToken;
    const orgUrn = enc(`urn:li:organization:${credential.externalAccountId}`);
    const shares = externalPostIds.filter((id) => id.startsWith("urn:li:share:"));
    const ugcPosts = externalPostIds.filter((id) => id.startsWith("urn:li:ugcPost:"));
    let query = `/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${orgUrn}`;
    if (shares.length) query += `&shares=List(${shares.map(enc).join(",")})`;
    if (ugcPosts.length) query += `&ugcPosts=List(${ugcPosts.map(enc).join(",")})`;
    if (!shares.length && !ugcPosts.length) return [];
    const { data } = await rest<{ elements?: { share?: string; ugcPost?: string; totalShareStatistics?: ShareStats }[] }>("GET", query, token);
    const out: PostInsights[] = [];
    for (const el of data?.elements ?? []) {
      const id = el.share ?? el.ugcPost;
      if (!id) continue;
      const s = el.totalShareStatistics ?? {};
      const extra: Record<string, number> = {};
      for (const [k, v] of Object.entries(s)) {
        const n = numberOrUndefined(v);
        if (n !== undefined) extra[k] = n;
      }
      out.push({ externalPostId: id, impressions: numberOrUndefined(s.impressionCount), reach: numberOrUndefined(s.uniqueImpressionsCount), clicks: numberOrUndefined(s.clickCount), likes: numberOrUndefined(s.likeCount), comments: numberOrUndefined(s.commentCount), shares: numberOrUndefined(s.shareCount), extra });
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Engagement
  // ---------------------------------------------------------------------------

  async function fetchEngagement(credential: SocialAccountCredential, options: { since?: Date | null; externalPostIds?: string[] }): Promise<FetchedEngagementItem[]> {
    if (credential.platform !== "linkedin") throw new SocialProviderNotSupportedError(credential.platform, "engagement sync");
    const token = credential.bundle.accessToken;
    const author = linkedInAuthorUrn(credential.externalAccountId);
    const sinceMs = options.since?.getTime() ?? 0;
    const postIds = options.externalPostIds?.length ? options.externalPostIds : ((await rest<{ elements?: { id: string }[] }>("GET", `/posts?author=${enc(author)}&q=author&count=10`, token)).data?.elements ?? []).map((p) => p.id);
    const items: FetchedEngagementItem[] = [];
    for (const postUrn of postIds) {
      const { data } = await rest<{ elements?: { id?: string; $URN?: string; commentUrn?: string; actor?: string; message?: { text?: string }; created?: { time?: number }; parentComment?: string }[] }>("GET", `/socialActions/${enc(postUrn)}/comments`, token);
      for (const c of data?.elements ?? []) {
        if (c.actor === author) continue;
        const postedAt = new Date(c.created?.time ?? 0);
        if (sinceMs && postedAt.getTime() < sinceMs) continue;
        const externalId = c.$URN ?? c.commentUrn ?? c.id;
        if (!externalId) continue;
        items.push({ itemType: "comment", externalId, externalParentId: c.parentComment ?? null, externalPostId: postUrn, externalUrl: `https://www.linkedin.com/feed/update/${postUrn}`, authorExternalId: c.actor ?? null, authorName: null, authorHandle: null, text: c.message?.text ?? "", postedAt });
      }
    }
    return items;
  }

  async function replyToEngagement(credential: SocialAccountCredential, item: { itemType: string; externalId: string; externalPostId?: string | null }, message: string): Promise<{ externalReplyId: string }> {
    if (credential.platform !== "linkedin" || item.itemType !== "comment") throw new SocialProviderNotSupportedError(credential.platform, `replying to a ${item.itemType}`);
    if (!item.externalPostId) throw new SocialProviderError("linkedin", "missing_post", "The comment is not linked to a post", { retryable: false });
    const token = credential.bundle.accessToken;
    const actor = linkedInAuthorUrn(credential.externalAccountId);
    const res = await nonIdempotentCreate("linkedin", () =>
      rest<{ $URN?: string; id?: string; commentUrn?: string }>("POST", `/socialActions/${enc(item.externalPostId!)}/comments`, token, {
        actor,
        object: item.externalPostId,
        message: { text: message },
        ...(item.externalId.startsWith("urn:li:comment:") ? { parentComment: item.externalId } : {}),
      })
    );
    const id = res.headers.get("x-restli-id") ?? res.data?.$URN ?? res.data?.commentUrn ?? res.data?.id;
    if (!id) throw new SocialProviderError("linkedin", "missing_reply_id", "LinkedIn accepted the reply but returned no id", { retryable: false });
    return { externalReplyId: String(id) };
  }

  // ---------------------------------------------------------------------------
  // Ads
  // ---------------------------------------------------------------------------

  function minorFromAmount(value: unknown): number | null {
    const n = numberOrUndefined(value);
    return n === undefined ? null : Math.round(n * 100);
  }

  async function listAdCampaigns(credential: SocialAccountCredential, range: { since: Date; until: Date }): Promise<AdCampaignRecord[]> {
    if (credential.platform !== "linkedin_ads") throw new SocialProviderNotSupportedError(credential.platform, "ad campaigns");
    const token = credential.bundle.accessToken;
    const acct = credential.externalAccountId;
    const account = await rest<{ currency?: string }>("GET", `/adAccounts/${enc(acct)}`, token);
    const currency = account.data?.currency ?? "USD";
    const campaigns = await rest<{ elements?: { id: number | string; name: string; status: string; objectiveType?: string; dailyBudget?: { amount?: string; currencyCode?: string }; totalBudget?: { amount?: string } }[] }>("GET", `/adAccounts/${enc(acct)}/adCampaigns?q=search`, token);
    const analytics = await rest<{ elements?: { pivotValues?: string[]; impressions?: number; clicks?: number; costInLocalCurrency?: string; externalWebsiteConversions?: number }[] }>(
      "GET",
      `/adAnalytics?q=analytics&pivot=CAMPAIGN&timeGranularity=ALL&dateRange=(start:${ymd(range.since)},end:${ymd(range.until)})&accounts=List(${enc(`urn:li:sponsoredAccount:${acct}`)})&fields=impressions,clicks,costInLocalCurrency,externalWebsiteConversions,pivotValues`,
      token,
    );
    const byCampaign = new Map<string, NonNullable<typeof analytics.data.elements>[number]>();
    for (const el of analytics.data?.elements ?? []) {
      const urn = el.pivotValues?.[0];
      if (urn) byCampaign.set(urn.split(":").pop()!, el);
    }
    return (campaigns.data?.elements ?? []).map((c) => {
      const a = byCampaign.get(String(c.id));
      const cost = numberOrUndefined(a?.costInLocalCurrency);
      return {
        externalCampaignId: String(c.id),
        name: c.name,
        status: c.status,
        objective: c.objectiveType ?? null,
        currency: c.dailyBudget?.currencyCode ?? currency,
        dailyBudgetMinor: minorFromAmount(c.dailyBudget?.amount),
        lifetimeBudgetMinor: minorFromAmount(c.totalBudget?.amount),
        periodStart: range.since,
        periodEnd: range.until,
        spendMinor: cost === undefined ? null : Math.round(cost * 100),
        impressions: numberOrUndefined(a?.impressions) ?? null,
        clicks: numberOrUndefined(a?.clicks) ?? null,
        reach: null,
        conversions: numberOrUndefined(a?.externalWebsiteConversions) ?? null,
        metrics: {},
      };
    });
  }

  async function executeAdChange(credential: SocialAccountCredential, input: AdChangeExecutionInput): Promise<AdChangeExecutionResult> {
    if (credential.platform !== "linkedin_ads") throw new SocialProviderNotSupportedError(credential.platform, "ad changes");
    if (!(SOCIAL_AD_CHANGE_TYPES as readonly string[]).includes(input.changeType)) throw new SocialProviderNotSupportedError("linkedin_ads", input.changeType);
    const changeType = input.changeType as SocialAdChangeType;
    const token = credential.bundle.accessToken;
    const acct = enc(credential.externalAccountId);
    const partial = { "X-RestLi-Method": "PARTIAL_UPDATE" };
    switch (changeType) {
      case "pause_campaign":
      case "resume_campaign": {
        const p = socialAdChangePayloadSchemas[changeType].parse(input.payload);
        const status = changeType === "pause_campaign" ? "PAUSED" : "ACTIVE";
        await rest("POST", `/adAccounts/${acct}/adCampaigns/${enc(p.externalCampaignId)}`, token, { patch: { $set: { status } } }, partial);
        return { externalIds: { campaignId: p.externalCampaignId }, summary: `Set campaign ${p.externalCampaignId} to ${status}` };
      }
      case "update_budget": {
        const p = socialAdChangePayloadSchemas.update_budget.parse(input.payload);
        const set: Record<string, unknown> = {};
        if (p.dailyBudgetMinor !== undefined) set.dailyBudget = { amount: (p.dailyBudgetMinor / 100).toFixed(2), currencyCode: p.currency };
        if (p.lifetimeBudgetMinor !== undefined) set.totalBudget = { amount: (p.lifetimeBudgetMinor / 100).toFixed(2), currencyCode: p.currency };
        await rest("POST", `/adAccounts/${acct}/adCampaigns/${enc(p.externalCampaignId)}`, token, { patch: { $set: set } }, partial);
        return { externalIds: { campaignId: p.externalCampaignId }, summary: `Updated budget on campaign ${p.externalCampaignId}` };
      }
      default:
        throw new SocialProviderNotSupportedError("linkedin_ads", changeType);
    }
  }

  return {
    provider: "linkedin",
    platforms: ["linkedin", "linkedin_ads"],
    missingConfiguration() {
      const missing: string[] = [];
      if (!env.LINKEDIN_CLIENT_ID) missing.push("LINKEDIN_CLIENT_ID");
      if (!env.LINKEDIN_CLIENT_SECRET) missing.push("LINKEDIN_CLIENT_SECRET");
      return missing;
    },
    verify,
    discoverAssets,
    refresh,
    publish,
    fetchAccountInsights,
    fetchPostInsights,
    fetchEngagement,
    replyToEngagement,
    listAdCampaigns,
    executeAdChange,
  };
}

