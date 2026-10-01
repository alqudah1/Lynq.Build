import { SocialProviderNotSupportedError } from "../../errors";
import { SOCIAL_PLATFORM_PROVIDER, type SocialPlatform } from "../../validation";
import { createMetaAdapter, type MetaEnv } from "./meta";
import { createLinkedInAdapter, type LinkedInEnv } from "./linkedin";
import { createGoogleAdsAdapter, type GoogleAdsEnv } from "./google-ads";
import type { FetchLike, SocialProviderAdapter, SocialProviderId } from "./types";

/**
 * Module 19 — resolves the adapter for a provider or platform. Pass
 * `loadEnv()` (or any object carrying the provider keys); availability is
 * always derived from env, never assumed.
 */

export type SocialProviderEnv = MetaEnv & LinkedInEnv & GoogleAdsEnv;

export interface SocialAdapterDeps {
  fetchImpl?: FetchLike;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export const SOCIAL_PROVIDER_IDS: readonly SocialProviderId[] = ["meta", "linkedin", "google_ads"];

export const SOCIAL_PROVIDER_LABELS: Record<SocialProviderId, string> = {
  meta: "Meta (Facebook, Instagram, Meta Ads)",
  linkedin: "LinkedIn (Pages, profile, LinkedIn Ads)",
  google_ads: "Google Ads",
};

export function resolveSocialProviderAdapter(provider: SocialProviderId, env: SocialProviderEnv, deps: SocialAdapterDeps = {}): SocialProviderAdapter {
  switch (provider) {
    case "meta":
      return createMetaAdapter(env, deps);
    case "linkedin":
      return createLinkedInAdapter(env, deps);
    case "google_ads":
      return createGoogleAdsAdapter(env, deps);
    default:
      throw new SocialProviderNotSupportedError(String(provider), "a provider adapter");
  }
}

export function resolveAdapterForPlatform(platform: SocialPlatform, env: SocialProviderEnv, deps: SocialAdapterDeps = {}): SocialProviderAdapter {
  const provider = SOCIAL_PLATFORM_PROVIDER[platform];
  if (!provider) throw new SocialProviderNotSupportedError(platform, "an official API integration");
  return resolveSocialProviderAdapter(provider, env, deps);
}

export interface SocialProviderAvailability {
  provider: SocialProviderId;
  label: string;
  platforms: readonly SocialPlatform[];
  configured: boolean;
  missing: string[];
}

export function describeProviderAvailability(env: SocialProviderEnv): SocialProviderAvailability[] {
  return SOCIAL_PROVIDER_IDS.map((provider) => {
    const adapter = resolveSocialProviderAdapter(provider, env);
    const missing = adapter.missingConfiguration();
    return { provider, label: SOCIAL_PROVIDER_LABELS[provider], platforms: adapter.platforms, configured: missing.length === 0, missing };
  });
}
