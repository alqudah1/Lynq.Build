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
});
