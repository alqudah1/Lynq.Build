import { describe, expect, it, vi } from "vitest";
import { generateRunwayMotionClip } from "./runway";

describe("Runway premium motion provider", () => {
  it("creates, polls and downloads a generated clip without exposing the credential", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "task-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "task-1", status: "RUNNING" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "task-1", status: "SUCCEEDED", output: ["https://cdn.example.test/video.mp4"] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), { status: 200, headers: { "content-type": "video/mp4" } }));

    const result = await generateRunwayMotionClip({ promptImage: new Uint8Array([137, 80, 78, 71]), imageContentType: "image/png", promptText: "Subtle premium motion" }, {
      fetch: request,
      sleep: async () => undefined,
      apiSecret: "runway-secret-for-test",
      pollIntervalMs: 0,
      timeoutMs: 1_000,
    });

    expect(result).toMatchObject({ contentType: "video/mp4", model: "runway/gen4.5", taskId: "task-1" });
    expect(result.bytes).toHaveLength(8);
    expect(request).toHaveBeenCalledTimes(4);
    const createOptions = request.mock.calls[0]?.[1];
    expect((createOptions?.headers as Record<string, string>).Authorization).toBe("Bearer runway-secret-for-test");
    expect(JSON.stringify(createOptions?.body)).not.toContain("runway-secret-for-test");
  });

  it("fails closed when no provider credential exists", async () => {
    const previous = process.env.RUNWAYML_API_SECRET;
    delete process.env.RUNWAYML_API_SECRET;
    try {
      await expect(generateRunwayMotionClip({ promptImage: new Uint8Array([1]), imageContentType: "image/png", promptText: "motion" })).rejects.toThrow(/not connected/i);
    } finally {
      if (previous) process.env.RUNWAYML_API_SECRET = previous;
    }
  });
});
