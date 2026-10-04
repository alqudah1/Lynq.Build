import { describe, it, expect } from "vitest";
import { createMetaAdapter, buildMetaAuthorizationUrl, exchangeMetaCode, exchangeMetaLongLivedToken, META_DEFAULT_SCOPES } from "./meta";
import { classifyProviderError, providerStateFromError, redactSecrets } from "./http";
import { SocialProviderError, SocialProviderNotSupportedError } from "../../errors";
import type { PublishInput, SocialAccountCredential } from "./types";

type Route = { match: (url: string, init?: RequestInit) => boolean; respond: (url: string, init?: RequestInit) => { status?: number; json?: unknown; headers?: Record<string, string> } };

function fake(routes: Route[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const r = routes.find((x) => x.match(url, init));
    if (!r) return new Response(JSON.stringify({ error: { message: `unexpected ${init?.method ?? "GET"} ${url}`, code: 1 } }), { status: 599 });
    const out = r.respond(url, init);
    return new Response(out.json === undefined ? "" : JSON.stringify(out.json), { status: out.status ?? 200, headers: { "content-type": "application/json", ...(out.headers ?? {}) } });
  };
  return { fetchImpl, calls };
}

const method = (m: string) => (_u: string, init?: RequestInit) => (init?.method ?? "GET") === m;
const env = { META_APP_ID: "app-id", META_APP_SECRET: "app-secret", META_GRAPH_API_VERSION: "v25.0" };
const noSleep = async () => undefined;

function baseInput(overrides: Partial<PublishInput> = {}): PublishInput {
  return { platform: "instagram", format: "image", body: "Hello", hashtags: ["lynq", "#web"], linkUrl: null, media: [{ assetId: "a1", url: "https://cdn.example.com/a.jpg", contentType: "image/jpeg", role: "primary", position: 0 }], platformOptions: {}, idempotencyKey: "k1", providerState: {}, scheduledFor: null, ...overrides };
}

describe("Meta OAuth helpers", () => {
  it("builds the dialog URL with the default scopes", () => {
    const biz = new URL(buildMetaAuthorizationUrl({ appId: "123", redirectUri: "https://app.test/cb", state: "s".repeat(20), configId: "999" }));
    expect(biz.searchParams.get("config_id")).toBe("999");
    expect(biz.searchParams.get("scope")).toBeNull();
    const url = new URL(buildMetaAuthorizationUrl({ appId: "123", redirectUri: "https://app.test/cb", state: "s".repeat(20) }));
    expect(url.origin + url.pathname).toBe("https://www.facebook.com/v25.0/dialog/oauth");
    expect(url.searchParams.get("scope")).toBe(META_DEFAULT_SCOPES.join(","));
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  it("exchanges a code then a long-lived token", async () => {
    const { fetchImpl, calls } = fake([
      { match: (u) => u.includes("fb_exchange_token="), respond: () => ({ json: { access_token: "LONG", expires_in: 5184000 } }) },
      { match: (u) => u.includes("/oauth/access_token") && u.includes("code="), respond: () => ({ json: { access_token: "SHORT" } }) },
    ]);
    const short = await exchangeMetaCode(fetchImpl, { appId: "a", appSecret: "b", redirectUri: "https://x/cb", code: "c" });
    const long = await exchangeMetaLongLivedToken(fetchImpl, { appId: "a", appSecret: "b", accessToken: short.accessToken });
    expect(long).toEqual({ accessToken: "LONG", expiresIn: 5184000 });
    expect(calls).toHaveLength(2);
  });
});

describe("Meta discovery", () => {
  it("returns pages (with page tokens), linked Instagram accounts and ad accounts", async () => {
    const { fetchImpl, calls } = fake([
      { match: (u) => u.includes("/me/accounts"), respond: () => ({ json: { data: [{ id: "111", name: "Lynq Page", access_token: "PAGE_TOKEN", category: "Agency", tasks: ["CREATE_CONTENT"] }] } }) },
      { match: (u) => u.includes("/111?") && u.includes("instagram_business_account"), respond: () => ({ json: { instagram_business_account: { id: "999", username: "lynq.build", followers_count: 42 } } }) },
      { match: (u) => u.includes("/me/adaccounts"), respond: () => ({ json: { data: [{ id: "act_555", account_id: "555", name: "Lynq Ads", currency: "CAD", account_status: 1 }] } }) },
    ]);
    const adapter = createMetaAdapter(env, { fetchImpl });
    const assets = await adapter.discoverAssets({ accessToken: "USER_TOKEN", scopes: [], expiresAt: "2030-01-01T00:00:00.000Z" });
    expect(assets.map((a) => [a.platform, a.externalAccountId])).toEqual([
      ["facebook", "111"],
      ["instagram", "999"],
      ["meta_ads", "555"],
    ]);
    expect(assets[0].accessToken).toBe("PAGE_TOKEN");
    expect(assets[1].handle).toBe("@lynq.build");
    expect(assets[2].metadata.currency).toBe("CAD");
    expect(assets[2].tokenExpiresAt).toBe("2030-01-01T00:00:00.000Z");
    // the IG lookup used the page token, sent as a header (never in the URL)
    const igCall = calls.find((c) => c.url.includes("instagram_business_account"))!;
    expect((igCall.init?.headers as Record<string, string>).Authorization).toBe("Bearer PAGE_TOKEN");
    expect(calls.every((c) => !c.url.includes("PAGE_TOKEN") && !c.url.includes("USER_TOKEN"))).toBe(true);
  });

  it("treats a missing ads permission as zero ad accounts", async () => {
    const { fetchImpl } = fake([
      { match: (u) => u.includes("/me/accounts"), respond: () => ({ json: { data: [] } }) },
      { match: (u) => u.includes("/me/adaccounts"), respond: () => ({ status: 403, json: { error: { message: "(#200) Missing permission", code: 200 } } }) },
    ]);
    const assets = await createMetaAdapter(env, { fetchImpl }).discoverAssets({ accessToken: "U", scopes: [] });
    expect(assets).toEqual([]);
  });
});

describe("Meta publishing", () => {
  const igCred: SocialAccountCredential = { bundle: { accessToken: "U", scopes: [], assets: { "999": { accessToken: "PAGE" } } }, externalAccountId: "999", platform: "instagram" };

  it("creates an Instagram container, polls until FINISHED, then publishes", async () => {
    let polls = 0;
    const { fetchImpl, calls } = fake([
      { match: (u, i) => u.endsWith("/999/media") && method("POST")(u, i), respond: () => ({ json: { id: "C1" } }) },
      { match: (u) => u.includes("/C1?fields=status_code"), respond: () => ({ json: { status_code: ++polls < 3 ? "IN_PROGRESS" : "FINISHED" } }) },
      { match: (u) => u.endsWith("/999/media_publish"), respond: () => ({ json: { id: "M1" } }) },
      { match: (u) => u.includes("/M1?fields=permalink"), respond: () => ({ json: { permalink: "https://www.instagram.com/p/abc/" } }) },
    ]);
    const res = await createMetaAdapter(env, { fetchImpl, sleep: noSleep }).publish!(igCred, baseInput());
    expect(res).toMatchObject({ outcome: "published", externalPostId: "M1", externalPostUrl: "https://www.instagram.com/p/abc/" });
    expect(res.providerState).toMatchObject({ containerId: "C1", mediaId: "M1" });
    const create = calls.find((c) => c.url.endsWith("/999/media"))!;
    expect(JSON.parse(String(create.init?.body))).toEqual({ image_url: "https://cdn.example.com/a.jpg", caption: "Hello\n\n#lynq #web" });
    expect(polls).toBe(3);
  });

  it("resumes an existing container instead of creating another", async () => {
    const { fetchImpl, calls } = fake([
      { match: (u) => u.includes("/C9?fields=status_code"), respond: () => ({ json: { status_code: "FINISHED" } }) },
      { match: (u) => u.endsWith("/999/media_publish"), respond: (_u, i) => ({ json: { id: JSON.parse(String(i?.body)).creation_id === "C9" ? "M9" : "WRONG" } }) },
      { match: (u) => u.includes("fields=permalink"), respond: () => ({ json: {} }) },
    ]);
    const res = await createMetaAdapter(env, { fetchImpl, sleep: noSleep }).publish!(igCred, baseInput({ providerState: { containerId: "C9" } }));
    expect(res.externalPostId).toBe("M9");
    expect(calls.some((c) => c.url.endsWith("/999/media"))).toBe(false);
  });

  it("returns the container id when the container is already PUBLISHED (idempotent resume)", async () => {
    const { fetchImpl, calls } = fake([{ match: (u) => u.includes("/C7?fields=status_code"), respond: () => ({ json: { status_code: "PUBLISHED" } }) }]);
    const res = await createMetaAdapter(env, { fetchImpl, sleep: noSleep }).publish!(igCred, baseInput({ providerState: { containerId: "C7" } }));
    expect(res).toMatchObject({ outcome: "published", externalPostId: "C7" });
    expect(calls).toHaveLength(1);
  });

  it("fails non-retryably on an ERROR container and carries the resumable state", async () => {
    const { fetchImpl } = fake([
      { match: (u, i) => u.endsWith("/999/media") && method("POST")(u, i), respond: () => ({ json: { id: "C2" } }) },
      { match: (u) => u.includes("/C2?fields=status_code"), respond: () => ({ json: { status_code: "ERROR" } }) },
    ]);
    const err = await createMetaAdapter(env, { fetchImpl, sleep: noSleep }).publish!(igCred, baseInput()).catch((e) => e);
    expect(err).toBeInstanceOf(SocialProviderError);
    expect(err.retryable).toBe(false);
    expect(err.code).toBe("ig_container_error");
    expect(providerStateFromError(err)).toMatchObject({ containerId: "C2" });
  });

  it("returns pending with the container id when processing outlasts the poll budget", async () => {
    const { fetchImpl } = fake([
      { match: (u, i) => u.endsWith("/999/media") && method("POST")(u, i), respond: () => ({ json: { id: "C3" } }) },
      { match: (u) => u.includes("/C3?fields=status_code"), respond: () => ({ json: { status_code: "IN_PROGRESS" } }) },
    ]);
    const res = await createMetaAdapter(env, { fetchImpl, sleep: noSleep, containerPollAttempts: 2 }).publish!(igCred, baseInput({ format: "reel", media: [{ assetId: "v", url: "https://cdn/v.mp4", contentType: "video/mp4", role: "primary", position: 0 }] }));
    expect(res).toMatchObject({ outcome: "pending", providerState: { containerId: "C3" } });
  });

  it("builds an Instagram carousel from child containers", async () => {
    let child = 0;
    const { fetchImpl, calls } = fake([
      { match: (u, i) => u.endsWith("/999/media") && method("POST")(u, i), respond: (_u, i) => ({ json: { id: JSON.parse(String(i?.body)).media_type === "CAROUSEL" ? "P1" : `K${++child}` } }) },
      { match: (u) => u.includes("fields=status_code"), respond: () => ({ json: { status_code: "FINISHED" } }) },
      { match: (u) => u.endsWith("/999/media_publish"), respond: () => ({ json: { id: "M2" } }) },
      { match: (u) => u.includes("fields=permalink"), respond: () => ({ json: {} }) },
    ]);
    const media = [0, 1].map((p) => ({ assetId: `a${p}`, url: `https://cdn/${p}.jpg`, contentType: "image/jpeg", role: "carousel_item" as const, position: p }));
    const res = await createMetaAdapter(env, { fetchImpl, sleep: noSleep }).publish!(igCred, baseInput({ format: "carousel", media }));
    expect(res.externalPostId).toBe("M2");
    const parent = calls.map((c) => (c.init?.body ? JSON.parse(String(c.init.body)) : null)).find((b) => b?.media_type === "CAROUSEL");
    expect(parent).toMatchObject({ children: "K1,K2" });
  });

  it("schedules a Facebook link post natively", async () => {
    const now = new Date("2026-10-01T12:00:00Z");
    const { fetchImpl, calls } = fake([{ match: (u) => u.endsWith("/111/feed"), respond: () => ({ json: { id: "111_222" } }) }]);
    const cred: SocialAccountCredential = { bundle: { accessToken: "U", scopes: [], assets: { "111": { accessToken: "PAGE" } } }, externalAccountId: "111", platform: "facebook" };
    const res = await createMetaAdapter(env, { fetchImpl, now: () => now }).publish!(cred, baseInput({ platform: "facebook", format: "link", media: [], linkUrl: "https://lynq.build", scheduledFor: new Date("2026-10-02T12:00:00Z") }));
    expect(res).toEqual({ outcome: "scheduled_natively", externalPostId: "111_222", externalPostUrl: "https://www.facebook.com/111_222" });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ message: "Hello\n\n#lynq #web", link: "https://lynq.build", published: false, scheduled_publish_time: 1790942400 });
  });
});

describe("Meta error mapping", () => {
  it("maps code 190 to authorizationLost (non-retryable)", async () => {
    const { fetchImpl } = fake([{ match: () => true, respond: () => ({ status: 400, json: { error: { message: "Error validating access token: Session has expired", type: "OAuthException", code: 190, error_subcode: 463 } } }) }]);
    const result = await createMetaAdapter(env, { fetchImpl }).verify({ bundle: { accessToken: "U", scopes: [] }, externalAccountId: "111", platform: "facebook" });
    expect(result).toMatchObject({ ok: false, authorizationLost: true });
    const c = classifyProviderError(400, { error: { code: 190, error_subcode: 463, message: "expired" } });
    expect(c).toMatchObject({ authorizationLost: true, retryable: false, code: "meta_190_463" });
  });

  it("maps throttling codes and HTTP 429 to retryable", () => {
    expect(classifyProviderError(400, { error: { code: 17, message: "User request limit reached" } }).retryable).toBe(true);
    expect(classifyProviderError(400, { error: { code: 80004, message: "too many calls" } }).retryable).toBe(true);
    expect(classifyProviderError(429, null).retryable).toBe(true);
    expect(classifyProviderError(503, null).retryable).toBe(true);
    expect(classifyProviderError(400, { error: { code: 100, message: "Invalid parameter" } })).toMatchObject({ retryable: false, authorizationLost: false });
  });

  it("never puts tokens in error messages", async () => {
    const { fetchImpl } = fake([{ match: () => true, respond: () => ({ status: 400, json: { error: { message: "bad request access_token=EAAsecretsecretsecretsecretsecret&x=1", code: 100 } } }) }]);
    const err = await createMetaAdapter(env, { fetchImpl }).fetchAccountInsights!({ bundle: { accessToken: "U", scopes: [] }, externalAccountId: "111", platform: "facebook" }, { since: new Date(0), until: new Date(1000) }).catch((e) => e);
    expect(err).toBeInstanceOf(SocialProviderError);
    expect(err.message).not.toContain("EAAsecret");
    expect(redactSecrets("x?access_token=abc&y=1")).toBe("x?access_token=[redacted]&y=1");
  });

  it("network failures are retryable", async () => {
    const fetchImpl = async () => {
      throw new Error("ECONNRESET");
    };
    const err = await createMetaAdapter(env, { fetchImpl }).discoverAssets({ accessToken: "U", scopes: [] }).catch((e) => e);
    expect(err).toMatchObject({ code: "network_error", retryable: true });
  });
});

describe("Meta insights, engagement and ads", () => {
  const fb: SocialAccountCredential = { bundle: { accessToken: "U", scopes: [], assets: { "111": { accessToken: "PAGE" } } }, externalAccountId: "111", platform: "facebook" };

  it("sums daily page insights and leaves missing metrics undefined", async () => {
    const { fetchImpl } = fake([
      { match: (u) => u.includes("/111/insights"), respond: () => ({ json: { data: [{ name: "page_media_view", values: [{ value: 10 }, { value: 5 }] }, { name: "page_post_engagements", values: [{ value: 3 }] }] } }) },
      { match: (u) => u.includes("/111?fields=followers_count"), respond: () => ({ json: { followers_count: 200 } }) },
    ]);
    const res = await createMetaAdapter(env, { fetchImpl }).fetchAccountInsights!(fb, { since: new Date("2026-09-01"), until: new Date("2026-09-08") });
    expect(res).toMatchObject({ followers: 200, views: 15, engagements: 3 });
    expect(res!.reach).toBeUndefined();
    expect(res!.extra).toEqual({ page_media_view: 15, page_post_engagements: 3 });
  });

  it("fetches Facebook comments skipping the page's own replies", async () => {
    const { fetchImpl } = fake([
      { match: (u) => u.includes("/111/feed"), respond: () => ({ json: { data: [{ id: "111_1" }] } }) },
      {
        match: (u) => u.includes("/111_1/comments"),
        respond: () => ({ json: { data: [{ id: "c1", message: "How much?", from: { id: "u1", name: "Sam" }, created_time: "2026-09-30T10:00:00+0000" }, { id: "c2", message: "Thanks!", from: { id: "111", name: "Lynq" }, created_time: "2026-09-30T11:00:00+0000" }] } }),
      },
    ]);
    const items = await createMetaAdapter(env, { fetchImpl }).fetchEngagement!(fb, {});
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ itemType: "comment", externalId: "c1", externalPostId: "111_1", authorName: "Sam", text: "How much?" });
  });

  it("merges campaigns with insights into minor units", async () => {
    const ads: SocialAccountCredential = { bundle: { accessToken: "U", scopes: [] }, externalAccountId: "555", platform: "meta_ads" };
    const { fetchImpl } = fake([
      { match: (u) => u.includes("/act_555?fields=currency"), respond: () => ({ json: { currency: "CAD" } }) },
      { match: (u) => u.includes("/act_555/campaigns"), respond: () => ({ json: { data: [{ id: "c1", name: "Fall", status: "ACTIVE", objective: "OUTCOME_LEADS", daily_budget: "2500" }] } }) },
      { match: (u) => u.includes("/act_555/insights"), respond: () => ({ json: { data: [{ campaign_id: "c1", spend: "12.345", impressions: "1000", clicks: "20", ctr: "2.0" }] } }) },
    ]);
    const [c] = await createMetaAdapter(env, { fetchImpl }).listAdCampaigns!(ads, { since: new Date("2026-09-01"), until: new Date("2026-09-30") });
    expect(c).toMatchObject({ externalCampaignId: "c1", currency: "CAD", dailyBudgetMinor: 2500, spendMinor: 1235, impressions: 1000, clicks: 20, reach: null });
  });

  it("creates campaigns paused and refuses unsupported change types", async () => {
    const ads: SocialAccountCredential = { bundle: { accessToken: "U", scopes: [] }, externalAccountId: "555", platform: "meta_ads" };
    const { fetchImpl, calls } = fake([{ match: (u) => u.endsWith("/act_555/campaigns"), respond: () => ({ json: { id: "new1" } }) }]);
    const adapter = createMetaAdapter(env, { fetchImpl });
    const res = await adapter.executeAdChange!(ads, { changeType: "create_campaign", payload: { name: "Test", objective: "OUTCOME_TRAFFIC", dailyBudgetMinor: 1000, currency: "CAD" }, idempotencyKey: "k" });
    expect(res.externalIds.campaignId).toBe("new1");
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ status: "PAUSED", daily_budget: 1000, special_ad_categories: [] });
    await expect(adapter.executeAdChange!(ads, { changeType: "create_ad", payload: {}, idempotencyKey: "k" })).rejects.toBeInstanceOf(SocialProviderNotSupportedError);
  });

  it("reports missing configuration", () => {
    expect(createMetaAdapter({}).missingConfiguration()).toEqual(["META_APP_ID", "META_APP_SECRET"]);
    expect(createMetaAdapter(env).missingConfiguration()).toEqual([]);
  });
});
