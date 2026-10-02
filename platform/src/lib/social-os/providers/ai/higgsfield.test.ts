import { describe, it, expect } from "vitest";
import { createHiggsfieldVideoProvider, DEFAULT_HIGGSFIELD_IMAGE_TO_VIDEO_MODEL, DEFAULT_HIGGSFIELD_VIDEO_MODEL, HIGGSFIELD_API_BASE, mapHiggsfieldStatus } from "./higgsfield";
import { SocialProviderNotConfiguredError, SocialProviderNotSupportedError } from "../../errors";
import { makeFakeFetch } from "./test-fetch";

const env = { HIGGSFIELD_API_KEY: "kid", HIGGSFIELD_API_SECRET: "ksecret" };

describe("Higgsfield video provider", () => {
  it("submit request shape: model path, Key auth, idempotency key", async () => {
    const { fetchImpl, calls } = makeFakeFetch([{ match: (u) => u === `${HIGGSFIELD_API_BASE}/${DEFAULT_HIGGSFIELD_VIDEO_MODEL}`, respond: () => ({ json: { request_id: "req-1", status_url: "https://api.higgsfield.ai/requests/req-1/status" } }) }]);
    const r = await createHiggsfieldVideoProvider(env, { fetchImpl }).startVideo({ prompt: "a reel", aspectRatio: "9:16", durationSeconds: 5, idempotencyKey: "gen-1" });
    expect(r).toEqual({ taskId: "req-1", model: DEFAULT_HIGGSFIELD_VIDEO_MODEL });
    expect(DEFAULT_HIGGSFIELD_VIDEO_MODEL).toBe("bytedance/seedance-2.5/text-to-video");
    expect(calls[0].headers.authorization).toBe("Key kid:ksecret");
    expect(calls[0].headers["idempotency-key"]).toBe("gen-1");
    expect(calls[0].body).toEqual({ prompt: "a reel", aspect_ratio: "9:16", duration: 5, resolution: "1080p" });
  });

  it("image conditioning needs an explicit public URL", async () => {
    const { fetchImpl, calls } = makeFakeFetch([{ match: () => true, respond: () => ({ json: { request_id: "r" } }) }]);
    const p = createHiggsfieldVideoProvider(env, { fetchImpl });
    const req = { prompt: "p", aspectRatio: "1:1" as const, durationSeconds: 5 as const, promptImage: { bytes: Uint8Array.from([1]), contentType: "image/jpeg" as const } };
    await expect(p.startVideo(req)).rejects.toBeInstanceOf(SocialProviderNotSupportedError);
    expect(calls).toHaveLength(0);
    await (p.startVideo as (r: typeof req, o: { imageUrl: string; model: string }) => Promise<unknown>)(req, { imageUrl: "https://x/i.jpg", model: "custom/model" });
    expect(calls[0].url).toBe(`${HIGGSFIELD_API_BASE}/custom/model`);
    expect((calls[0].body as Record<string, unknown>).image_url).toBe("https://x/i.jpg");
    // Without an explicit model, an image-conditioned request goes to the image-to-video model and omits aspect_ratio (the source image sets it).
    await (p.startVideo as (r: typeof req, o: { imageUrl: string }) => Promise<unknown>)(req, { imageUrl: "https://x/i.jpg" });
    expect(calls[1].url).toBe(`${HIGGSFIELD_API_BASE}/${DEFAULT_HIGGSFIELD_IMAGE_TO_VIDEO_MODEL}`);
    expect(calls[1].body).toEqual({ prompt: "p", duration: 5, resolution: "1080p", image_url: "https://x/i.jpg" });
  });

  it("status mapping and polling URL", async () => {
    expect(mapHiggsfieldStatus({ status: "queued" }).status).toBe("pending");
    expect(mapHiggsfieldStatus({ status: "in_progress" }).status).toBe("running");
    expect(mapHiggsfieldStatus({ status: "completed", video: { url: "https://v" } })).toEqual({ status: "succeeded", outputUrl: "https://v" });
    expect(mapHiggsfieldStatus({ status: "failed" }).status).toBe("failed");
    expect(mapHiggsfieldStatus({ status: "nsfw" })).toMatchObject({ status: "failed", failureCode: "nsfw" });
    expect(mapHiggsfieldStatus({ status: "canceled" }).status).toBe("cancelled");
    const { fetchImpl, calls } = makeFakeFetch([
      { match: (u) => u === `${HIGGSFIELD_API_BASE}/requests/req-9/status`, respond: () => ({ json: { status: "in_progress" } }) },
      { match: (u) => u === `${HIGGSFIELD_API_BASE}/requests/req-9/cancel`, respond: () => ({ status: 202, text: "" }) },
    ]);
    const p = createHiggsfieldVideoProvider(env, { fetchImpl });
    expect((await p.pollVideo("req-9")).status).toBe("running");
    await p.cancelVideo!("req-9");
    expect(calls[1].init?.method).toBe("POST");
    expect(p.estimatedCostPerSecondUsd()).toBeNull();
  });

  it("missing configuration lists both keys", async () => {
    const p = createHiggsfieldVideoProvider({ HIGGSFIELD_API_KEY: "x" });
    expect(p.missingConfiguration()).toEqual(["HIGGSFIELD_API_SECRET"]);
    expect(createHiggsfieldVideoProvider({}).missingConfiguration()).toEqual(["HIGGSFIELD_API_KEY", "HIGGSFIELD_API_SECRET"]);
    await expect(p.pollVideo("r")).rejects.toBeInstanceOf(SocialProviderNotConfiguredError);
  });
});
