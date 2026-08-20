import { describe, it, expect } from "vitest";
import { requireVowReaderDatabaseUrl, type Env } from "./env";

function fakeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DATABASE_URL: "postgres://normal-role@ep-fake.pooler.neon.tech/db",
    DATABASE_URL_UNPOOLED: "postgres://normal-role@ep-fake.neon.tech/db",
    ...overrides,
  };
}

describe("requireVowReaderDatabaseUrl", () => {
  it("throws when DATABASE_URL_VOW_READER is not set", () => {
    expect(() => requireVowReaderDatabaseUrl(fakeEnv())).toThrow(/not configured/);
  });

  it("throws when DATABASE_URL_VOW_READER is identical to DATABASE_URL — the silent-misconfiguration case", () => {
    const url = "postgres://normal-role@ep-fake.pooler.neon.tech/db";
    expect(() => requireVowReaderDatabaseUrl(fakeEnv({ DATABASE_URL: url, DATABASE_URL_VOW_READER: url }))).toThrow(
      /identical to DATABASE_URL/
    );
  });

  it("returns the value when it is set and distinct from DATABASE_URL", () => {
    const env = fakeEnv({ DATABASE_URL_VOW_READER: "postgres://vow_reader@ep-fake.pooler.neon.tech/db" });
    expect(requireVowReaderDatabaseUrl(env)).toBe("postgres://vow_reader@ep-fake.pooler.neon.tech/db");
  });
});
