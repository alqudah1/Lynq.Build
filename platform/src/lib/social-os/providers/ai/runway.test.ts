import { describe, it, expect } from "vitest";
import { createRunwayImageProvider, createRunwayVideoProvider, mapRunwayTask, RUNWAY_API_BASE } from "./runway";
import { SocialGenerationFailedError, SocialProviderNotConfiguredError } from "../../errors";
import { makeFakeFetch } from "./test-fetch";

const env = { RUNWAYML_API_SECRET: "rw-secret" };

describe("Runway video provider", () => {
  it("text_to_video request shape, headers and ratio mapping", async () => {
    const { fetchImpl, calls } = makeFakeFetch([{ match: (u) => u === `${RUNWAY_API_BASE}/text_to_video`, respond: () => ({ json: { id: "task-1" } }) }]);
    const p = createRunwayVideoProvider(env, { fetchImpl });
    const r = await p.startVideo({ prompt: "a sunrise", aspectRatio: "9:16", durationSeconds: 5 });
    expect(r).toEqual({ taskId: "task-1", model: "gen4.5" });
    expect(calls[0].headers.authorization).toBe("Bearer rw-secret");
    expect(calls[0].headers["x-runway-version"]).toBe("2024-11-06");
    expect(calls[0].body).toEqual({ model: "gen4.5", promptText: "a sunrise", ratio: "720:1280", duration: 5 });
  });

  it("image_to_video with a data URI when a prompt image is given; env model override", async () => {
    const { fetchImpl, calls } = makeFakeFetch([{ match: (u) => u.endsWith("/image_to_video"), respond: () => ({ json: { id: "t2" } }) }]);
    await createRunwayVideoProvider({ ...env, RUNWAYML_VIDEO_MODEL: "gen4_turbo" }, { fetchImpl }).startVideo({ prompt: "p", aspectRatio: "16:9", durationSeconds: 10, promptImage: { bytes: Uint8Array.from([1, 2, 3]), contentType: "image/png" } });
    expect(calls[0].body).toMatchObject({ model: "gen4_turbo", ratio: "1280:720", duration: 10, promptImage: "data:image/png;base64,AQID" });
  });

  it("maps task statuses", () => {
    expect(mapRunwayTask({ status: "PENDING" }).status).toBe("pending");
    expect(mapRunwayTask({ status: "THROTTLED" }).status).toBe("pending");
    expect(mapRunwayTask({ status: "RUNNING" }).status).toBe("running");
    expect(mapRunwayTask({ status: "SUCCEEDED", output: ["https://cdn/x.mp4"] })).toEqual({ status: "succeeded", outputUrl: "https://cdn/x.mp4" });
    expect(mapRunwayTask({ status: "FAILED", failure: "bad", failureCode: "SAFETY" })).toEqual({ status: "failed", failureCode: "SAFETY", failureMessage: "bad" });
    expect(mapRunwayTask({ status: "CANCELLED" }).status).toBe("cancelled");
  });

  it("poll, download (size-capped), cancel; cost per second", async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      { match: (u, i) => u === `${RUNWAY_API_BASE}/tasks/t1` && (i?.method ?? "GET") === "GET", respond: () => ({ json: { id: "t1", status: "SUCCEEDED", output: ["https://cdn.example/v.mp4"] } }) },
      { match: (u, i) => u === `${RUNWAY_API_BASE}/tasks/t1` && i?.method === "DELETE", respond: () => ({ status: 204, text: "" }) },
      { match: (u) => u === "https://cdn.example/v.mp4", respond: () => ({ bytes: Uint8Array.from([0, 0, 0, 1]), headers: { "content-type": "video/mp4" } }) },
      { match: (u) => u === "https://cdn.example/big.mp4", respond: () => ({ bytes: new Uint8Array(20), headers: { "content-type": "video/mp4" } }) },
    ]);
    const p = createRunwayVideoProvider(env, { fetchImpl });
    expect(await p.pollVideo("t1")).toEqual({ status: "succeeded", outputUrl: "https://cdn.example/v.mp4" });
    const d = await p.downloadVideo("https://cdn.example/v.mp4");
    expect(d.contentType).toBe("video/mp4");
    expect(d.bytes.byteLength).toBe(4);
    await expect(p.downloadVideo("https://cdn.example/big.mp4", { maxBytes: 10 })).rejects.toBeInstanceOf(SocialGenerationFailedError);
    await p.cancelVideo!("t1");
    expect(calls.some((c) => c.init?.method === "DELETE")).toBe(true);
    expect(p.estimatedCostPerSecondUsd("gen4.5")).toBe(0.12);
    expect(p.estimatedCostPerSecondUsd("gen4_turbo")).toBe(0.05);
    expect(p.estimatedCostPerSecondUsd("other")).toBeNull();
  });

  it("not configured", async () => {
    const p = createRunwayVideoProvider({});
    expect(p.missingConfiguration()).toEqual(["RUNWAYML_API_SECRET"]);
    await expect(p.startVideo({ prompt: "p", aspectRatio: "1:1", durationSeconds: 5 })).rejects.toBeInstanceOf(SocialProviderNotConfiguredError);
  });
});

describe("Runway image provider", () => {
  it("text_to_image → poll → download", async () => {
    let polls = 0;
    const { fetchImpl, calls } = makeFakeFetch([
      { match: (u) => u.endsWith("/text_to_image"), respond: () => ({ json: { id: "img-1" } }) },
      { match: (u) => u.endsWith("/tasks/img-1"), respond: () => (++polls < 2 ? { json: { id: "img-1", status: "RUNNING" } } : { json: { id: "img-1", status: "SUCCEEDED", output: ["https://cdn/i.png"] } }) },
      { match: (u) => u === "https://cdn/i.png", respond: () => ({ bytes: Uint8Array.from([137, 80, 78, 71]), headers: { "content-type": "image/png" } }) },
    ]);
    const r = await createRunwayImageProvider(env, { fetchImpl, sleep: async () => undefined }).generateImage({ prompt: "logo-free hero", aspectRatio: "4:5" });
    expect(calls[0].body).toEqual({ model: "gen4_image", promptText: "logo-free hero", ratio: "1080:1350" });
    expect(r.contentType).toBe("image/png");
    expect(r.usage).toEqual({ units: 1, costUsd: 0.08, estimated: true });
    expect(polls).toBe(2);
  });

  it("failed task → non-retryable", async () => {
    const { fetchImpl } = makeFakeFetch([
      { match: (u) => u.endsWith("/text_to_image"), respond: () => ({ json: { id: "x" } }) },
      { match: (u) => u.endsWith("/tasks/x"), respond: () => ({ json: { id: "x", status: "FAILED", failureCode: "SAFETY" } }) },
    ]);
    const e = await createRunwayImageProvider(env, { fetchImpl, sleep: async () => undefined }).generateImage({ prompt: "p", aspectRatio: "1:1" }).catch((x) => x);
    expect(e).toBeInstanceOf(SocialGenerationFailedError);
    expect(e.retryable).toBe(false);
  });
});
