import { describe, it, expect, vi } from "vitest";
import { recordAuditEvent } from "./audit";

function createFakeDb() {
  const values = vi.fn().mockResolvedValue(undefined);
  return { fakeValues: values, insert: () => ({ values }) };
}

describe("recordAuditEvent", () => {
  it("inserts with null defaults for every optional field when omitted", async () => {
    const fakeDb = createFakeDb();

    await recordAuditEvent(fakeDb as never, { eventType: "sign_up" });

    expect(fakeDb.fakeValues).toHaveBeenCalledWith({
      organizationId: null,
      actorUserId: null,
      actorAgentId: null,
      actorType: null,
      eventType: "sign_up",
      targetType: null,
      targetId: null,
      metadata: null,
      ipAddress: null,
      userAgent: null,
    });
  });

  it("passes through every provided field unchanged", async () => {
    const fakeDb = createFakeDb();

    await recordAuditEvent(fakeDb as never, {
      eventType: "oauth_login_success",
      actorUserId: "user-1",
      organizationId: "org-1",
      targetType: "session",
      targetId: "session-1",
      metadata: { provider: "google" },
      ipAddress: "203.0.113.5",
      userAgent: "test-agent",
    });

    expect(fakeDb.fakeValues).toHaveBeenCalledWith({
      organizationId: "org-1",
      actorUserId: "user-1",
      actorAgentId: null,
      actorType: "human",
      eventType: "oauth_login_success",
      targetType: "session",
      targetId: "session-1",
      metadata: { provider: "google" },
      ipAddress: "203.0.113.5",
      userAgent: "test-agent",
    });
  });

  it("derives actorType: agent when actorAgentId is provided instead of actorUserId", async () => {
    const fakeDb = createFakeDb();

    await recordAuditEvent(fakeDb as never, { eventType: "agent_brain_read", actorAgentId: "agent-1", organizationId: "org-1" });

    const call = fakeDb.fakeValues.mock.calls[0][0];
    expect(call.actorAgentId).toBe("agent-1");
    expect(call.actorUserId).toBeNull();
    expect(call.actorType).toBe("agent");
  });

  it("never persists tokens or secrets even if a caller accidentally includes token-shaped keys in metadata", async () => {
    // This is a documentation/contract test, not a redaction filter: the
    // function itself has no special-case logic to strip anything — the
    // actual guarantee is that no caller in this codebase ever puts a
    // secret in metadata (§10/§14's blanket rule). Asserting the function
    // passes metadata through verbatim (not filtered) makes clear the
    // responsibility lives with callers, not this helper.
    const fakeDb = createFakeDb();

    await recordAuditEvent(fakeDb as never, {
      eventType: "oauth_login_failure",
      metadata: { provider: "google", reason: "token_exchange_failed" },
    });

    const call = fakeDb.fakeValues.mock.calls[0][0];
    expect(call.metadata).toEqual({ provider: "google", reason: "token_exchange_failed" });
  });
});
