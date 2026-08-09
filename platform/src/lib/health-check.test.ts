import { describe, it, expect, vi, beforeEach } from "vitest";

const loadEnvMock = vi.fn();
const createDbClientMock = vi.fn();

vi.mock("./env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./env")>();
  return {
    ...actual,
    loadEnv: (...args: unknown[]) => loadEnvMock(...args),
  };
});

vi.mock("@/db/client", () => ({
  createDbClient: (...args: unknown[]) => createDbClientMock(...args),
}));

import { checkHealth } from "./health-check";
import { EnvValidationError } from "./env";

const VALID_ENV = {
  DATABASE_URL: "postgres://user:pass@host/db",
  DATABASE_URL_UNPOOLED: "postgres://user:pass@host-direct/db",
};

describe("checkHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the approved minimal shape when the database responds", async () => {
    loadEnvMock.mockReturnValue(VALID_ENV);
    createDbClientMock.mockReturnValue({
      execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
    });

    const result = await checkHealth();

    expect(result).toEqual({ status: "ok", database: "connected" });
  });

  it("returns a generic non-ok response when the database is unreachable", async () => {
    loadEnvMock.mockReturnValue(VALID_ENV);
    createDbClientMock.mockReturnValue({
      execute: vi.fn().mockRejectedValue(new Error("connection refused")),
    });

    const result = await checkHealth();

    expect(result).toEqual({ status: "error", database: "unreachable" });
  });

  it("never leaks sensitive details, even when the underlying error contains them", async () => {
    loadEnvMock.mockReturnValue(VALID_ENV);
    const sensitiveMessage =
      "connection to postgres://realuser:realpassword@ep-real-host.neon.tech/realdb " +
      "failed: password authentication failed for user \"realuser\"";
    createDbClientMock.mockReturnValue({
      execute: vi.fn().mockRejectedValue(new Error(sensitiveMessage)),
    });

    const result = await checkHealth();
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("realuser");
    expect(serialized).not.toContain("realpassword");
    expect(serialized).not.toContain("neon.tech");
    expect(serialized).not.toContain("postgres://");
    expect(serialized).not.toContain("Error");
  });

  it("fails clearly with a configuration error when required environment variables are missing", async () => {
    loadEnvMock.mockImplementation(() => {
      throw new EnvValidationError(["DATABASE_URL", "DATABASE_URL_UNPOOLED"]);
    });

    const result = await checkHealth();

    expect(result).toEqual({
      status: "error",
      database: "unknown",
      reason: "configuration",
    });
    // createDbClient must never be reached if env validation already failed.
    expect(createDbClientMock).not.toHaveBeenCalled();
  });
});
