import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Vapi webhook", () => {
  it("rejects a request without the configured bearer secret", async () => {
    vi.stubEnv("VAPI_WEBHOOK_SECRET", "expected-secret");
    const response = await POST(new Request("https://app.lynq.build/api/integrations/vapi/webhook", { method: "POST", body: "{}" }));
    expect(response.status).toBe(401);
  });

  it("accepts and safely logs a call status event", async () => {
    vi.stubEnv("VAPI_WEBHOOK_SECRET", "expected-secret");
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await POST(new Request("https://app.lynq.build/api/integrations/vapi/webhook", {
      method: "POST",
      headers: { authorization: "Bearer expected-secret", "content-type": "application/json" },
      body: JSON.stringify({ message: { type: "status-update", status: "in-progress", call: { id: "call-123" } } }),
    }));
    expect(response.status).toBe(200);
    expect(log).toHaveBeenCalledWith("[jarvis-voice]", expect.stringContaining("call-123"));
  });

  it("rejects malformed JSON", async () => {
    vi.stubEnv("VAPI_WEBHOOK_SECRET", "expected-secret");
    const response = await POST(new Request("https://app.lynq.build/api/integrations/vapi/webhook", {
      method: "POST",
      headers: { authorization: "Bearer expected-secret" },
      body: "not-json",
    }));
    expect(response.status).toBe(400);
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
