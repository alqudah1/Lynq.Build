import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEnv, EnvValidationError } from "./env";

describe("loadEnv", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("fails clearly, listing every missing key, when required configuration is absent", () => {
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_URL_UNPOOLED;

    expect(() => loadEnv()).toThrow(EnvValidationError);

    try {
      loadEnv();
      throw new Error("expected loadEnv to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      if (err instanceof EnvValidationError) {
        expect(err.missingOrInvalidKeys).toEqual(
          expect.arrayContaining(["DATABASE_URL", "DATABASE_URL_UNPOOLED"])
        );
      }
    }
  });

  it("fails when only one of the two required variables is present", () => {
    process.env.DATABASE_URL = "postgres://user:pass@host/db";
    delete process.env.DATABASE_URL_UNPOOLED;

    try {
      loadEnv();
      throw new Error("expected loadEnv to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      if (err instanceof EnvValidationError) {
        expect(err.missingOrInvalidKeys).toEqual(["DATABASE_URL_UNPOOLED"]);
      }
    }
  });

  it("succeeds and returns both values when configuration is present", () => {
    process.env.DATABASE_URL = "postgres://user:pass@host/db";
    process.env.DATABASE_URL_UNPOOLED = "postgres://user:pass@host-direct/db";

    const env = loadEnv();

    expect(env.DATABASE_URL).toBe("postgres://user:pass@host/db");
    expect(env.DATABASE_URL_UNPOOLED).toBe("postgres://user:pass@host-direct/db");
  });

  it("treats blank Module 19 provider settings as unset instead of failing every route", () => {
    process.env.DATABASE_URL = "postgres://user:pass@host/db";
    process.env.DATABASE_URL_UNPOOLED = "postgres://user:pass@host/db";
    for (const key of ["META_APP_ID", "META_APP_SECRET", "META_WEBHOOK_VERIFY_TOKEN", "LINKEDIN_CLIENT_ID", "GOOGLE_ADS_LOGIN_CUSTOMER_ID", "ANTHROPIC_API_KEY", "BLOB_READ_WRITE_TOKEN", "SOCIAL_AI_DAILY_BUDGET_USD"]) process.env[key] = "";
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "  ";
    const env = loadEnv();
    expect(env.META_APP_ID).toBeUndefined();
    expect(env.META_WEBHOOK_VERIFY_TOKEN).toBeUndefined();
    expect(env.GOOGLE_ADS_DEVELOPER_TOKEN).toBeUndefined();
    expect(env.SOCIAL_AI_DAILY_BUDGET_USD).toBeUndefined();
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = "123-456-7890";
    expect(loadEnv().GOOGLE_ADS_LOGIN_CUSTOMER_ID).toBe("1234567890");
  });
});
