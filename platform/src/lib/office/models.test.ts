import { afterEach, describe, expect, it, vi } from "vitest";
import { getOfficeGenerationConfig, getOfficeModel, isDirectGoogleModelConfigured } from "./models";

describe("Office model routing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses a cross-provider fallback chain for the default model", () => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
    expect(getOfficeGenerationConfig("planning")).toMatchObject({
      model: { modelId: "inclusionai/ling-3.0-flash-fin-free", provider: "gateway" },
      providerOptions: {
        gateway: {
          models: ["minimax/minimax-m2.7-free", "poolside/laguna-s-2.1-free"],
          tags: ["feature:lynq-office", "role:planning"],
        },
      },
    });
  });

  it("supports role-specific primary and fallback overrides without duplicating the primary", () => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
    vi.stubEnv("OFFICE_REVIEW_MODEL", "google/gemini-3-flash");
    vi.stubEnv("OFFICE_REVIEW_MODEL_FALLBACKS", "google/gemini-3-flash, openai/gpt-5-nano, alibaba/qwen3.5-flash");

    expect(getOfficeGenerationConfig("review")).toMatchObject({
      model: { modelId: "google/gemini-3-flash", provider: "gateway" },
      providerOptions: { gateway: { models: ["openai/gpt-5-nano", "alibaba/qwen3.5-flash"] } },
    });
  });

  it("rejects malformed model overrides", () => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
    vi.stubEnv("OFFICE_ENGINEERING_MODEL", "not-a-model");
    expect(() => getOfficeModel("engineering")).toThrow("OFFICE_ENGINEERING_MODEL must use provider/model format");
  });

  it("uses a direct Google AI Studio model when a free API key is configured", () => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key");
    vi.stubEnv("GOOGLE_AI_STUDIO_MODEL", "gemini-2.5-flash-lite");

    expect(isDirectGoogleModelConfigured()).toBe(true);
    expect(getOfficeGenerationConfig("planning")).toMatchObject({
      model: { modelId: "gemini-2.5-flash-lite", provider: "google.generative-ai" },
    });
    expect(getOfficeGenerationConfig("planning").providerOptions).toBeUndefined();
  });

  it("keeps an explicit role policy when a direct Google key also exists", () => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key");
    vi.stubEnv("OFFICE_PLANNING_MODEL", "anthropic/claude-opus-5");
    vi.stubEnv("OFFICE_PLANNING_MODEL_FALLBACKS", "google/gemini-3.1-pro, openai/gpt-5.6-sol");

    expect(isDirectGoogleModelConfigured()).toBe(true);
    expect(getOfficeGenerationConfig("planning")).toMatchObject({
      model: { modelId: "anthropic/claude-opus-5", provider: "gateway" },
      providerOptions: {
        gateway: {
          models: ["google/gemini-3.1-pro", "openai/gpt-5.6-sol"],
          tags: ["feature:lynq-office", "role:planning"],
        },
      },
    });
  });
});
