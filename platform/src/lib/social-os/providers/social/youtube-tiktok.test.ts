import { describe, it, expect } from "vitest";
import { createYouTubeAdapter, buildYouTubeAuthorizationUrl, exchangeYouTubeCode, youtubeShortsMetadata, youtubeClient } from "./youtube";
import { createTikTokAdapter, buildTikTokAuthorizationUrl, exchangeTikTokCode, tiktokChunkPlan, tiktokScopes, TIKTOK_INBOX_PREFIX } from "./tiktok";
import { classifyProviderError, providerStateFromError, PUBLISH_OUTCOME_UNKNOWN, redactSecrets } from "./http";
import { resolveAdapterForPlatform, describeProviderAvailability } from "./registry";
import { buildProviderAuthorizationUrl, requestedScopes } from "../../oauth/providers";
import { SocialProviderError } from "../../errors";
import type { PublishInput, SocialAccountCredential } from "./types";

type Out = { status?: number; json?: unknown; headers?: Record<string, string> };
type Route = { match: (url: string, init?: RequestInit) => boolean; respond: (url: string, init?: RequestInit) => Out | Promise<Out> };

function fake(routes: Route[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const r = routes.find((x) => x.match(url, init));
    if (!r) return new Response(JSON.stringify({ message: `unexpected ${init?.method ?? "GET"} ${url}` }), { status: 599 });
    const out = await r.respond(url, init);
    const status = out.status ?? 200;
    return new Response(out.json === undefined || status === 204 ? null : JSON.stringify(out.json), { status, headers: { "content-type": "application/json", ...(out.headers ?? {}) } });
  };
  return { fetchImpl, calls };
}

const video = { assetId: "a1", bytes: new Uint8Array([1, 2, 3, 4, 5]), contentType: "video/mp4", role: "primary" as const, position: 0 };

function input(platform: "youtube" | "tiktok", overrides: Partial<PublishInput> = {}): PublishInput {
  return { platform, format: "short_video", body: "Pip builds a game in 60 seconds\n\nFull lesson on CodeIt.", hashtags: ["coding", "#kidscode"], linkUrl: null, media: [video], platformOptions: {}, idempotencyKey: "k", providerState: {}, scheduledFor: null, ...overrides };
}

const now = new Date("2026-10-30T12:00:00Z");

describe("YouTube", () => {
  const env = { YOUTUBE_CLIENT_ID: "ycid", YOUTUBE_CLIENT_SECRET: "ysecret" };
  const cred: SocialAccountCredential = { bundle: { accessToken: "ya29.TOKEN", refreshToken: "1//REFRESH", scopes: [] }, externalAccountId: "UC123", platform: "youtube" };

  it("asks for offline upload access and falls back to the Google Ads OAuth client", () => {
    const url = new URL(buildYouTubeAuthorizationUrl({ clientId: "ycid", redirectUri: "https://app/cb", state: "st" }));
    expect(url.searchParams.get("scope")).toContain("youtube.upload");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(youtubeClient({ GOOGLE_ADS_CLIENT_ID: "g", GOOGLE_ADS_CLIENT_SECRET: "gs" })).toEqual({ clientId: "g", clientSecret: "gs" });
    expect(youtubeClient({ ...env, GOOGLE_ADS_CLIENT_ID: "g" }).clientId).toBe("ycid");
    expect(createYouTubeAdapter({}).missingConfiguration()).toEqual(["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"]);
    expect(createYouTubeAdapter({ GOOGLE_ADS_CLIENT_ID: "g", GOOGLE_ADS_CLIENT_SECRET: "gs" }).missingConfiguration()).toEqual([]);
  });

  it("exchanges a code for a refreshable token", async () => {
    const { fetchImpl, calls } = fake([{ match: (u) => u.includes("oauth2.googleapis.com/token"), respond: () => ({ json: { access_token: "AT", expires_in: 3600, refresh_token: "RT", scope: "https://www.googleapis.com/auth/youtube.upload" } }) }]);
    const res = await exchangeYouTubeCode(fetchImpl, { clientId: "c", clientSecret: "s", redirectUri: "https://app/cb", code: "code", now });
    expect(res).toMatchObject({ accessToken: "AT", refreshToken: "RT", expiresAt: "2026-10-30T13:00:00.000Z" });
    expect(String(calls[0].init?.body)).toContain("grant_type=authorization_code");
  });

  it("builds Shorts metadata within YouTube's limits", () => {
    const m = youtubeShortsMetadata({ body: "Build <your> first game\nmore", hashtags: ["coding", "#Shorts", "pip"] });
    expect(m.title).toBe("Build your first game #Shorts");
    expect(m.description.endsWith("#Shorts #coding #pip")).toBe(true);
    expect(m.tags).toEqual(["coding", "Shorts", "pip"]);
    const long = youtubeShortsMetadata({ body: "x".repeat(300), hashtags: [] });
    expect(long.title.length).toBeLessThanOrEqual(100);
    expect(long.title.endsWith("... #Shorts")).toBe(true);
    expect(youtubeShortsMetadata({ body: "body", hashtags: [], title: "Custom #shorts title" }).title).toBe("Custom #shorts title");
  });

  it("discovers the signed-in channels", async () => {
    const { fetchImpl } = fake([{ match: (u) => u.includes("/youtube/v3/channels") && u.includes("mine=true"), respond: () => ({ json: { items: [{ id: "UC123", snippet: { title: "CodeIt Learn", customUrl: "@codeitlearn" }, statistics: { subscriberCount: "42", videoCount: "7" } }] } }) }]);
    const assets = await createYouTubeAdapter(env, { fetchImpl }).discoverAssets(cred.bundle);
    expect(assets).toEqual([expect.objectContaining({ platform: "youtube", externalAccountId: "UC123", displayName: "CodeIt Learn", handle: "@codeitlearn", externalUrl: "https://www.youtube.com/@codeitlearn", accountKind: "organic" })]);
  });

  it("uploads a Short with a resumable session", async () => {
    let resource: Record<string, Record<string, unknown>> = {};
    const { fetchImpl, calls } = fake([
      {
        match: (u, i) => u.startsWith("https://www.googleapis.com/upload/youtube/v3/videos") && i?.method === "POST",
        respond: (_u, i) => {
          resource = JSON.parse(String(i?.body));
          return { json: {}, headers: { location: "https://upload.example/session-1" } };
        },
      },
      { match: (u, i) => u === "https://upload.example/session-1" && i?.method === "PUT", respond: () => ({ json: { id: "vid9", status: { uploadStatus: "uploaded" } } }) },
    ]);
    const res = await createYouTubeAdapter(env, { fetchImpl }).publish!(cred, input("youtube", { platformOptions: { madeForKids: true, categoryId: "27" } }));
    expect(res).toEqual({ outcome: "published", externalPostId: "vid9", externalPostUrl: "https://www.youtube.com/shorts/vid9" });
    expect(resource.snippet.title).toBe("Pip builds a game in 60 seconds #Shorts");
    expect(resource.snippet.categoryId).toBe("27");
    expect(resource.status).toMatchObject({ privacyStatus: "public", selfDeclaredMadeForKids: true });
    const init = calls[0].init?.headers as Record<string, string>;
    expect(init["X-Upload-Content-Length"]).toBe("5");
    expect(calls[0].url).toContain("uploadType=resumable");
  });

  it("never blindly retries an upload whose outcome is unknown", async () => {
    const { fetchImpl } = fake([
      { match: (_u, i) => i?.method === "POST", respond: () => ({ json: {}, headers: { location: "https://upload.example/s" } }) },
      { match: (_u, i) => i?.method === "PUT", respond: () => ({ status: 503, json: { error: { code: 503, message: "backend", status: "UNAVAILABLE" } } }) },
    ]);
    const err = await createYouTubeAdapter(env, { fetchImpl }).publish!(cred, input("youtube")).catch((e) => e);
    expect(err).toBeInstanceOf(SocialProviderError);
    expect(err.code).toBe(PUBLISH_OUTCOME_UNKNOWN);
    expect(err.retryable).toBe(false);
  });

  it("reports a quota refusal at session start as permanent and a 401 as lost authorization", async () => {
    const quota = fake([{ match: () => true, respond: () => ({ status: 403, json: { error: { code: 403, message: "The request cannot be completed because you have exceeded your quota.", errors: [{ reason: "quotaExceeded" }] } } }) }]);
    const err = await createYouTubeAdapter(env, { fetchImpl: quota.fetchImpl }).publish!(cred, input("youtube")).catch((e) => e);
    expect(err).toMatchObject({ retryable: false, authorizationLost: false });
    const lost = fake([{ match: () => true, respond: () => ({ status: 401, json: { error: { code: 401, message: "Invalid Credentials", status: "UNAUTHENTICATED" } } }) }]);
    const v = await createYouTubeAdapter(env, { fetchImpl: lost.fetchImpl }).verify(cred);
    expect(v).toMatchObject({ ok: false, authorizationLost: true });
  });

  it("refreshes the access token and keeps the refresh token", async () => {
    const { fetchImpl, calls } = fake([{ match: (u) => u.includes("/token"), respond: () => ({ json: { access_token: "NEW", expires_in: 3600 } }) }]);
    const next = await createYouTubeAdapter(env, { fetchImpl, now: () => now }).refresh!(cred.bundle);
    expect(next).toMatchObject({ accessToken: "NEW", refreshToken: "1//REFRESH" });
    expect(String(calls[0].init?.body)).toContain("grant_type=refresh_token");
  });
});

describe("TikTok", () => {
  const env = { TIKTOK_CLIENT_KEY: "tkey", TIKTOK_CLIENT_SECRET: "tsecret" };
  const cred: SocialAccountCredential = { bundle: { accessToken: "act.TOKEN", refreshToken: "rft.REFRESH", scopes: [] }, externalAccountId: "open-1", platform: "tiktok" };
  const ok = { code: "ok", message: "", log_id: "L" };

  it("asks for inbox upload scopes by default and publish scope in direct mode", () => {
    expect(tiktokScopes({})).toEqual(["user.info.basic", "video.upload"]);
    expect(tiktokScopes({ TIKTOK_DIRECT_POST: "1" })).toContain("video.publish");
    const url = new URL(buildTikTokAuthorizationUrl({ clientKey: "tkey", redirectUri: "https://app/cb", state: "st", scopes: tiktokScopes({}) }));
    expect(url.origin + url.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(url.searchParams.get("client_key")).toBe("tkey");
    expect(url.searchParams.get("scope")).toBe("user.info.basic,video.upload");
    expect(createTikTokAdapter({}).missingConfiguration()).toEqual(["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"]);
  });

  it("exchanges a code, and turns the 200 error envelope into a refusal", async () => {
    const good = fake([{ match: (u) => u.endsWith("/v2/oauth/token/"), respond: () => ({ json: { access_token: "act.A", expires_in: 86400, open_id: "open-1", refresh_token: "rft.R", refresh_expires_in: 31536000, scope: "user.info.basic,video.upload" } }) }]);
    const res = await exchangeTikTokCode(good.fetchImpl, { clientKey: "k", clientSecret: "s", redirectUri: "https://app/cb", code: "c", now });
    expect(res).toMatchObject({ accessToken: "act.A", openId: "open-1", refreshToken: "rft.R", expiresAt: "2026-10-31T12:00:00.000Z", scopes: ["user.info.basic", "video.upload"] });
    expect(String(good.calls[0].init?.body)).toContain("client_key=k");
    const bad = fake([{ match: () => true, respond: () => ({ json: { error: "invalid_grant", error_description: "Authorization code is expired.", log_id: "L" } }) }]);
    const err = await exchangeTikTokCode(bad.fetchImpl, { clientKey: "k", clientSecret: "s", redirectUri: "https://app/cb", code: "c", now }).catch((e) => e);
    expect(err).toMatchObject({ code: "oauth_invalid_grant", authorizationLost: true });
  });

  it("classifies TikTok API errors", () => {
    expect(classifyProviderError(401, { error: { code: "access_token_invalid", message: "The access token is invalid", log_id: "L" } })).toMatchObject({ code: "tiktok_access_token_invalid", authorizationLost: true, retryable: false });
    expect(classifyProviderError(429, { error: { code: "rate_limit_exceeded", message: "slow down", log_id: "L" } })).toMatchObject({ retryable: true });
    expect(classifyProviderError(403, { error: { code: "unaudited_client_can_only_post_to_private_accounts", message: "x", log_id: "L" } })).toMatchObject({ retryable: false, authorizationLost: false });
    expect(redactSecrets("token act.abcdefghijklmnopqrstuvwxyz123 and 1//0abcdefghijklmnopqrstuvwxyz")).not.toMatch(/act\.abc|1\/\/0abc/);
  });

  it("plans chunks the way TikTok requires", () => {
    expect(tiktokChunkPlan(3_000_000)).toEqual({ chunkSize: 3_000_000, totalChunkCount: 1, ranges: [[0, 2_999_999]] });
    const MB = 1024 * 1024;
    const big = tiktokChunkPlan(95 * MB);
    expect(big.chunkSize).toBe(10 * MB);
    expect(big.totalChunkCount).toBe(9);
    expect(big.ranges.at(-1)).toEqual([80 * MB, 95 * MB - 1]);
  });

  it("discovers the account", async () => {
    const { fetchImpl } = fake([{ match: (u) => u.includes("/v2/user/info/"), respond: () => ({ json: { data: { user: { open_id: "open-1", display_name: "codeitlearn" } }, error: ok } }) }]);
    const assets = await createTikTokAdapter(env, { fetchImpl }).discoverAssets(cred.bundle);
    expect(assets).toEqual([expect.objectContaining({ platform: "tiktok", externalAccountId: "open-1", displayName: "codeitlearn", accountKind: "organic", metadata: { mode: "inbox" } })]);
  });

  it("uploads to the TikTok inbox and reports it as delivered", async () => {
    let initBody: Record<string, unknown> = {};
    const { fetchImpl, calls } = fake([
      { match: (u) => u.endsWith("/post/publish/inbox/video/init/"), respond: (_u, i) => ((initBody = JSON.parse(String(i?.body))), { json: { data: { publish_id: "pub-1", upload_url: "https://upload.tiktok.example/u1" }, error: ok } }) },
      { match: (u, i) => u === "https://upload.tiktok.example/u1" && i?.method === "PUT", respond: () => ({ status: 201, json: {} }) },
      { match: (u) => u.endsWith("/post/publish/status/fetch/"), respond: () => ({ json: { data: { status: "SEND_TO_USER_INBOX" }, error: ok } }) },
    ]);
    const res = await createTikTokAdapter(env, { fetchImpl }).publish!(cred, input("tiktok"));
    expect(res).toEqual({ outcome: "published", externalPostId: `${TIKTOK_INBOX_PREFIX}pub-1` });
    expect(initBody).toEqual({ source_info: { source: "FILE_UPLOAD", video_size: 5, chunk_size: 5, total_chunk_count: 1 } });
    const put = calls.find((c) => c.init?.method === "PUT")!;
    expect((put.init?.headers as Record<string, string>)["Content-Range"]).toBe("bytes 0-4/5");
  });

  it("waits while TikTok processes, then resumes from the publish id without uploading again", async () => {
    let status = "PROCESSING_UPLOAD";
    const { fetchImpl, calls } = fake([
      { match: (u) => u.endsWith("/inbox/video/init/"), respond: () => ({ json: { data: { publish_id: "pub-2", upload_url: "https://upload.tiktok.example/u2" }, error: ok } }) },
      { match: (_u, i) => i?.method === "PUT", respond: () => ({ status: 201, json: {} }) },
      { match: (u) => u.endsWith("/status/fetch/"), respond: () => ({ json: { data: { status }, error: ok } }) },
    ]);
    const adapter = createTikTokAdapter(env, { fetchImpl });
    const first = await adapter.publish!(cred, input("tiktok"));
    expect(first).toEqual({ outcome: "pending", externalPostId: "", providerState: { tiktokPublishId: "pub-2", tiktokMode: "inbox" } });
    status = "SEND_TO_USER_INBOX";
    const before = calls.length;
    const second = await adapter.publish!(cred, input("tiktok", { providerState: first.providerState }));
    expect(second.externalPostId).toBe(`${TIKTOK_INBOX_PREFIX}pub-2`);
    expect(calls.slice(before).map((c) => c.url.split("/v2")[1])).toEqual(["/post/publish/status/fetch/"]);
  });

  it("posts directly with the caption and an allowed privacy level when direct posting is on", async () => {
    let initBody: { post_info?: Record<string, unknown> } = {};
    const { fetchImpl } = fake([
      { match: (u) => u.endsWith("/creator_info/query/"), respond: () => ({ json: { data: { creator_username: "codeitlearn", privacy_level_options: ["FOLLOWER_OF_CREATOR", "SELF_ONLY"], comment_disabled: false }, error: ok } }) },
      { match: (u) => u.endsWith("/post/publish/video/init/"), respond: (_u, i) => ((initBody = JSON.parse(String(i?.body))), { json: { data: { publish_id: "pub-3", upload_url: "https://upload.tiktok.example/u3" }, error: ok } }) },
      { match: (_u, i) => i?.method === "PUT", respond: () => ({ status: 201, json: {} }) },
      { match: (u) => u.endsWith("/status/fetch/"), respond: () => ({ json: { data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [7311] }, error: ok } }) },
    ]);
    const res = await createTikTokAdapter({ ...env, TIKTOK_DIRECT_POST: "1" }, { fetchImpl }).publish!(cred, input("tiktok"));
    expect(res).toEqual({ outcome: "published", externalPostId: "7311" });
    expect(initBody.post_info).toMatchObject({ privacy_level: "FOLLOWER_OF_CREATOR", disable_comment: false });
    expect(String(initBody.post_info?.title)).toContain("#coding #kidscode");
  });

  it("fails permanently when TikTok rejects the video, keeping the publish id", async () => {
    const { fetchImpl } = fake([
      { match: (u) => u.endsWith("/inbox/video/init/"), respond: () => ({ json: { data: { publish_id: "pub-4", upload_url: "https://upload.tiktok.example/u4" }, error: ok } }) },
      { match: (_u, i) => i?.method === "PUT", respond: () => ({ status: 201, json: {} }) },
      { match: (u) => u.endsWith("/status/fetch/"), respond: () => ({ json: { data: { status: "FAILED", fail_reason: "duration_check_failed" }, error: ok } }) },
    ]);
    const err = await createTikTokAdapter(env, { fetchImpl }).publish!(cred, input("tiktok")).catch((e) => e);
    expect(err).toMatchObject({ code: "publish_failed_duration_check_failed", retryable: false });
    expect(providerStateFromError(err)).toEqual({ tiktokPublishId: "pub-4", tiktokMode: "inbox" });
  });

  it("starts over (no saved publish id) when the upload itself fails", async () => {
    const { fetchImpl } = fake([
      { match: (u) => u.endsWith("/inbox/video/init/"), respond: () => ({ json: { data: { publish_id: "pub-5", upload_url: "https://upload.tiktok.example/u5" }, error: ok } }) },
      { match: (_u, i) => i?.method === "PUT", respond: () => ({ status: 502, json: {} }) },
    ]);
    const err = await createTikTokAdapter(env, { fetchImpl }).publish!(cred, input("tiktok")).catch((e) => e);
    expect(err).toMatchObject({ code: "upload_failed", retryable: true });
    expect(providerStateFromError(err)).toBeUndefined();
  });

  it("verifies the token belongs to the connected account", async () => {
    const { fetchImpl } = fake([{ match: () => true, respond: () => ({ json: { data: { user: { open_id: "someone-else" } }, error: ok } }) }]);
    expect(await createTikTokAdapter(env, { fetchImpl }).verify(cred)).toMatchObject({ ok: false, authorizationLost: true });
  });
});

describe("registry and OAuth wiring", () => {
  const env = { YOUTUBE_CLIENT_ID: "y", YOUTUBE_CLIENT_SECRET: "ys", TIKTOK_CLIENT_KEY: "t", TIKTOK_CLIENT_SECRET: "ts" };
  it("resolves YouTube and TikTok publishing adapters", () => {
    expect(resolveAdapterForPlatform("youtube", env).provider).toBe("youtube");
    expect(resolveAdapterForPlatform("tiktok", env).provider).toBe("tiktok");
    const avail = describeProviderAvailability(env);
    expect(avail.find((p) => p.provider === "youtube")).toMatchObject({ configured: true });
    expect(avail.find((p) => p.provider === "tiktok")).toMatchObject({ configured: true });
  });
  it("builds consent URLs and scopes", () => {
    expect(buildProviderAuthorizationUrl("youtube", env, { redirectUri: "https://app/cb", state: "s".repeat(20) })).toContain("accounts.google.com");
    expect(buildProviderAuthorizationUrl("tiktok", env, { redirectUri: "https://app/cb", state: "s".repeat(20) })).toContain("tiktok.com/v2/auth/authorize");
    expect(requestedScopes("tiktok", env)).toEqual(["user.info.basic", "video.upload"]);
  });
});
