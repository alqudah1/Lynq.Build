import { SocialProviderNotConfiguredError } from "../../errors";
import { createAnthropicProvider } from "./anthropic";
import { createGatewayTextProvider } from "./gateway";
import { createHiggsfieldVideoProvider } from "./higgsfield";
import { createOpenAiImageProvider, createOpenAiTextProvider, estimateOpenAiImageCostUsd } from "./openai";
import { createRunwayImageProvider, createRunwayVideoProvider, RUNWAY_IMAGE_COST_USD } from "./runway";
import type { ProviderDeps, SocialAiEnv } from "./http";
import type { AiProviderAvailability, AiProviderId, AnyAiProvider, ImageGenerationRequest, ImageProvider, TextProvider, VideoProvider } from "./types";

/**
 * Module 19 — which creative AI providers this server can use, derived
 * from env only (never assumed), and resolution in a fixed preference
 * order: text anthropic → openai → gateway; image openai → runway; video
 * runway → higgsfield. A `preferred` provider is honoured only when it is
 * configured.
 */

export const TEXT_PROVIDER_ORDER = ["anthropic", "openai", "gateway"] as const satisfies readonly AiProviderId[];
export const IMAGE_PROVIDER_ORDER = ["openai", "runway"] as const satisfies readonly AiProviderId[];
export const VIDEO_PROVIDER_ORDER = ["runway", "higgsfield"] as const satisfies readonly AiProviderId[];

function textProviders(env: SocialAiEnv, deps?: ProviderDeps): TextProvider[] {
  return [createAnthropicProvider(env, deps), createOpenAiTextProvider(env, deps), createGatewayTextProvider(env)];
}
function imageProviders(env: SocialAiEnv, deps?: ProviderDeps): ImageProvider[] {
  return [createOpenAiImageProvider(env, deps), createRunwayImageProvider(env, deps)];
}
function videoProviders(env: SocialAiEnv, deps?: ProviderDeps): VideoProvider[] {
  return [createRunwayVideoProvider(env, deps), createHiggsfieldVideoProvider(env, deps)];
}

function availability(p: AnyAiProvider): AiProviderAvailability {
  const missing = p.missingConfiguration();
  return { id: p.id, kind: p.kind, label: p.label, configured: missing.length === 0, missing, defaultModel: p.defaultModel };
}

export function describeAiProviders(env: SocialAiEnv): AiProviderAvailability[] {
  return [...textProviders(env), ...imageProviders(env), ...videoProviders(env)].map(availability);
}

function pick<T extends AnyAiProvider>(providers: T[], kindLabel: string, preferred?: AiProviderId): T {
  if (preferred) {
    const wanted = providers.find((p) => p.id === preferred);
    if (wanted) {
      const missing = wanted.missingConfiguration();
      if (missing.length) throw new SocialProviderNotConfiguredError(`${wanted.label} (${kindLabel})`, missing);
      return wanted;
    }
  }
  const configured = providers.find((p) => p.missingConfiguration().length === 0);
  if (configured) return configured;
  throw new SocialProviderNotConfiguredError(kindLabel, providers.map((p) => p.missingConfiguration().join(" + ")));
}

export function resolveTextProvider(env: SocialAiEnv, preferred?: AiProviderId, deps?: ProviderDeps): TextProvider {
  return pick(textProviders(env, deps), "text generation", preferred);
}

export function resolveImageProvider(env: SocialAiEnv, preferred?: AiProviderId, deps?: ProviderDeps): ImageProvider {
  return pick(imageProviders(env, deps), "image generation", preferred);
}

export function resolveVideoProvider(env: SocialAiEnv, preferred?: AiProviderId, deps?: ProviderDeps): VideoProvider {
  return pick(videoProviders(env, deps), "video generation", preferred);
}

export function resolveProviderById(env: SocialAiEnv, id: AiProviderId, kind: "text", deps?: ProviderDeps): TextProvider | null;
export function resolveProviderById(env: SocialAiEnv, id: AiProviderId, kind: "image", deps?: ProviderDeps): ImageProvider | null;
export function resolveProviderById(env: SocialAiEnv, id: AiProviderId, kind: "video", deps?: ProviderDeps): VideoProvider | null;
export function resolveProviderById(env: SocialAiEnv, id: AiProviderId, kind: "text" | "image" | "video", deps?: ProviderDeps): AnyAiProvider | null {
  const list: AnyAiProvider[] = kind === "text" ? textProviders(env, deps) : kind === "image" ? imageProviders(env, deps) : videoProviders(env, deps);
  return list.find((p) => p.id === id) ?? null;
}

/** Pre-flight image cost estimate per provider (USD) for the daily budget guard. */
export function estimateImageCostUsd(providerId: AiProviderId, aspectRatio: ImageGenerationRequest["aspectRatio"]): number {
  if (providerId === "openai") return estimateOpenAiImageCostUsd(aspectRatio);
  if (providerId === "runway") return RUNWAY_IMAGE_COST_USD;
  return 0.1;
}

/** The env slice the provider layer reads: `loadEnv()` plus the Google AI Studio key the Office model router reads directly. */
export async function loadSocialAiEnv(): Promise<SocialAiEnv> {
  const { loadEnv } = await import("@/lib/env");
  return { ...loadEnv(), GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY };
}

export type { SocialAiEnv } from "./http";
