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
});
