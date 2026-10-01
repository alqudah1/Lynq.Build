import { describe, it, expect } from "vitest";
import { createLinkedInAdapter, buildLinkedInAuthorizationUrl, exchangeLinkedInCode, linkedInCommentary, LINKEDIN_DEFAULT_SCOPES } from "./linkedin";
import { providerStateFromError } from "./http";
import { SocialProviderError, SocialProviderNotSupportedError } from "../../errors";
import type { PublishInput, SocialAccountCredential } from "./types";

type Out = { status?: number; json?: unknown; headers?: Record<string, string> };
type Route = { match: (url: string, init?: RequestInit) => boolean; respond: (url: string, init?: RequestInit) => Out };

function fake(routes: Route[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const r = routes.find((x) => x.match(url, init));
    if (!r) return new Response(JSON.stringify({ message: `unexpected ${init?.method ?? "GET"} ${url}` }), { status: 599 });
    const out = r.respond(url, init);
    const status = out.status ?? 200;
    return new Response(out.json === undefined || status === 204 ? null : JSON.stringify(out.json), { status, headers: { "content-type": "application/json", ...(out.headers ?? {}) } });
  };
  return { fetchImpl, calls };
}

const env = { LINKEDIN_CLIENT_ID: "cid", LINKEDIN_CLIENT_SECRET: "secret", LINKEDIN_API_VERSION: "202509" };
const org: SocialAccountCredential = { bundle: { accessToken: "LI_TOKEN", scopes: [] }, externalAccountId: "12345", platform: "linkedin" };
const noSleep = async () => undefined;

function input(overrides: Partial<PublishInput> = {}): PublishInput {
  return { platform: "linkedin", format: "text", body: "Websites (that work) for #local businesses", hashtags: ["lynq"], linkUrl: null, media: [], platformOptions: {}, idempotencyKey: "k", providerState: {}, scheduledFor: null, ...overrides };
}

describe("LinkedIn OAuth", () => {
  it("builds the authorization URL and exchanges a code (form-encoded)", async () => {
    const url = new URL(buildLinkedInAuthorizationUrl({ clientId: "cid", redirectUri: "https://app/cb", state: "st" }));
    expect(url.searchParams.get("scope")).toBe(LINKEDIN_DEFAULT_SCOPES.join(" "));
    const { fetchImpl, calls } = fake([{ match: (u) => u.includes("/oauth/v2/accessToken"), respond: () => ({ json: { access_token: "AT", expires_in: 5184000, refresh_token: "RT", refresh_token_expires_in: 31536000, scope: "openid,profile" } }) }]);
    const now = new Date("2026-10-01T00:00:00Z");
    const res = await exchangeLinkedInCode(fetchImpl, { clientId: "cid", clientSecret: "s", redirectUri: "https://app/cb", code: "c", now });
    expect(res).toMatchObject({ accessToken: "AT", refreshToken: "RT", expiresAt: "2026-11-30T00:00:00.000Z", scopes: ["openid", "profile"] });
    expect(String(calls[0].init?.body)).toContain("grant_type=authorization_code");
  });
});

describe("LinkedIn discovery", () => {
  it("finds administered organizations, the member profile and ad accounts", async () => {
    const { fetchImpl, calls } = fake([
      { match: (u) => u.includes("/rest/organizationAcls"), respond: () => ({ json: { elements: [{ organization: "urn:li:organization:12345", role: "ADMINISTRATOR", state: "APPROVED" }] } }) },
      { match: (u) => u.endsWith("/rest/organizations/12345"), respond: () => ({ json: { localizedName: "LYNQ", vanityName: "lynq-build" } }) },
      { match: (u) => u.endsWith("/v2/userinfo"), respond: () => ({ json: { sub: "abcDEF", name: "Mustafa Q" } }) },
      { match: (u) => u.includes("/rest/adAccounts?q=search"), respond: () => ({ json: { elements: [{ id: 5001, name: "LYNQ Ads", currency: "CAD", status: "ACTIVE" }] } }) },
    ]);
    const assets = await createLinkedInAdapter(env, { fetchImpl }).discoverAssets({ accessToken: "LI_TOKEN", scopes: [] });
    expect(assets.map((a) => [a.platform, a.externalAccountId, a.displayName])).toEqual([
      ["linkedin", "12345", "LYNQ"],
      ["linkedin", "person:abcDEF", "Mustafa Q"],
      ["linkedin_ads", "5001", "LYNQ Ads"],
    ]);
    const restCall = calls.find((c) => c.url.includes("/rest/organizationAcls"))!;
    expect(restCall.init?.headers).toMatchObject({ "LinkedIn-Version": "202509", "X-Restli-Protocol-Version": "2.0.0", Authorization: "Bearer LI_TOKEN" });
  });

  it("skips products the app was not granted (403) instead of failing", async () => {
    const { fetchImpl } = fake([
      { match: (u) => u.includes("/rest/organizationAcls"), respond: () => ({ status: 403, json: { status: 403, code: "ACCESS_DENIED", message: "Not enough permissions" } }) },
      { match: (u) => u.endsWith("/v2/userinfo"), respond: () => ({ json: { sub: "x1", name: "M" } }) },
      { match: (u) => u.includes("/rest/adAccounts"), respond: () => ({ status: 403, json: { status: 403, code: "ACCESS_DENIED", message: "no ads" } }) },
    ]);
    const assets = await createLinkedInAdapter(env, { fetchImpl }).discoverAssets({ accessToken: "T", scopes: [] });
    expect(assets.map((a) => a.externalAccountId)).toEqual(["person:x1"]);
  });
});

describe("LinkedIn publishing", () => {
  it("escapes little-text commentary and renders hashtags", () => {
    expect(linkedInCommentary("Hi (all) #x", ["lynq"])).toBe("Hi \\(all\\) \\#x\n\n{hashtag|\\#|lynq}");
  });

  it("posts a text update and reads the post urn from x-restli-id", async () => {
    const { fetchImpl, calls } = fake([{ match: (u) => u.endsWith("/rest/posts"), respond: () => ({ status: 201, headers: { "x-restli-id": "urn:li:share:777" } }) }]);
    const res = await createLinkedInAdapter(env, { fetchImpl }).publish!(org, input());
    expect(res).toMatchObject({ outcome: "published", externalPostId: "urn:li:share:777", externalPostUrl: "https://www.linkedin.com/feed/update/urn:li:share:777" });
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).toMatchObject({ author: "urn:li:organization:12345", visibility: "PUBLIC", lifecycleState: "PUBLISHED", distribution: { feedDistribution: "MAIN_FEED" } });
  });

  it("uploads an image (fetching bytes from the URL) before posting, and resumes uploaded media", async () => {
    let posts = 0;
    const { fetchImpl, calls } = fake([
      { match: (u) => u.includes("/rest/images?action=initializeUpload"), respond: () => ({ json: { value: { uploadUrl: "https://upload.linkedin.test/img1", image: "urn:li:image:I1" } } }) },
      { match: (u) => u === "https://cdn.example.com/a.jpg", respond: () => ({ json: "bytes" }) },
      { match: (u, i) => u.startsWith("https://upload.linkedin.test") && i?.method === "PUT", respond: () => ({ status: 201 }) },
      { match: (u) => u.endsWith("/rest/posts"), respond: () => (++posts === 1 ? { status: 429, json: { message: "throttled" } } : { status: 201, headers: { "x-restli-id": "urn:li:share:9" } }) },
    ]);
    const adapter = createLinkedInAdapter(env, { fetchImpl });
    const media = [{ assetId: "a1", url: "https://cdn.example.com/a.jpg", contentType: "image/jpeg", role: "primary" as const, position: 0, altText: "logo" }];
    const err = await adapter.publish!(org, input({ format: "image", media })).catch((e) => e);
    expect(err).toBeInstanceOf(SocialProviderError);
    expect(err.retryable).toBe(true);
    const state = providerStateFromError(err)!;
    expect(state).toEqual({ mediaUrns: { a1: "urn:li:image:I1" } });
    const before = calls.length;
    const res = await adapter.publish!(org, input({ format: "image", media, providerState: state }));
    expect(res.externalPostId).toBe("urn:li:share:9");
    const retryCalls = calls.slice(before);
    expect(retryCalls.some((c) => c.url.includes("initializeUpload"))).toBe(false);
    expect(JSON.parse(String(retryCalls[0].init?.body)).content).toEqual({ media: { id: "urn:li:image:I1", altText: "logo" } });
  });

  it("an ambiguous failure (HTTP 5xx) of the post-creating call is final: outcome unknown, never retried", async () => {
    const { fetchImpl } = fake([{ match: (u) => u.endsWith("/rest/posts"), respond: () => ({ status: 500, json: { message: "boom" } }) }]);
    const err = await createLinkedInAdapter(env, { fetchImpl }).publish!(org, input({ format: "text" })).catch((e) => e);
    expect(err).toBeInstanceOf(SocialProviderError);
    expect(err.code).toBe("publish_outcome_unknown");
    expect(err.retryable).toBe(false);
  });

  it("uploads a video in parts, finalizes with ETags and waits for AVAILABLE", async () => {
    let polls = 0;
    const { fetchImpl, calls } = fake([
      { match: (u) => u.includes("/rest/videos?action=initializeUpload"), respond: () => ({ json: { value: { video: "urn:li:video:V1", uploadToken: "", uploadInstructions: [{ uploadUrl: "https://up/1", firstByte: 0, lastByte: 1 }, { uploadUrl: "https://up/2", firstByte: 2, lastByte: 3 }] } } }) },
      { match: (u, i) => u.startsWith("https://up/") && i?.method === "PUT", respond: (u) => ({ status: 200, headers: { etag: `etag-${u.slice(-1)}` } }) },
      { match: (u) => u.includes("finalizeUpload"), respond: () => ({ status: 200 }) },
      { match: (u) => u.includes("/rest/videos/urn%3Ali%3Avideo%3AV1"), respond: () => ({ json: { status: ++polls < 2 ? "PROCESSING" : "AVAILABLE" } }) },
      { match: (u) => u.endsWith("/rest/posts"), respond: () => ({ status: 201, headers: { "x-restli-id": "urn:li:ugcPost:55" } }) },
    ]);
    const res = await createLinkedInAdapter(env, { fetchImpl, sleep: noSleep }).publish!(org, input({ format: "video", media: [{ assetId: "v", bytes: new Uint8Array([1, 2, 3, 4]), contentType: "video/mp4", role: "primary", position: 0 }] }));
    expect(res.externalPostId).toBe("urn:li:ugcPost:55");
    const fin = calls.find((c) => c.url.includes("finalizeUpload"))!;
    expect(JSON.parse(String(fin.init?.body)).finalizeUploadRequest.uploadedPartIds).toEqual(["etag-1", "etag-2"]);
  });
});

describe("LinkedIn errors, insights and ads", () => {
  it("maps 401 EXPIRED_ACCESS_TOKEN to authorizationLost and 429 to retryable", async () => {
    const expired = fake([{ match: () => true, respond: () => ({ status: 401, json: { status: 401, serviceErrorCode: 65601, code: "EXPIRED_ACCESS_TOKEN", message: "The token used in the request has expired" } }) }]);
    const v = await createLinkedInAdapter(env, { fetchImpl: expired.fetchImpl }).verify(org);
    expect(v).toMatchObject({ ok: false, authorizationLost: true });
    const limited = fake([{ match: () => true, respond: () => ({ status: 429, json: { status: 429, message: "Too many requests" } }) }]);
    const err = await createLinkedInAdapter(env, { fetchImpl: limited.fetchImpl }).publish!(org, input()).catch((e) => e);
    expect(err).toMatchObject({ retryable: true, authorizationLost: false });
  });

  it("sums organization share statistics and reads followers", async () => {
    const { fetchImpl, calls } = fake([
      { match: (u) => u.includes("organizationalEntityShareStatistics"), respond: () => ({ json: { elements: [{ totalShareStatistics: { impressionCount: 100, uniqueImpressionsCount: 80, clickCount: 5, likeCount: 3, commentCount: 1, shareCount: 1, engagement: 0.1 } }, { totalShareStatistics: { impressionCount: 50, clickCount: 2 } }] } }) },
      { match: (u) => u.includes("/rest/networkSizes/"), respond: () => ({ json: { firstDegreeSize: 321 } }) },
    ]);
    const res = await createLinkedInAdapter(env, { fetchImpl }).fetchAccountInsights!(org, { since: new Date(1000), until: new Date(2000) });
    expect(res).toMatchObject({ impressions: 150, reach: 80, websiteClicks: 7, followers: 321, engagements: 12 });
    expect(calls[0].url).toContain("timeIntervals=(timeRange:(start:1000,end:2000),timeGranularityType:DAY)");
    expect(calls[0].url).toContain("organizationalEntity=urn%3Ali%3Aorganization%3A12345");
  });

  it("returns null insights for a member profile", async () => {
    const res = await createLinkedInAdapter(env, { fetchImpl: fake([]).fetchImpl }).fetchAccountInsights!({ ...org, externalAccountId: "person:x" }, { since: new Date(), until: new Date() });
    expect(res).toBeNull();
  });

  it("lists ad campaigns with analytics and pauses via PARTIAL_UPDATE", async () => {
    const ads: SocialAccountCredential = { bundle: { accessToken: "T", scopes: [] }, externalAccountId: "5001", platform: "linkedin_ads" };
    const { fetchImpl, calls } = fake([
      { match: (u) => u.endsWith("/rest/adAccounts/5001"), respond: () => ({ json: { currency: "CAD" } }) },
      { match: (u) => u.includes("/adCampaigns?q=search"), respond: () => ({ json: { elements: [{ id: 77, name: "Leads", status: "ACTIVE", objectiveType: "LEAD_GENERATION", dailyBudget: { amount: "25.00", currencyCode: "CAD" } }] } }) },
      { match: (u) => u.includes("/rest/adAnalytics"), respond: () => ({ json: { elements: [{ pivotValues: ["urn:li:sponsoredCampaign:77"], impressions: 900, clicks: 12, costInLocalCurrency: "18.5", externalWebsiteConversions: 2 }] } }) },
      { match: (u, i) => u.includes("/adCampaigns/77") && i?.method === "POST", respond: () => ({ status: 204 }) },
    ]);
    const adapter = createLinkedInAdapter(env, { fetchImpl });
    const [c] = await adapter.listAdCampaigns!(ads, { since: new Date("2026-09-01T00:00:00Z"), until: new Date("2026-09-30T00:00:00Z") });
    expect(c).toMatchObject({ externalCampaignId: "77", dailyBudgetMinor: 2500, spendMinor: 1850, impressions: 900, conversions: 2, currency: "CAD" });
    expect(calls.find((x) => x.url.includes("adAnalytics"))!.url).toContain("dateRange=(start:(year:2026,month:9,day:1),end:(year:2026,month:9,day:30))");
    await adapter.executeAdChange!(ads, { changeType: "pause_campaign", payload: { externalCampaignId: "77" }, idempotencyKey: "k" });
    const patch = calls.at(-1)!;
    expect(patch.init?.headers).toMatchObject({ "X-RestLi-Method": "PARTIAL_UPDATE" });
    expect(JSON.parse(String(patch.init?.body))).toEqual({ patch: { $set: { status: "PAUSED" } } });
    await expect(adapter.executeAdChange!(ads, { changeType: "create_campaign", payload: {}, idempotencyKey: "k" })).rejects.toBeInstanceOf(SocialProviderNotSupportedError);
  });

  it("refresh is refused without a refresh token", async () => {
    await expect(createLinkedInAdapter(env).refresh!({ accessToken: "x", scopes: [] })).rejects.toBeInstanceOf(SocialProviderNotSupportedError);
  });
});
