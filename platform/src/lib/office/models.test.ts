import { afterEach, describe, expect, it, vi } from "vitest";
import { getOfficeGenerationConfig, getOfficeModel } from "./models";

describe("Office model routing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses a cross-provider fallback chain for the default model", () => {
    expect(getOfficeGenerationConfig("planning")).toEqual({
      model: "openai/gpt-5.4-mini",
      providerOptions: {
        gateway: {
          models: ["openai/gpt-5-nano", "alibaba/qwen3.5-flash", "google/gemini-3-flash"],
          tags: ["feature:lynq-office", "role:planning"],
        },
      },
    });
  });

  it("supports role-specific primary and fallback overrides without duplicating the primary", () => {
    vi.stubEnv("OFFICE_REVIEW_MODEL", "google/gemini-3-flash");
    vi.stubEnv("OFFICE_REVIEW_MODEL_FALLBACKS", "google/gemini-3-flash, openai/gpt-5-nano, alibaba/qwen3.5-flash");

    expect(getOfficeGenerationConfig("review")).toMatchObject({
      model: "google/gemini-3-flash",
      providerOptions: { gateway: { models: ["openai/gpt-5-nano", "alibaba/qwen3.5-flash"] } },
    });
  });

  it("rejects malformed model overrides", () => {
    vi.stubEnv("OFFICE_ENGINEERING_MODEL", "not-a-model");
    expect(() => getOfficeModel("engineering")).toThrow("OFFICE_ENGINEERING_MODEL must use provider/model format");
  });
});
