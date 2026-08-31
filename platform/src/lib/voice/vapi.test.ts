import { describe, expect, it, vi } from "vitest";
import { VapiJarvisVoiceTransport } from "./vapi";

describe("VapiJarvisVoiceTransport", () => {
  it("places a founder-only call with project context as dynamic variables", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: "call_123" }), { status: 201 }));
    const transport = new VapiJarvisVoiceTransport(
      { apiKey: "secret", assistantId: "assistant_1", phoneNumberId: "phone_1", founderPhoneNumber: "+14165551234" },
      fetchMock,
    );

    await transport.notifyFounder({
      kind: "approval_needed",
      founderName: "Mustafa",
      projectName: "Website launch",
      summary: "The preview is ready for approval.",
      actionUrl: "https://app.lynq.build/app/lynq/my-work",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.vapi.ai/call");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer secret" });
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      assistantId: "assistant_1",
      phoneNumberId: "phone_1",
      customer: { number: "+14165551234" },
      assistantOverrides: { variableValues: { founder_name: "Mustafa", project_name: "Website launch" } },
    });
  });

  it("fails closed when Vapi rejects the request", async () => {
    const transport = new VapiJarvisVoiceTransport(
      { apiKey: "secret", assistantId: "assistant_1", phoneNumberId: "phone_1", founderPhoneNumber: "+14165551234" },
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 })),
    );
    await expect(
      transport.notifyFounder({ kind: "execution_stopped", founderName: "Mustafa", projectName: "Demo", summary: "Stopped", actionUrl: "https://app.lynq.build" }),
    ).rejects.toThrow("status 401");
  });
});
