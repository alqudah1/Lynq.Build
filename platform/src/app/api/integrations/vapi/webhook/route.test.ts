import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Webhook authentication, payload guards, and the phone-control feature flag.
 *
 * Every property asserted here is decided BEFORE any database work, so none of
 * it needs a connection. `createDbClient` is stubbed to THROW, so any attempt
 * to reach the database in a case that must not is a loud failure rather than
 * a silent network call.
 *
 * The original three cases (bearer rejection, safe status logging, malformed
 * JSON) are preserved unchanged in substance — the existing outbound founder
 * notification lane must keep behaving exactly as it did.
 */

const createDbClient = vi.fn(() => {
  throw new Error("the database must not be reached in this case");
});
vi.mock("@/db/client", () => ({ createDbClient }));

const { POST } = await import("./route");

const SECRET = "expected-secret-long-enough-to-be-real-0123456789";

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://app.lynq.build/api/integrations/vapi/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function authed(body: unknown): Request {
  return post(body, { authorization: `Bearer ${SECRET}` });
}

beforeEach(() => {
  vi.stubEnv("VAPI_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("JARVIS_PHONE_COMMANDS_ENABLED", "false");
  createDbClient.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Vapi webhook — authentication", () => {
  it("rejects a request without the configured bearer secret", async () => {
    const response = await POST(post("{}"));
    expect(response.status).toBe(401);
    expect(createDbClient).not.toHaveBeenCalled();
  });

  it("rejects a forged bearer token", async () => {
    const response = await POST(post({ message: { type: "assistant-request" } }, { authorization: "Bearer not-the-secret" }));
    expect(response.status).toBe(401);
    expect(createDbClient).not.toHaveBeenCalled();
  });

  it("rejects a token that is a prefix of the real one", async () => {
    const response = await POST(post({ message: { type: "assistant-request" } }, { authorization: `Bearer ${SECRET.slice(0, -1)}` }));
    expect(response.status).toBe(401);
  });

  it("rejects every request when no secret is configured, rather than accepting unauthenticated events", async () => {
    vi.stubEnv("VAPI_WEBHOOK_SECRET", "");
    expect((await POST(authed({ message: { type: "status-update" } }))).status).toBe(401);
  });
});

describe("Vapi webhook — payload guards", () => {
  it("rejects malformed JSON", async () => {
    const response = await POST(post("not-json", { authorization: `Bearer ${SECRET}` }));
    expect(response.status).toBe(400);
  });

  it("rejects an oversized declared content length before reading the body", async () => {
    const response = await POST(post({ message: {} }, { authorization: `Bearer ${SECRET}`, "content-length": "2000000" }));
    expect(response.status).toBe(413);
  });
});

describe("Vapi webhook — the existing founder notification lane", () => {
  it("accepts and safely logs a call status event", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const response = await POST(authed({ message: { type: "status-update", status: "in-progress", call: { id: "call-123" } } }));

    expect(response.status).toBe(200);
    expect(log).toHaveBeenCalledWith("[jarvis-voice]", expect.stringContaining("call-123"));
  });

  it("logs no phone number even when the provider sends one", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await POST(authed({ message: { type: "status-update", status: "in-progress", call: { id: "call-1" }, customer: { number: "+14165551234" } } }));

    expect(String(log.mock.calls.at(-1)?.[1] ?? "")).not.toContain("4165551234");
  });

  it("still logs an end-of-call report and a hang", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await POST(authed({ message: { type: "end-of-call-report", endedReason: "assistant-ended-call", call: { id: "call-2" } } }));
    expect(String(log.mock.calls.at(-1)?.[1] ?? "")).toContain("end-of-call-report");

    await POST(authed({ message: { type: "hang", call: { id: "call-3" } } }));
    expect(String(log.mock.calls.at(-1)?.[1] ?? "")).toContain("hang");
  });
});

describe("Vapi webhook — phone control is off by default", () => {
  it("acknowledges an inbound assistant request without touching the database", async () => {
    const response = await POST(authed({ message: { type: "assistant-request", call: { id: "call-1" }, customer: { number: "+14165551234" } } }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(createDbClient).not.toHaveBeenCalled();
  });

  it("acknowledges a tool call without acting on it", async () => {
    const response = await POST(
      authed({ message: { type: "tool-calls", call: { id: "call-1" }, toolCalls: [{ id: "tc-1", function: { name: "confirm_command", arguments: { confirmed: true } } }] } })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(createDbClient).not.toHaveBeenCalled();
  });

  it("stays off when the flag is present but not exactly true", async () => {
    vi.stubEnv("JARVIS_PHONE_COMMANDS_ENABLED", "1");

    const response = await POST(authed({ message: { type: "assistant-request", call: { id: "call-1" } } }));

    expect(await response.json()).toEqual({ received: true });
    expect(createDbClient).not.toHaveBeenCalled();
  });

  it("stays off when the flag is on but the rest of the configuration is missing, and names only the variables", async () => {
    vi.stubEnv("JARVIS_PHONE_COMMANDS_ENABLED", "true");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await POST(authed({ message: { type: "assistant-request", call: { id: "call-1" } } }));

    expect(await response.json()).toEqual({ received: true });
    expect(createDbClient).not.toHaveBeenCalled();
    const logged = String(warn.mock.calls.at(-1)?.[1] ?? "");
    expect(logged).toContain("config-incomplete");
    expect(logged).toContain("JARVIS_PHONE_ORGANIZATION_ID");
  });

  it("ignores an event type neither lane handles", async () => {
    const response = await POST(authed({ message: { type: "speech-update", call: { id: "call-1" } } }));
    expect(response.status).toBe(200);
    expect(createDbClient).not.toHaveBeenCalled();
  });
});

describe("Vapi webhook — a transient event-store failure", () => {
  /**
   * Round fourteen. The claim moved inside a try so a database blip on an
   * OUTBOUND notification event would not become a 500 where base returned 200.
   * The first version of that test was "not demonstrably inbound" — but
   * `isInboundCallEvent` falls back to the event KIND when `call.type` is
   * absent, and that fallback covers only assistant requests and tool calls. A
   * transcript or end-of-call event for a real inbound command call, delivered
   * without `call.type`, therefore classified as not-inbound and was
   * acknowledged rather than retried, which loses `finalizeCall` and wedges any
   * open draft. The test is now "demonstrably OUTBOUND".
   */
  function configurePhoneControl() {
    vi.stubEnv("JARVIS_PHONE_COMMANDS_ENABLED", "true");
    vi.stubEnv("JARVIS_PHONE_ORGANIZATION_ID", "11111111-1111-4111-8111-111111111111");
    vi.stubEnv("JARVIS_PHONE_FOUNDER_USER_ID", "22222222-2222-4222-8222-222222222222");
    vi.stubEnv("JARVIS_PHONE_VERIFICATION_SECRET", "a-verification-secret-long-enough-01234567");
    vi.stubEnv("JARVIS_FOUNDER_PHONE_E164", "+14165551234");
  }

  it("acknowledges an outbound notification event rather than asking the provider to retry it", async () => {
    configurePhoneControl();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(
      authed({ message: { type: "end-of-call-report", call: { id: "call-1", type: "outboundPhoneCall" }, endedReason: "assistant-ended-call" } })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
  });

  it("asks the provider to retry an event that demonstrably belongs to an inbound call", async () => {
    configurePhoneControl();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(
      authed({ message: { type: "end-of-call-report", call: { id: "call-1", type: "inboundPhoneCall" }, endedReason: "customer-ended-call" } })
    );

    expect(response.status).toBe(503);
  });

  it("acknowledges an ambiguous event rather than answering 5xx on the shared endpoint", async () => {
    configurePhoneControl();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    // No `call.type`. The tempting rule is "retry unless demonstrably
    // outbound", but the notification lane produces exactly these event types,
    // so a database blip would answer 5xx to a lane this branch does not touch
    // — and sustained 5xx is how a provider decides to disable a webhook. The
    // reason that trade once looked necessary, an inbound call-ended event
    // getting lost and wedging a draft, is handled by `reapAbandonedDraft`
    // instead.
    const response = await POST(authed({ message: { type: "end-of-call-report", call: { id: "call-1" }, endedReason: "customer-ended-call" } }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
  });
});

describe("Vapi webhook — the shared secret must be long enough to be one", () => {
  /**
   * The inbound lane collapses to this one string. It was checked only for
   * being non-empty, in the route and in readiness alike, so a four-character
   * value passed every check the deployment makes — while
   * JARVIS_PHONE_VERIFICATION_SECRET, which protects strictly less, was
   * already held to 32.
   *
   * The floor belongs to the INBOUND lane, not to the door. Enforcing it at
   * the door — the first version of this rule — 401s every request on any
   * deployment whose secret predates it, and that endpoint is shared with the
   * pre-existing outbound founder notifications, which this branch is not
   * supposed to touch at all. The two tests below are the two halves of that:
   * the old lane keeps working, the new lane refuses to start.
   */
  it("keeps the existing notification lane working when the secret predates the length rule", async () => {
    vi.stubEnv("VAPI_WEBHOOK_SECRET", "short");
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const response = await POST(
      post({ message: { type: "status-update", status: "ended", call: { id: "call-9" } } }, { authorization: "Bearer short" })
    );

    expect(response.status).toBe(200);
    expect(log).toHaveBeenCalledWith("[jarvis-voice]", expect.stringContaining("call-9"));
  });

  it("refuses to run the inbound lane on a short secret, and names the variable rather than its value", async () => {
    vi.stubEnv("VAPI_WEBHOOK_SECRET", "short");
    vi.stubEnv("JARVIS_PHONE_COMMANDS_ENABLED", "true");
    vi.stubEnv("JARVIS_PHONE_ORGANIZATION_ID", "11111111-1111-4111-8111-111111111111");
    vi.stubEnv("JARVIS_PHONE_FOUNDER_USER_ID", "22222222-2222-4222-8222-222222222222");
    vi.stubEnv("JARVIS_PHONE_VERIFICATION_SECRET", "a-verification-secret-long-enough-01234567");
    vi.stubEnv("JARVIS_FOUNDER_PHONE_E164", "+14165551234");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await POST(
      post({ message: { type: "assistant-request", call: { id: "call-9" }, customer: { number: "+14165551234" } } }, { authorization: "Bearer short" })
    );

    expect(await response.json()).toEqual({ received: true });
    expect(createDbClient).not.toHaveBeenCalled();
    const logged = String(warn.mock.calls.at(-1)?.[1] ?? "");
    expect(logged).toContain("weak_webhook_secret");
    expect(logged).toContain("VAPI_WEBHOOK_SECRET");
    expect(logged).not.toContain("short");
  });

  it("says nothing about the length rule on a deployment that never asked for phone control", async () => {
    vi.stubEnv("VAPI_WEBHOOK_SECRET", "short");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await POST(post({ message: { type: "status-update", status: "ended", call: { id: "call-9" } } }, { authorization: "Bearer short" }));

    expect(warn).not.toHaveBeenCalled();
  });

  it("records bounded call evidence without logging the founder transcript", async () => {
    vi.stubEnv("VAPI_WEBHOOK_SECRET", "expected-secret");
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await POST(new Request("https://app.lynq.build/api/integrations/vapi/webhook", {
      method: "POST",
      headers: { authorization: "Bearer expected-secret", "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          type: "end-of-call-report",
          call: {
            id: "call-456",
            metadata: {
              source: "lynq-office",
              schemaVersion: 1,
              organizationId: "9d06be88-cf1e-4b0c-8f9b-bb884b78d28f",
              ownerUserId: "7bbb68fe-14b2-4e08-b2c1-8d449d7e0f8e",
              projectId: "ef2b072b-40f3-4866-b05e-3d888d9e88fc",
            },
          },
          artifact: {
            transcript: "User: keep this private",
            messages: [{ role: "user", message: "Please revise the demo" }],
          },
        },
      }),
    }));
    expect(response.status).toBe(200);
    const logged = String(log.mock.calls[0]?.[1]);
    expect(logged).toContain('"officeContextPresent":true');
    expect(logged).toContain('"userTurnCount":1');
    expect(logged).not.toContain("keep this private");
    expect(logged).not.toContain("Please revise the demo");
  });
});
