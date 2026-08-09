import { describe, it, expect, vi, beforeEach } from "vitest";

const getSessionCookieMock = vi.fn();
const clearSessionCookieMock = vi.fn();
const validateSessionTokenMock = vi.fn();
const revokeSessionMock = vi.fn();
const recordAuditEventMock = vi.fn();

vi.mock("@/lib/env", () => ({ loadEnv: vi.fn(() => ({})) }));
vi.mock("@/db/client", () => ({ createDbClient: vi.fn(() => ({})) }));
vi.mock("@/lib/auth/cookies", () => ({
  getSessionCookie: (...a: unknown[]) => getSessionCookieMock(...a),
  clearSessionCookie: (...a: unknown[]) => clearSessionCookieMock(...a),
}));
vi.mock("@/lib/auth/session", () => ({
  validateSessionToken: (...a: unknown[]) => validateSessionTokenMock(...a),
  revokeSession: (...a: unknown[]) => revokeSessionMock(...a),
}));
vi.mock("@/lib/audit", () => ({
  recordAuditEvent: (...a: unknown[]) => recordAuditEventMock(...a),
}));

import { POST } from "./route";

function makeRequest() {
  return new Request("https://platform.example.com/api/auth/logout", { method: "POST" });
}

describe("POST /api/auth/logout", () => {
  beforeEach(() => vi.clearAllMocks());

  it("revokes the session, audits logout, and clears the cookie when a valid session exists", async () => {
    getSessionCookieMock.mockResolvedValue("valid-token");
    validateSessionTokenMock.mockResolvedValue({ id: "session-1", userId: "user-1" });

    const res = await POST(makeRequest());

    expect(res.status).toBe(204);
    expect(revokeSessionMock).toHaveBeenCalledWith(expect.anything(), "session-1");
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "logout", actorUserId: "user-1", targetId: "session-1" })
    );
    expect(clearSessionCookieMock).toHaveBeenCalledTimes(1);
  });

  it("still returns 204 and clears the cookie when there is no valid session, without revoking or auditing anything", async () => {
    getSessionCookieMock.mockResolvedValue(null);

    const res = await POST(makeRequest());

    expect(res.status).toBe(204);
    expect(revokeSessionMock).not.toHaveBeenCalled();
    expect(recordAuditEventMock).not.toHaveBeenCalled();
    expect(clearSessionCookieMock).toHaveBeenCalledTimes(1);
  });
});
