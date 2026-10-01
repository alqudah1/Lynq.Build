import { SocialProviderError } from "../../errors";
import type { FetchLike } from "./types";

/**
 * Module 19 — shared HTTP plumbing for the social provider adapters. One
 * place turns every provider's error envelope (Graph API, LinkedIn Rest.li,
 * Google APIs / OAuth) into a `SocialProviderError` with an honest
 * classification:
 *
 *  - `retryable`: network failures, HTTP 429, HTTP 5xx, Meta throttling
 *    codes (4, 17, 32, 613, 80001–80014) and Meta `is_transient` errors.
 *  - `authorizationLost`: HTTP 401, Meta code 190 (and subcodes 458–467),
 *    LinkedIn EXPIRED/REVOKED access tokens, Google `UNAUTHENTICATED` and
 *    OAuth `invalid_grant`.
 *  - everything else (400/403/404/…) is permanent — a human must look.
 *
 * Messages never contain a token: query-string secrets and bearer values
 * are redacted before a message is built.
 */

export type SocialProviderName = "meta" | "linkedin" | "google_ads";

export interface JsonResponse<T> {
  status: number;
  headers: Headers;
  /** Parsed JSON body, or `null` for an empty (201/204) body. */
  data: T;
}

const SECRET_PARAM_PATTERN = /\b(access_token|input_token|fb_exchange_token|client_secret|refresh_token|code|appsecret_proof|uploadToken|developer-token)=([^&\s"']*)/gi;

/** Removes anything token-shaped from a string destined for an error message or log. */
export function redactSecrets(value: string): string {
  return value
    .replace(SECRET_PARAM_PATTERN, "$1=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
    .replace(/\b(EAA[A-Za-z0-9]{20,}|ya29\.[A-Za-z0-9._-]+|AQ[A-Za-z0-9_-]{40,})\b/g, "[redacted]");
}

function truncate(value: string, max = 300): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Strips the query string from a URL (for messages) — paths are useful, query strings may carry secrets. */
export function describeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return redactSecrets(url.split("?")[0] ?? "");
  }
}

const META_THROTTLE_CODES = new Set([4, 17, 32, 341, 368, 613, 80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80009, 80014]);
const META_AUTH_SUBCODES = new Set([458, 459, 460, 463, 464, 467, 492]);

/** Max percentage reported in Meta's `X-App-Usage` / `X-Business-Use-Case-Usage` / `X-Ad-Account-Usage` headers (null when absent). */
export function metaUsagePercent(headers: Headers): number | null {
  let max: number | null = null;
  const consider = (value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) max = max === null ? value : Math.max(max, value);
  };
  const scan = (obj: unknown) => {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      obj.forEach(scan);
      return;
    }
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (["call_count", "total_cputime", "total_time", "acc_id_util_pct"].includes(key)) consider(value);
      else if (typeof value === "object") scan(value);
    }
  };
  for (const name of ["x-app-usage", "x-business-use-case-usage", "x-ad-account-usage"]) {
    const raw = headers.get(name);
    if (!raw) continue;
    try {
      scan(JSON.parse(raw));
    } catch {
      // malformed usage header — ignore, it is advisory only
    }
  }
  return max;
}

interface ErrorClassification {
  code: string;
  message: string;
  retryable: boolean;
  authorizationLost: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Classifies a non-2xx response body. Exported for unit tests. */
export function classifyProviderError(status: number, body: unknown, headers?: Headers): ErrorClassification {
  const retryableStatus = status === 429 || status >= 500;
  let code = `http_${status}`;
  let message = `request failed with HTTP ${status}`;
  let retryable = retryableStatus;
  let authorizationLost = status === 401;

  // Google returns searchStream errors as an array of envelopes.
  const root = Array.isArray(body) ? body[0] : body;
  const record = asRecord(root);
  const nested = asRecord(record?.error);

  if (nested && (typeof nested.code === "number" || typeof nested.type === "string" || "fbtrace_id" in nested || "error_subcode" in nested)) {
    // Meta Graph API: { error: { message, type, code, error_subcode, is_transient } } — also Google APIs: { error: { code, message, status, details } }
    if (typeof nested.status === "string") {
      const gStatus = nested.status;
      const details = Array.isArray(nested.details) ? nested.details : [];
      let detailCode: string | null = null;
      for (const d of details) {
        const errors = asRecord(d)?.errors;
        if (Array.isArray(errors) && errors[0]) {
          const ec = asRecord(asRecord(errors[0])?.errorCode);
          if (ec) {
            const [k, v] = Object.entries(ec)[0] ?? [];
            if (k) detailCode = `${k}.${String(v)}`;
          }
          const em = asRecord(errors[0])?.message;
          if (typeof em === "string") message = em;
          break;
        }
      }
      code = detailCode ? `google_${detailCode}` : `google_${gStatus.toLowerCase()}`;
      if (typeof nested.message === "string" && !detailCode) message = nested.message;
      if (gStatus === "UNAUTHENTICATED") authorizationLost = true;
      if (gStatus === "RESOURCE_EXHAUSTED" || gStatus === "UNAVAILABLE" || gStatus === "INTERNAL" || gStatus === "DEADLINE_EXCEEDED") retryable = true;
      if (detailCode && /OAUTH_TOKEN|AUTHENTICATION_ERROR\.(OAUTH_TOKEN_EXPIRED|OAUTH_TOKEN_REVOKED|OAUTH_TOKEN_INVALID|NOT_ADS_USER)/.test(detailCode)) authorizationLost = true;
    } else {
      const metaCode = typeof nested.code === "number" ? nested.code : Number(nested.code);
      const subcode = typeof nested.error_subcode === "number" ? nested.error_subcode : Number(nested.error_subcode ?? NaN);
      code = Number.isFinite(metaCode) ? `meta_${metaCode}${Number.isFinite(subcode) ? `_${subcode}` : ""}` : code;
      if (typeof nested.error_user_msg === "string") message = nested.error_user_msg;
      else if (typeof nested.message === "string") message = nested.message;
      if (metaCode === 190 || metaCode === 102 || (Number.isFinite(subcode) && META_AUTH_SUBCODES.has(subcode))) authorizationLost = true;
      if (META_THROTTLE_CODES.has(metaCode) || (metaCode >= 80000 && metaCode <= 80014) || nested.is_transient === true || metaCode === 1 || metaCode === 2) retryable = true;
    }
  } else if (record && typeof record.error === "string") {
    // OAuth 2.0 token endpoint shape: { error: "invalid_grant", error_description }
    code = `oauth_${record.error}`;
    message = typeof record.error_description === "string" ? record.error_description : record.error;
    if (record.error === "invalid_grant" || record.error === "invalid_token" || record.error === "unauthorized_client") authorizationLost = true;
    if (record.error === "temporarily_unavailable" || record.error === "server_error") retryable = true;
  } else if (record && (typeof record.serviceErrorCode === "number" || typeof record.code === "string" || typeof record.message === "string")) {
    // LinkedIn Rest.li: { status, serviceErrorCode, code, message }
    const liCode = typeof record.code === "string" ? record.code : null;
    code = liCode ? `linkedin_${liCode.toLowerCase()}` : typeof record.serviceErrorCode === "number" ? `linkedin_${record.serviceErrorCode}` : code;
    if (typeof record.message === "string") message = record.message;
    if (liCode && /EXPIRED_ACCESS_TOKEN|REVOKED_ACCESS_TOKEN|INVALID_ACCESS_TOKEN/.test(liCode)) authorizationLost = true;
    if (typeof record.message === "string" && /expired|revoked/i.test(record.message) && /token/i.test(record.message) && status === 401) authorizationLost = true;
  }

  if (headers && !retryable && (status === 400 || status === 403)) {
    const usage = metaUsagePercent(headers);
    if (usage !== null && usage >= 100) retryable = true;
  }
  // A lost authorization is never "retry and hope".
  if (authorizationLost) retryable = false;

  return { code, message: truncate(redactSecrets(message)), retryable, authorizationLost };
}

export function providerErrorFromResponse(provider: SocialProviderName, status: number, body: unknown, headers?: Headers): SocialProviderError {
  const c = classifyProviderError(status, body, headers);
  return new SocialProviderError(provider, c.code, c.message, { retryable: c.retryable, authorizationLost: c.authorizationLost });
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: truncate(redactSecrets(text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()), 200) };
  }
}

/**
 * Performs a request and parses its JSON body. Throws `SocialProviderError`
 * for any non-2xx status or transport failure; never includes a token in
 * the error message.
 */
export async function jsonRequest<T = unknown>(fetchImpl: FetchLike, url: string, init: RequestInit, options: { provider: SocialProviderName }): Promise<JsonResponse<T>> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "network failure";
    throw new SocialProviderError(options.provider, "network_error", truncate(redactSecrets(`${init.method ?? "GET"} ${describeUrl(url)} failed: ${detail}`)), { retryable: true });
  }
  const body = await readBody(response);
  if (!response.ok) throw providerErrorFromResponse(options.provider, response.status, body, response.headers);
  // Graph API occasionally answers 200 with an error envelope.
  const rec = asRecord(body);
  if (options.provider === "meta" && rec && asRecord(rec.error) && !("data" in rec) && !("id" in rec)) throw providerErrorFromResponse(options.provider, 400, body, response.headers);
  return { status: response.status, headers: response.headers, data: body as T };
}

/** Appends query parameters (skipping undefined/null) to a URL string. */
export function withQuery(url: string, params: Record<string, string | number | boolean | undefined | null>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
  if (!entries.length) return url;
  const qs = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
  return `${url}${url.includes("?") ? "&" : "?"}${qs}`;
}

export function formBody(params: Record<string, string | undefined>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) body.set(k, v);
  return body;
}

/**
 * Resumable provider state riding on a failed publish: the adapter attaches
 * what it already created (Instagram container ids, LinkedIn media urns) so
 * the publishing service can persist it and a retry resumes instead of
 * creating a duplicate. Non-secret by construction.
 */
const PROVIDER_STATE = Symbol.for("lynq.social.providerState");

export function attachProviderState<E extends Error>(err: E, state: Record<string, unknown>): E {
  (err as unknown as Record<symbol, unknown>)[PROVIDER_STATE] = state;
  return err;
}

export function providerStateFromError(err: unknown): Record<string, unknown> | undefined {
  if (!err || typeof err !== "object") return undefined;
  const value = (err as Record<symbol, unknown>)[PROVIDER_STATE];
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

/** Runs `fn`, attaching the given provider state to any error it throws. */
export async function withProviderState<T>(state: () => Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Error && !providerStateFromError(err)) attachProviderState(err, state());
    throw err;
  }
}

export function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

export function composeCaption(body: string, hashtags: string[]): string {
  const tags = hashtags
    .map((t) => t.trim().replace(/^#+/, ""))
    .filter(Boolean)
    .map((t) => `#${t}`);
  const trimmed = body.trim();
  if (!tags.length) return trimmed;
  return trimmed ? `${trimmed}\n\n${tags.join(" ")}` : tags.join(" ");
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
