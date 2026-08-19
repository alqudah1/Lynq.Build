import { describe, it, expect, vi, beforeEach } from "vitest";
import { UnauthenticatedError, BonaFideConsumerRequiredError } from "@/lib/authz/errors";

/**
 * Application-layer proof for the VOW gate. This test does NOT require a
 * database — it proves getVowData()'s own orchestration: that it checks
 * requireBonaFideConsumer BEFORE ever touching the vow_reader credential
 * or querying listings_vow, and that a failed check means the vow-reader
 * path is never reached at all (not reached-and-then-filtered — never
 * reached).
 *
 * This is deliberately NOT the same claim as "an unauthenticated database
 * connection cannot read listings_vow" — that is a database-level (RLS)
 * guarantee, proven separately by vow-gate.integration.test.ts against a
 * real Postgres instance. See byoot/README.md for why that test can't run
 * yet, and why that's a real gap this test does not paper over.
 */

const requireBonaFideConsumerMock = vi.fn();
const createVowReaderDbClientMock = vi.fn();
const recordAuditEventMock = vi.fn().mockResolvedValue(undefined);
const loadEnvMock = vi.fn().mockReturnValue({ DATABASE_URL: "postgres://normal" });

vi.mock("@/lib/authz/helpers", () => ({
  requireBonaFideConsumer: (...args: unknown[]) => requireBonaFideConsumerMock(...args),
}));
vi.mock("@/db/client", () => ({
  createVowReaderDbClient: (...args: unknown[]) => createVowReaderDbClientMock(...args),
}));
vi.mock("@/lib/audit", () => ({
  recordAuditEvent: (...args: unknown[]) => recordAuditEventMock(...args),
}));
vi.mock("@/lib/env", () => ({
  loadEnv: (...args: unknown[]) => loadEnvMock(...args),
}));

const { getVowData } = await import("./vow-gate");

const fakeNormalDb = { __kind: "normal-db" } as never;

describe("getVowData — the VOW gate", () => {
  beforeEach(() => {
    requireBonaFideConsumerMock.mockReset();
    createVowReaderDbClientMock.mockReset();
    recordAuditEventMock.mockReset().mockResolvedValue(undefined);
  });

  it("never constructs a vow-reader client when there is no session token", async () => {
    requireBonaFideConsumerMock.mockRejectedValue(new UnauthenticatedError());

    await expect(getVowData(fakeNormalDb, null, "listing-1")).rejects.toBeInstanceOf(UnauthenticatedError);

    expect(createVowReaderDbClientMock).not.toHaveBeenCalled();
  });

  it("never constructs a vow-reader client for an authenticated user who has not acknowledged bona fide consumer status", async () => {
    requireBonaFideConsumerMock.mockRejectedValue(new BonaFideConsumerRequiredError());

    await expect(getVowData(fakeNormalDb, "some-valid-looking-token", "listing-1")).rejects.toBeInstanceOf(
      BonaFideConsumerRequiredError
    );

    expect(createVowReaderDbClientMock).not.toHaveBeenCalled();
  });

  it("records a vow_access_denied audit event on every denial path, using the normal db client, not the vow-reader client", async () => {
    requireBonaFideConsumerMock.mockRejectedValue(new BonaFideConsumerRequiredError());

    await expect(getVowData(fakeNormalDb, "token", "listing-42")).rejects.toThrow();

    expect(recordAuditEventMock).toHaveBeenCalledTimes(1);
    const [dbArg, eventArg] = recordAuditEventMock.mock.calls[0];
    expect(dbArg).toBe(fakeNormalDb);
    expect(eventArg).toMatchObject({ eventType: "vow_access_denied", targetId: "listing-42" });
  });

  it("an audit-write failure during a denial never masks the original authorization error", async () => {
    requireBonaFideConsumerMock.mockRejectedValue(new BonaFideConsumerRequiredError());
    recordAuditEventMock.mockRejectedValue(new Error("audit table unavailable"));

    await expect(getVowData(fakeNormalDb, "token", "listing-1")).rejects.toBeInstanceOf(BonaFideConsumerRequiredError);
  });

  it("only constructs the vow-reader client, and only queries it, once the bona-fide-consumer check has actually passed", async () => {
    requireBonaFideConsumerMock.mockResolvedValue({
      userId: "user-1",
      sessionId: "session-1",
      bonaFideConsumerAckAt: new Date(),
    });

    const fakeRow = {
      listingId: "listing-1",
      soldPrice: 850_000,
      soldDate: new Date("2026-03-01"),
      priceHistory: [{ date: "2026-01-01", price: 899_000, event: "listed" }],
      domHistorical: 45,
    };
    const whereMock = vi.fn().mockResolvedValue([fakeRow]);
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });
    const selectMock = vi.fn().mockReturnValue({ from: fromMock });
    createVowReaderDbClientMock.mockReturnValue({ select: selectMock });

    const result = await getVowData(fakeNormalDb, "token", "listing-1");

    expect(createVowReaderDbClientMock).toHaveBeenCalledTimes(1);
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual(fakeRow);
  });
});
