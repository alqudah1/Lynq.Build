import { describe, it, expect } from "vitest";
import { createGoogleAdsAdapter, buildGoogleAdsAuthorizationUrl, refreshGoogleAdsToken } from "./google-ads";
import { classifyProviderError } from "./http";
import { SocialProviderError, SocialProviderNotSupportedError } from "../../errors";
import type { SocialAccountCredential } from "./types";

type Out = { status?: number; json?: unknown };
type Route = { match: (url: string, init?: RequestInit) => boolean; respond: (url: string, init?: RequestInit) => Out };

function fake(routes: Route[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const r = routes.find((x) => x.match(url, init));
    if (!r) return new Response(JSON.stringify({ error: { code: 404, status: "NOT_FOUND", message: `unexpected ${url}` } }), { status: 599 });
    const out = r.respond(url, init);
    return new Response(out.json === undefined ? "" : JSON.stringify(out.json), { status: out.status ?? 200, headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, calls };
}

const env = { GOOGLE_ADS_CLIENT_ID: "cid", GOOGLE_ADS_CLIENT_SECRET: "sec", GOOGLE_ADS_DEVELOPER_TOKEN: "dev", GOOGLE_ADS_LOGIN_CUSTOMER_ID: "1112223333", GOOGLE_ADS_API_VERSION: "v22" };
const cred: SocialAccountCredential = { bundle: { accessToken: "GA", refreshToken: "RT", scopes: [] }, externalAccountId: "1234567890", platform: "google_ads" };
const query = (init?: RequestInit) => String(JSON.parse(String(init?.body ?? "{}")).query ?? "");

describe("Google Ads OAuth", () => {
  it("requests offline access with forced consent", () => {
    const url = new URL(buildGoogleAdsAuthorizationUrl({ clientId: "cid", redirectUri: "https://app/cb", state: "s" }));
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/adwords");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
  });

  it("maps invalid_grant on refresh to authorizationLost", async () => {
    const { fetchImpl } = fake([{ match: () => true, respond: () => ({ status: 400, json: { error: "invalid_grant", error_description: "Token has been expired or revoked." } }) }]);
    const err = await refreshGoogleAdsToken(fetchImpl, { clientId: "c", clientSecret: "s", refreshToken: "r" }).catch((e) => e);
    expect(err).toBeInstanceOf(SocialProviderError);
    expect(err).toMatchObject({ authorizationLost: true, retryable: false, code: "oauth_invalid_grant" });
  });

  it("refreshes through the adapter, keeping the refresh token", async () => {
    const { fetchImpl } = fake([{ match: (u) => u === "https://oauth2.googleapis.com/token", respond: () => ({ json: { access_token: "NEW", expires_in: 3600 } }) }]);
    const next = await createGoogleAdsAdapter(env, { fetchImpl, now: () => new Date("2026-10-01T00:00:00Z") }).refresh!(cred.bundle);
    expect(next).toMatchObject({ accessToken: "NEW", refreshToken: "RT", expiresAt: "2026-10-01T01:00:00.000Z" });
  });
});

describe("Google Ads discovery", () => {
  it("lists accessible customers, skipping managers when clients exist, with required headers", async () => {
    const { fetchImpl, calls } = fake([
      { match: (u) => u.endsWith("/v22/customers:listAccessibleCustomers"), respond: () => ({ json: { resourceNames: ["customers/1234567890", "customers/1112223333"] } }) },
      { match: (u) => u.includes("/customers/1234567890/googleAds:searchStream"), respond: () => ({ json: [{ results: [{ customer: { id: "1234567890", descriptiveName: "LYNQ", currencyCode: "CAD", manager: false, status: "ENABLED" } }] }] }) },
      { match: (u) => u.includes("/customers/1112223333/googleAds:searchStream"), respond: () => ({ json: [{ results: [{ customer: { id: "1112223333", descriptiveName: "MCC", currencyCode: "CAD", manager: true, status: "ENABLED" } }] }] }) },
    ]);
    const assets = await createGoogleAdsAdapter(env, { fetchImpl }).discoverAssets({ accessToken: "GA", scopes: [] });
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({ platform: "google_ads", externalAccountId: "1234567890", displayName: "LYNQ", accountKind: "paid", metadata: { currency: "CAD", manager: false } });
    expect(calls[1].init?.headers).toMatchObject({ Authorization: "Bearer GA", "developer-token": "dev", "login-customer-id": "1112223333" });
  });

  it("omits optional headers when not configured", async () => {
    const { fetchImpl, calls } = fake([{ match: () => true, respond: () => ({ json: { resourceNames: [] } }) }]);
    await createGoogleAdsAdapter({ GOOGLE_ADS_CLIENT_ID: "c" }, { fetchImpl }).discoverAssets({ accessToken: "GA", scopes: [] });
    expect(Object.keys(calls[0].init?.headers as Record<string, string>)).not.toContain("developer-token");
    expect(Object.keys(calls[0].init?.headers as Record<string, string>)).not.toContain("login-customer-id");
  });
});

describe("Google Ads campaigns", () => {
  it("aggregates daily rows into campaign records in minor units", async () => {
    const { fetchImpl } = fake([
      {
        match: (u, i) => u.includes("googleAds:searchStream") && query(i).startsWith("SELECT customer.currency_code"),
        respond: () => ({ json: [{ results: [{ customer: { currencyCode: "CAD" } }] }] }),
      },
      {
        match: (u, i) => u.includes("googleAds:searchStream") && query(i).includes("FROM campaign WHERE segments.date BETWEEN '2026-09-01' AND '2026-09-30'"),
        respond: () => ({
          json: [
            {
              results: [
                { campaign: { id: "9", name: "Search", status: "ENABLED", advertisingChannelType: "SEARCH", campaignBudget: "customers/1234567890/campaignBudgets/4" }, campaignBudget: { amountMicros: "25000000" }, metrics: { impressions: "100", clicks: "4", costMicros: "3500000", conversions: 1 } },
                { campaign: { id: "9", name: "Search", status: "ENABLED", advertisingChannelType: "SEARCH" }, campaignBudget: { amountMicros: "25000000" }, metrics: { impressions: "50", clicks: "1", costMicros: "1500000" } },
              ],
            },
          ],
        }),
      },
    ]);
    const [c] = await createGoogleAdsAdapter(env, { fetchImpl }).listAdCampaigns!(cred, { since: new Date("2026-09-01T00:00:00Z"), until: new Date("2026-09-30T00:00:00Z") });
    expect(c).toMatchObject({ externalCampaignId: "9", currency: "CAD", dailyBudgetMinor: 2500, spendMinor: 500, impressions: 150, clicks: 5, conversions: 1, reach: null });
  });

  it("pauses through campaigns:mutate and updates budgets via the campaign's budget resource", async () => {
    const { fetchImpl, calls } = fake([
      { match: (u) => u.endsWith("/campaigns:mutate"), respond: () => ({ json: { results: [{ resourceName: "customers/1234567890/campaigns/9" }] } }) },
      { match: (u) => u.includes("googleAds:searchStream"), respond: () => ({ json: [{ results: [{ campaign: { campaignBudget: "customers/1234567890/campaignBudgets/4" } }] }] }) },
      { match: (u) => u.endsWith("/campaignBudgets:mutate"), respond: () => ({ json: { results: [{ resourceName: "customers/1234567890/campaignBudgets/4" }] } }) },
    ]);
    const adapter = createGoogleAdsAdapter(env, { fetchImpl });
    await adapter.executeAdChange!(cred, { changeType: "pause_campaign", payload: { externalCampaignId: "9" }, idempotencyKey: "k" });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ operations: [{ update: { resourceName: "customers/1234567890/campaigns/9", status: "PAUSED" }, updateMask: "status" }] });
    await adapter.executeAdChange!(cred, { changeType: "update_budget", payload: { externalCampaignId: "9", dailyBudgetMinor: 4000, currency: "CAD" }, idempotencyKey: "k" });
    expect(JSON.parse(String(calls.at(-1)!.init?.body))).toEqual({ operations: [{ update: { resourceName: "customers/1234567890/campaignBudgets/4", amountMicros: "40000000" }, updateMask: "amount_micros" }] });
  });

  it("creates a budget then a paused campaign declaring no EU political ads", async () => {
    const { fetchImpl, calls } = fake([
      { match: (u) => u.endsWith("/campaignBudgets:mutate"), respond: () => ({ json: { results: [{ resourceName: "customers/1234567890/campaignBudgets/77" }] } }) },
      { match: (u) => u.endsWith("/campaigns:mutate"), respond: () => ({ json: { results: [{ resourceName: "customers/1234567890/campaigns/88" }] } }) },
    ]);
    const res = await createGoogleAdsAdapter(env, { fetchImpl }).executeAdChange!(cred, { changeType: "create_campaign", payload: { name: "Fall", objective: "LEADS", dailyBudgetMinor: 2000, currency: "CAD" }, idempotencyKey: "abc12345678" });
    expect(res.externalIds).toEqual({ campaign: "customers/1234567890/campaigns/88", campaignBudget: "customers/1234567890/campaignBudgets/77" });
    const create = JSON.parse(String(calls[1].init?.body)).operations[0].create;
    expect(create).toMatchObject({ status: "PAUSED", advertisingChannelType: "SEARCH", campaignBudget: "customers/1234567890/campaignBudgets/77", containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING", manualCpc: {} });
    expect(JSON.parse(String(calls[0].init?.body)).operations[0].create).toMatchObject({ amountMicros: "20000000", explicitlyShared: false });
  });

  it("refuses unsupported change types and has no publishing", async () => {
    const adapter = createGoogleAdsAdapter(env);
    expect(adapter.publish).toBeUndefined();
    await expect(adapter.executeAdChange!(cred, { changeType: "update_targeting", payload: {}, idempotencyKey: "k" })).rejects.toBeInstanceOf(SocialProviderNotSupportedError);
  });
});

describe("Google error mapping", () => {
  it("UNAUTHENTICATED → authorizationLost, RESOURCE_EXHAUSTED/429 → retryable, PERMISSION_DENIED → permanent", async () => {
    expect(classifyProviderError(401, { error: { code: 401, status: "UNAUTHENTICATED", message: "Request had invalid authentication credentials." } })).toMatchObject({ authorizationLost: true, retryable: false });
    expect(classifyProviderError(429, [{ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "quota" } }])).toMatchObject({ retryable: true });
    const denied = classifyProviderError(403, { error: { code: 403, status: "PERMISSION_DENIED", message: "x", details: [{ errors: [{ errorCode: { authorizationError: "DEVELOPER_TOKEN_NOT_APPROVED" }, message: "The developer token is not approved." }] }] } });
    expect(denied).toMatchObject({ retryable: false, authorizationLost: false, code: "google_authorizationError.DEVELOPER_TOKEN_NOT_APPROVED" });

    const { fetchImpl } = fake([{ match: () => true, respond: () => ({ status: 401, json: { error: { code: 401, status: "UNAUTHENTICATED", message: "expired" } } }) }]);
    expect(await createGoogleAdsAdapter(env, { fetchImpl }).verify(cred)).toMatchObject({ ok: false, authorizationLost: true });
  });

  it("reports missing configuration including the developer token", () => {
    expect(createGoogleAdsAdapter({}).missingConfiguration()).toEqual(["GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_DEVELOPER_TOKEN"]);
  });
});
