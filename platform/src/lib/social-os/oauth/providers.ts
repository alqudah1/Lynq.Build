import { SocialProviderNotConfiguredError } from "../errors";
import { buildMetaAuthorizationUrl, exchangeMetaCode, exchangeMetaLongLivedToken, fetchMetaPrincipal, debugMetaToken, META_DEFAULT_SCOPES, META_DEFAULT_GRAPH_VERSION } from "../providers/social/meta";
import { buildLinkedInAuthorizationUrl, exchangeLinkedInCode, fetchLinkedInPrincipal, resolveLinkedInScopes } from "../providers/social/linkedin";
import { buildGoogleAdsAuthorizationUrl, exchangeGoogleAdsCode, GOOGLE_ADS_SCOPE } from "../providers/social/google-ads";
import { SocialProviderError } from "../errors";
import type { SocialProviderEnv } from "../providers/social/registry";
import type { FetchLike, SocialProviderId, SocialTokenBundle } from "../providers/social/types";

/**
 * Module 19 — per-provider OAuth glue for the Connection Center: build the
 * consent URL and turn an authorization code into the encrypted-at-rest
 * `SocialTokenBundle` shape. Pure HTTP; no database.
 */

/** Stored bundle, plus the refresh token's own expiry when the provider reports one (LinkedIn partners). */
export type StoredSocialTokenBundle = SocialTokenBundle & { refreshTokenExpiresAt?: string };

export function socialOAuthRedirectUri(authBaseUrl: string, provider: SocialProviderId): string {
  return `${authBaseUrl.replace(/\/+$/, "")}/api/social/oauth/${provider}/callback`;
}

export function requestedScopes(provider: SocialProviderId, env: SocialProviderEnv = {}): string[] {
  if (provider === "meta") return [...META_DEFAULT_SCOPES];
  if (provider === "linkedin") return resolveLinkedInScopes(env);
  return [GOOGLE_ADS_SCOPE];
}

function requireConfig(provider: SocialProviderId, values: Record<string, string | undefined>): Record<string, string> {
  const missing = Object.entries(values)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) throw new SocialProviderNotConfiguredError(provider, missing);
  return values as Record<string, string>;
}

export function buildProviderAuthorizationUrl(provider: SocialProviderId, env: SocialProviderEnv, input: { redirectUri: string; state: string }): string {
  if (provider === "meta") {
    const c = requireConfig(provider, { META_APP_ID: env.META_APP_ID, META_APP_SECRET: env.META_APP_SECRET });
    return buildMetaAuthorizationUrl({ appId: c.META_APP_ID, redirectUri: input.redirectUri, state: input.state, version: env.META_GRAPH_API_VERSION || META_DEFAULT_GRAPH_VERSION, configId: env.META_LOGIN_CONFIG_ID?.trim() || undefined });
  }
  if (provider === "linkedin") {
    const c = requireConfig(provider, { LINKEDIN_CLIENT_ID: env.LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET: env.LINKEDIN_CLIENT_SECRET });
    return buildLinkedInAuthorizationUrl({ clientId: c.LINKEDIN_CLIENT_ID, redirectUri: input.redirectUri, state: input.state, scopes: resolveLinkedInScopes(env) });
  }
  const c = requireConfig(provider, { GOOGLE_ADS_CLIENT_ID: env.GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET: env.GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_DEVELOPER_TOKEN: env.GOOGLE_ADS_DEVELOPER_TOKEN });
  return buildGoogleAdsAuthorizationUrl({ clientId: c.GOOGLE_ADS_CLIENT_ID, redirectUri: input.redirectUri, state: input.state });
}

export async function exchangeProviderCode(
  provider: SocialProviderId,
  env: SocialProviderEnv,
  input: { code: string; redirectUri: string; codeVerifier?: string; fetchImpl: FetchLike; now: Date },
): Promise<StoredSocialTokenBundle> {
  const { fetchImpl, now } = input;
  if (provider === "meta") {
    const c = requireConfig(provider, { META_APP_ID: env.META_APP_ID, META_APP_SECRET: env.META_APP_SECRET });
    const version = env.META_GRAPH_API_VERSION || META_DEFAULT_GRAPH_VERSION;
    const short = await exchangeMetaCode(fetchImpl, { appId: c.META_APP_ID, appSecret: c.META_APP_SECRET, redirectUri: input.redirectUri, code: input.code, version });
    const long = await exchangeMetaLongLivedToken(fetchImpl, { appId: c.META_APP_ID, appSecret: c.META_APP_SECRET, accessToken: short.accessToken, version });
    const principal = await fetchMetaPrincipal(fetchImpl, { accessToken: long.accessToken, version });
    let scopes = requestedScopes(provider, env);
    let expiresAt = typeof long.expiresIn === "number" ? new Date(now.getTime() + long.expiresIn * 1000).toISOString() : undefined;
    try {
      const dbg = await debugMetaToken(fetchImpl, { appId: c.META_APP_ID, appSecret: c.META_APP_SECRET, token: long.accessToken, version });
      if (dbg) {
        if (dbg.scopes.length) scopes = dbg.scopes;
        expiresAt = dbg.expiresAt ?? expiresAt;
      }
    } catch (err) {
      if (err instanceof SocialProviderError && err.authorizationLost) throw err;
    }
    return { accessToken: long.accessToken, tokenType: "bearer", expiresAt, scopes, principal };
  }
  if (provider === "linkedin") {
    const c = requireConfig(provider, { LINKEDIN_CLIENT_ID: env.LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET: env.LINKEDIN_CLIENT_SECRET });
    const token = await exchangeLinkedInCode(fetchImpl, { clientId: c.LINKEDIN_CLIENT_ID, clientSecret: c.LINKEDIN_CLIENT_SECRET, redirectUri: input.redirectUri, code: input.code, now });
    let principal: { externalId: string; name?: string } | undefined;
    try {
      principal = await fetchLinkedInPrincipal(fetchImpl, token.accessToken);
    } catch (err) {
      if (err instanceof SocialProviderError && (err.authorizationLost || err.retryable)) throw err;
    }
    return {
      accessToken: token.accessToken,
      tokenType: "bearer",
      expiresAt: token.expiresAt,
      refreshToken: token.refreshToken,
      ...(token.refreshTokenExpiresAt ? { refreshTokenExpiresAt: token.refreshTokenExpiresAt } : {}),
      scopes: token.scopes ?? requestedScopes(provider, env),
      principal,
    };
  }
  const c = requireConfig(provider, { GOOGLE_ADS_CLIENT_ID: env.GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET: env.GOOGLE_ADS_CLIENT_SECRET });
  const token = await exchangeGoogleAdsCode(fetchImpl, { clientId: c.GOOGLE_ADS_CLIENT_ID, clientSecret: c.GOOGLE_ADS_CLIENT_SECRET, redirectUri: input.redirectUri, code: input.code, codeVerifier: input.codeVerifier, now });
  return { accessToken: token.accessToken, tokenType: token.tokenType ?? "bearer", expiresAt: token.expiresAt, refreshToken: token.refreshToken, scopes: token.scopes ?? requestedScopes(provider, env) };
}
