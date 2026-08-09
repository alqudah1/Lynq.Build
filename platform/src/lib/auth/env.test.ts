import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadAuthEnv, AuthEnvValidationError } from "./env";

const VALID = {
  GOOGLE_OAUTH_CLIENT_ID: "google-client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "google-client-secret",
  MICROSOFT_OAUTH_CLIENT_ID: "microsoft-client-id",
  MICROSOFT_OAUTH_CLIENT_SECRET: "microsoft-client-secret",
  MICROSOFT_OAUTH_TENANT_ID: "organizations",
  AUTH_SECRET: "a".repeat(32),
  AUTH_BASE_URL: "https://platform.example.com",
};

describe("loadAuthEnv", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("succeeds and returns every value when configuration is present and valid", () => {
    Object.assign(process.env, VALID);

    const env = loadAuthEnv();

    expect(env).toEqual(VALID);
  });

  it("fails clearly, listing every missing key, when configuration is absent", () => {
    for (const key of Object.keys(VALID)) delete process.env[key];

    try {
      loadAuthEnv();
      throw new Error("expected loadAuthEnv to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthEnvValidationError);
      if (err instanceof AuthEnvValidationError) {
        expect(err.missingOrInvalidKeys).toEqual(expect.arrayContaining(Object.keys(VALID)));
      }
    }
  });

  it("rejects an AUTH_SECRET shorter than 32 characters", () => {
    Object.assign(process.env, VALID, { AUTH_SECRET: "too-short" });

    try {
      loadAuthEnv();
      throw new Error("expected loadAuthEnv to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthEnvValidationError);
      if (err instanceof AuthEnvValidationError) {
        expect(err.missingOrInvalidKeys).toEqual(["AUTH_SECRET"]);
      }
    }
  });

  it("rejects an AUTH_BASE_URL that isn't a valid URL", () => {
    Object.assign(process.env, VALID, { AUTH_BASE_URL: "not-a-url" });

    try {
      loadAuthEnv();
      throw new Error("expected loadAuthEnv to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthEnvValidationError);
      if (err instanceof AuthEnvValidationError) {
        expect(err.missingOrInvalidKeys).toEqual(["AUTH_BASE_URL"]);
      }
    }
  });
});
