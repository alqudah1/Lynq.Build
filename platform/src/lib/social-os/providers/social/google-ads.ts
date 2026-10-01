import { SocialProviderError, SocialProviderNotSupportedError } from "../../errors";
import { socialAdChangePayloadSchemas, SOCIAL_AD_CHANGE_TYPES, type SocialAdChangeType } from "../../validation";
import { jsonRequest, formBody, numberOrUndefined, isoDate } from "./http";
import type { AdCampaignRecord, AdChangeExecutionInput, AdChangeExecutionResult, DiscoveredAsset, FetchLike, SocialAccountCredential, SocialProviderAdapter, SocialTokenBundle, VerifyResult } from "./types";

/**
 * Module 19 — Google Ads adapter (advertising only; Google Ads has no
 * organic publishing). REST interface of the Google Ads API with GAQL via
 * `googleAds:searchStream` and the `*:mutate` endpoints.
 *
 * External configuration: a Google Cloud OAuth web client (client id /
 * secret) with the Google Ads API enabled, and an approved Google Ads
 * developer token. `GOOGLE_ADS_LOGIN_CUSTOMER_ID` is the manager (MCC)
 * account to act through when the granted customers sit under a manager.
 *
 * Access tokens last ~1 hour; the refresh token (offline access) is what
 * keeps the grant alive, so `refresh` is always available when one exists.
 */

export interface GoogleAdsEnv {
  GOOGLE_ADS_CLIENT_ID?: string;
  GOOGLE_ADS_CLIENT_SECRET?: string;
  GOOGLE_ADS_DEVELOPER_TOKEN?: string;
  GOOGLE_ADS_LOGIN_CUSTOMER_ID?: string;
  GOOGLE_ADS_API_VERSION?: string;
}

export interface GoogleAdsAdapterDeps {
  fetchImpl?: FetchLike;
  now?: () => Date;
}

export const GOOGLE_ADS_SCOPE = "https://www.googleapis.com/auth/adwords";
export const GOOGLE_ADS_DEFAULT_API_VERSION = "v22";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export function buildGoogleAdsAuthorizationUrl(input: { clientId: string; redirectUri: string; state: string; scopes?: readonly string[] }): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", (input.scopes ?? [GOOGLE_ADS_SCOPE]).join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  return url.toString();
}

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

export interface GoogleTokenResult {
  accessToken: string;
  expiresAt?: string;
  refreshToken?: string;
  scopes?: string[];
  tokenType?: string;
}

function toResult(data: GoogleTokenResponse, now: Date): GoogleTokenResult {
  if (!data?.access_token) throw new SocialProviderError("google_ads", "token_exchange_failed", "Google did not return an access token", { retryable: false });
  return {
    accessToken: data.access_token,
    expiresAt: typeof data.expires_in === "number" ? new Date(now.getTime() + data.expires_in * 1000).toISOString() : undefined,
    refreshToken: data.refresh_token,
    scopes: data.scope ? data.scope.split(/\s+/).filter(Boolean) : undefined,
    tokenType: data.token_type,
  };
}

export async function exchangeGoogleAdsCode(fetchImpl: FetchLike, input: { clientId: string; clientSecret: string; redirectUri: string; code: string; codeVerifier?: string; now?: Date }): Promise<GoogleTokenResult> {
  const { data } = await jsonRequest<GoogleTokenResponse>(
    fetchImpl,
    TOKEN_URL,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: formBody({ grant_type: "authorization_code", code: input.code, client_id: input.clientId, client_secret: input.clientSecret, redirect_uri: input.redirectUri, code_verifier: input.codeVerifier }) },
    { provider: "google_ads" },
  );
  return toResult(data, input.now ?? new Date());
}

export async function refreshGoogleAdsToken(fetchImpl: FetchLike, input: { clientId: string; clientSecret: string; refreshToken: string; now?: Date }): Promise<GoogleTokenResult> {
  const { data } = await jsonRequest<GoogleTokenResponse>(
    fetchImpl,
    TOKEN_URL,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: formBody({ grant_type: "refresh_token", refresh_token: input.refreshToken, client_id: input.clientId, client_secret: input.clientSecret }) },
    { provider: "google_ads" },
  );
  return toResult(data, input.now ?? new Date());
}

/** Google Ads customer ids are digits only (no dashes). */
export function normalizeCustomerId(value: string): string {
  return value.replace(/^customers\//, "").replace(/-/g, "");
}

export function createGoogleAdsAdapter(env: GoogleAdsEnv, deps: GoogleAdsAdapterDeps = {}): SocialProviderAdapter {
  const fetchImpl: FetchLike = deps.fetchImpl ?? ((input, init) => fetch(input, init));
  const now = deps.now ?? (() => new Date());
  const version = env.GOOGLE_ADS_API_VERSION || GOOGLE_ADS_DEFAULT_API_VERSION;
  const base = `https://googleads.googleapis.com/${version}`;

  function headers(token: string): Record<string, string> {
    const h: Record<string, string> = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    if (env.GOOGLE_ADS_DEVELOPER_TOKEN) h["developer-token"] = env.GOOGLE_ADS_DEVELOPER_TOKEN;
    if (env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) h["login-customer-id"] = env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
    return h;
  }

  async function call<T>(method: "GET" | "POST", path: string, token: string, body?: unknown): Promise<T> {
    const { data } = await jsonRequest<T>(fetchImpl, `${base}${path}`, { method, headers: headers(token), body: body === undefined ? undefined : JSON.stringify(body) }, { provider: "google_ads" });
    return data;
  }

  type SearchRow = Record<string, Record<string, unknown> | undefined>;

  async function search(customerId: string, token: string, query: string): Promise<SearchRow[]> {
    const batches = await call<{ results?: SearchRow[] }[] | { results?: SearchRow[] }>("POST", `/customers/${normalizeCustomerId(customerId)}/googleAds:searchStream`, token, { query });
    const list = Array.isArray(batches) ? batches : [batches];
    return list.flatMap((b) => b?.results ?? []);
  }

  const CUSTOMER_QUERY = "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager, customer.status FROM customer";

  async function discoverAssets(bundle: SocialTokenBundle): Promise<DiscoveredAsset[]> {
    const token = bundle.accessToken;
    const { resourceNames = [] } = await call<{ resourceNames?: string[] }>("GET", "/customers:listAccessibleCustomers", token);
    const managers: DiscoveredAsset[] = [];
    const clients: DiscoveredAsset[] = [];
    for (const resourceName of resourceNames) {
      const cid = normalizeCustomerId(resourceName);
      let rows: SearchRow[];
      try {
        rows = await search(cid, token, CUSTOMER_QUERY);
      } catch (err) {
        // A customer we can see but not query (e.g. needs a different login-customer-id) is skipped, not fatal.
        if (err instanceof SocialProviderError && !err.authorizationLost && !err.retryable) continue;
        throw err;
      }
      const c = rows[0]?.customer;
      if (!c) continue;
      const status = typeof c.status === "string" ? c.status : null;
      if (status === "CANCELED" || status === "CLOSED") continue;
      const asset: DiscoveredAsset = {
        platform: "google_ads",
        externalAccountId: cid,
        displayName: (typeof c.descriptiveName === "string" && c.descriptiveName) || `Google Ads ${cid.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3")}`,
        externalUrl: `https://ads.google.com/aw/overview?ocid=${cid}`,
        accountKind: "paid",
        metadata: { currency: typeof c.currencyCode === "string" ? c.currencyCode : null, manager: c.manager === true, status },
      };
      (c.manager === true ? managers : clients).push(asset);
    }
    return clients.length ? clients : managers;
  }

  async function verify(credential: SocialAccountCredential): Promise<VerifyResult> {
    try {
      const rows = await search(credential.externalAccountId, credential.bundle.accessToken, CUSTOMER_QUERY);
      const c = rows[0]?.customer;
      if (!c) return { ok: false, detail: "Google Ads returned no customer for this account" };
      return { ok: true, detail: (typeof c.descriptiveName === "string" && c.descriptiveName) || credential.externalAccountId };
    } catch (err) {
      if (err instanceof SocialProviderError && err.authorizationLost) return { ok: false, detail: err.message, authorizationLost: true };
      throw err;
    }
  }

  async function refresh(bundle: SocialTokenBundle): Promise<SocialTokenBundle> {
    if (!bundle.refreshToken) throw new SocialProviderNotSupportedError("google_ads", "token refresh without a refresh token");
    if (!env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET) throw new SocialProviderError("google_ads", "not_configured", "Google Ads client credentials are not configured", { retryable: false });
    const res = await refreshGoogleAdsToken(fetchImpl, { clientId: env.GOOGLE_ADS_CLIENT_ID, clientSecret: env.GOOGLE_ADS_CLIENT_SECRET, refreshToken: bundle.refreshToken, now: now() });
    return { ...bundle, accessToken: res.accessToken, expiresAt: res.expiresAt, refreshToken: res.refreshToken ?? bundle.refreshToken, scopes: res.scopes ?? bundle.scopes, tokenType: res.tokenType ?? bundle.tokenType };
  }

  function microsToMinor(value: unknown): number | null {
    const n = numberOrUndefined(value);
    return n === undefined ? null : Math.round(n / 10000);
  }

  async function campaignRows(credential: SocialAccountCredential, range: { since: Date; until: Date }): Promise<SearchRow[]> {
    const query = `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.campaign_budget, campaign_budget.amount_micros, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.ctr, metrics.average_cpc FROM campaign WHERE segments.date BETWEEN '${isoDate(range.since)}' AND '${isoDate(range.until)}' AND campaign.status != 'REMOVED'`;
    return search(credential.externalAccountId, credential.bundle.accessToken, query);
  }

  async function listAdCampaigns(credential: SocialAccountCredential, range: { since: Date; until: Date }): Promise<AdCampaignRecord[]> {
    if (credential.platform !== "google_ads") throw new SocialProviderNotSupportedError(credential.platform, "Google Ads campaigns");
    const customer = (await search(credential.externalAccountId, credential.bundle.accessToken, "SELECT customer.currency_code FROM customer"))[0]?.customer;
    const currency = typeof customer?.currencyCode === "string" ? customer.currencyCode : "USD";
    const rows = await campaignRows(credential, range);
    // searchStream with segments.date returns one row per campaign per day — aggregate.
    const byId = new Map<string, AdCampaignRecord>();
    for (const row of rows) {
      const c = row.campaign ?? {};
      const m = row.metrics ?? {};
      const b = row.campaignBudget ?? {};
      const id = String(c.id ?? "");
      if (!id) continue;
      let rec = byId.get(id);
      if (!rec) {
        rec = {
          externalCampaignId: id,
          name: String(c.name ?? id),
          status: String(c.status ?? "UNKNOWN"),
          objective: typeof c.advertisingChannelType === "string" ? c.advertisingChannelType : null,
          currency,
          dailyBudgetMinor: microsToMinor(b.amountMicros),
          lifetimeBudgetMinor: null,
          periodStart: range.since,
          periodEnd: range.until,
          spendMinor: null,
          impressions: null,
          clicks: null,
          reach: null,
          conversions: null,
          metrics: typeof c.campaignBudget === "string" ? { campaignBudget: c.campaignBudget } : {},
        };
        byId.set(id, rec);
      }
      const add = (key: "impressions" | "clicks" | "conversions", value: unknown) => {
        const n = numberOrUndefined(value);
        if (n !== undefined) rec![key] = (rec![key] ?? 0) + n;
      };
      add("impressions", m.impressions);
      add("clicks", m.clicks);
      add("conversions", m.conversions);
      const cost = numberOrUndefined(m.costMicros);
      if (cost !== undefined) rec.metrics.costMicros = Number(rec.metrics.costMicros ?? 0) + cost;
    }
    for (const rec of byId.values()) {
      if (rec.metrics.costMicros !== undefined) rec.spendMinor = Math.round(Number(rec.metrics.costMicros) / 10000);
      if (rec.impressions && rec.clicks !== null && rec.clicks !== undefined) rec.metrics.ctr = rec.clicks / rec.impressions;
      if (rec.clicks && rec.metrics.costMicros !== undefined) rec.metrics.averageCpcMicros = Math.round(Number(rec.metrics.costMicros) / rec.clicks);
    }
    return [...byId.values()];
  }

  async function executeAdChange(credential: SocialAccountCredential, input: AdChangeExecutionInput): Promise<AdChangeExecutionResult> {
    if (credential.platform !== "google_ads") throw new SocialProviderNotSupportedError(credential.platform, "ad changes");
    if (!(SOCIAL_AD_CHANGE_TYPES as readonly string[]).includes(input.changeType)) throw new SocialProviderNotSupportedError("google_ads", input.changeType);
    const changeType = input.changeType as SocialAdChangeType;
    const cid = normalizeCustomerId(credential.externalAccountId);
    const token = credential.bundle.accessToken;
    switch (changeType) {
      case "pause_campaign":
      case "resume_campaign": {
        const p = socialAdChangePayloadSchemas[changeType].parse(input.payload);
        const status = changeType === "pause_campaign" ? "PAUSED" : "ENABLED";
        const resourceName = `customers/${cid}/campaigns/${p.externalCampaignId}`;
        await call("POST", `/customers/${cid}/campaigns:mutate`, token, { operations: [{ update: { resourceName, status }, updateMask: "status" }] });
        return { externalIds: { campaign: resourceName }, summary: `Set campaign ${p.externalCampaignId} to ${status}` };
      }
      case "update_budget": {
        const p = socialAdChangePayloadSchemas.update_budget.parse(input.payload);
        if (p.dailyBudgetMinor === undefined) throw new SocialProviderNotSupportedError("google_ads", "lifetime budgets on campaign budgets");
        const rows = await search(cid, token, `SELECT campaign.campaign_budget FROM campaign WHERE campaign.id = ${Number(p.externalCampaignId)}`);
        const budget = rows[0]?.campaign?.campaignBudget;
        if (typeof budget !== "string") throw new SocialProviderError("google_ads", "budget_not_found", "Could not find the campaign's budget", { retryable: false });
        await call("POST", `/customers/${cid}/campaignBudgets:mutate`, token, { operations: [{ update: { resourceName: budget, amountMicros: String(p.dailyBudgetMinor * 10000) }, updateMask: "amount_micros" }] });
        return { externalIds: { campaignBudget: budget }, summary: `Updated daily budget on campaign ${p.externalCampaignId}` };
      }
      case "create_campaign": {
        const p = socialAdChangePayloadSchemas.create_campaign.parse(input.payload);
        if (p.dailyBudgetMinor === undefined) throw new SocialProviderError("google_ads", "budget_required", "Google Ads campaigns need a daily budget", { retryable: false });
        const budgetRes = await call<{ results?: { resourceName: string }[] }>("POST", `/customers/${cid}/campaignBudgets:mutate`, token, {
          operations: [{ create: { name: `${p.name} budget ${input.idempotencyKey.slice(-8)}`, amountMicros: String(p.dailyBudgetMinor * 10000), deliveryMethod: "STANDARD", explicitlyShared: false } }],
        });
        const budget = budgetRes.results?.[0]?.resourceName;
        if (!budget) throw new SocialProviderError("google_ads", "budget_create_failed", "Google Ads did not return the new budget", { retryable: false });
        const campaignRes = await call<{ results?: { resourceName: string }[] }>("POST", `/customers/${cid}/campaigns:mutate`, token, {
          operations: [
            {
              create: {
                name: p.name,
                status: "PAUSED",
                advertisingChannelType: p.channelType ?? "SEARCH",
                campaignBudget: budget,
                containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
                manualCpc: {},
                ...((p.channelType ?? "SEARCH") === "SEARCH" ? { networkSettings: { targetGoogleSearch: true, targetSearchNetwork: true, targetContentNetwork: false, targetPartnerSearchNetwork: false } } : {}),
              },
            },
          ],
        });
        const campaign = campaignRes.results?.[0]?.resourceName;
        if (!campaign) throw new SocialProviderError("google_ads", "campaign_create_failed", "Google Ads did not return the new campaign", { retryable: false });
        return { externalIds: { campaign, campaignBudget: budget }, summary: `Created paused campaign "${p.name}"` };
      }
      default:
        throw new SocialProviderNotSupportedError("google_ads", changeType);
    }
  }

  return {
    provider: "google_ads",
    platforms: ["google_ads"],
    missingConfiguration() {
      const missing: string[] = [];
      if (!env.GOOGLE_ADS_CLIENT_ID) missing.push("GOOGLE_ADS_CLIENT_ID");
      if (!env.GOOGLE_ADS_CLIENT_SECRET) missing.push("GOOGLE_ADS_CLIENT_SECRET");
      if (!env.GOOGLE_ADS_DEVELOPER_TOKEN) missing.push("GOOGLE_ADS_DEVELOPER_TOKEN");
      return missing;
    },
    verify,
    discoverAssets,
    refresh,
    listAdCampaigns,
    executeAdChange,
  };
}
