import { describe, expect, it, vi } from "vitest";
import { pickTtsModel, speechRequestBody, supportsInstructions, synthesizeSpeech } from "./openai-speech";

describe("pickTtsModel", () => {
  it("prefers the steerable mini-tts family, undated alias first", () => {
    expect(pickTtsModel(["tts-1", "gpt-4o-mini-tts-2025-03-20", "gpt-4o-mini-tts", "gpt-4o"])).toBe("gpt-4o-mini-tts");
  });
  it("falls back to older models, then the default", () => {
    expect(pickTtsModel(["tts-1", "tts-1-hd"])).toBe("tts-1-hd");
    expect(pickTtsModel([])).toBe("gpt-4o-mini-tts");
  });
});

describe("speechRequestBody", () => {
  it("adds accent instructions only for steerable models", () => {
    const steer = speechRequestBody({ model: "gpt-4o-mini-tts", text: "مرحبا", voice: "onyx", style: "ar-levant" });
    expect(steer.instructions).toMatch(/Levantine/);
    expect(steer.response_format).toBe("mp3");
    expect(speechRequestBody({ model: "tts-1", text: "hi", voice: "nova", style: "en" }).instructions).toBeUndefined();
    expect(supportsInstructions("tts-1-hd")).toBe(false);
  });
  it("clamps speed and leaves 1 out", () => {
    expect(speechRequestBody({ model: "tts-1", text: "hi", voice: "nova", style: "en", speed: 3 }).speed).toBe(1.5);
    expect(speechRequestBody({ model: "tts-1", text: "hi", voice: "nova", style: "en", speed: 1 }).speed).toBeUndefined();
  });
});

describe("synthesizeSpeech", () => {
  it("refuses without a key", async () => {
    await expect(synthesizeSpeech({}, { text: "hi", voice: "nova", style: "en" })).rejects.toThrow(/OPENAI_API_KEY/);
  });
  it("returns the audio bytes and never echoes the key in errors", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/models")) return new Response(JSON.stringify({ data: [{ id: "gpt-4o-mini-tts" }] }), { status: 200 });
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    });
    const out = await synthesizeSpeech({ OPENAI_API_KEY: "sk-test" }, { text: "hi", voice: "nova", style: "en" }, { fetchImpl: fetchImpl as never });
    expect([...out.bytes]).toEqual([1, 2, 3]);
    const failing = vi.fn(async () => new Response("{}", { status: 401 }));
    await expect(synthesizeSpeech({ OPENAI_API_KEY: "sk-secret" }, { text: "hi", voice: "nova", style: "en" }, { fetchImpl: failing as never })).rejects.not.toThrow(/sk-secret/);
  });
});
