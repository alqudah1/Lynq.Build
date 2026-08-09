import { describe, it, expect, vi, beforeEach } from "vitest";

const checkHealthMock = vi.fn();

vi.mock("@/lib/health-check", () => ({
  checkHealth: (...args: unknown[]) => checkHealthMock(...args),
}));

import { GET } from "./route";

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with the approved minimal shape when healthy", async () => {
    checkHealthMock.mockResolvedValue({ status: "ok", database: "connected" });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ status: "ok", database: "connected" });
  });

  it("returns 503 (generic, non-200) when the database is unreachable", async () => {
    checkHealthMock.mockResolvedValue({ status: "error", database: "unreachable" });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toEqual({ status: "error", database: "unreachable" });
  });

  it("returns 500 (generic, non-200) when configuration is invalid", async () => {
    checkHealthMock.mockResolvedValue({
      status: "error",
      database: "unknown",
      reason: "configuration",
    });

    const res = await GET();

    expect(res.status).toBe(500);
  });

  it("never includes fields beyond the approved minimal shape", async () => {
    checkHealthMock.mockResolvedValue({ status: "ok", database: "connected" });

    const res = await GET();
    const body = await res.json();

    expect(Object.keys(body).sort()).toEqual(["database", "status"]);
  });
});
