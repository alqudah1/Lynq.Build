import { describe, it, expect } from "vitest";
import { createOpenAiImageProvider, createOpenAiTextProvider, OPENAI_IMAGES_URL, OPENAI_RESPONSES_URL, readResponsesText } from "./openai";
import { SocialGenerationFailedError, SocialProviderNotConfiguredError } from "../../errors";
import { makeFakeFetch } from "./test-fetch";

describe("OpenAI text provider (Responses API)", () => {
  it("missing configuration", async () => {
    const p = createOpenAiTextProvider({});
    expect(p.missingConfiguration()).toEqual(["OPENAI_API_KEY"]);
    expect(p.defaultModel).toBe("gpt-5.3-mini");
    await expect(p.generateText({ system: "s", prompt: "p" })).rejects.toBeInstanceOf(SocialProviderNotConfiguredError);
  });

  it("sends instructions/input/max_output_tokens and a json_schema format when requested", async () => {
    const { fetchImpl, calls } = makeFakeFetch([{ match: (u) => u === OPENAI_RESPONSES_URL, respond: () => ({ json: { model: "gpt-5.3-mini", output: [{ type: "message", content: [{ type: "output_text", text: '{"ok":true}' }] }], usage: { input_tokens: 10, output_tokens: 4 } } }) }]);
    const schema = { type: "object", properties: { ok: { type: "boolean" } } };
    const r = await createOpenAiTextProvider({ OPENAI_API_KEY: "sk-o" }, { fetchImpl }).generateText({ system: "sys", prompt: "hello", jsonSchema: schema, maxOutputTokens: 100 });
    expect(r.json).toEqual({ ok: true });
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 4 });
    expect(calls[0].headers.authorization).toBe("Bearer sk-o");
    expect(calls[0].body).toEqual({ model: "gpt-5.3-mini", instructions: "sys", input: "hello", max_output_tokens: 100, text: { format: { type: "json_schema", name: "result", schema, strict: false } } });
  });

  it("plain text: no text.format; falls back to output_text", async () => {
    const { fetchImpl, calls } = makeFakeFetch([{ match: () => true, respond: () => ({ json: { output_text: "plain" } }) }]);
    const r = await createOpenAiTextProvider({ OPENAI_API_KEY: "k", OPENAI_TEXT_MODEL: "gpt-x" }, { fetchImpl }).generateText({ system: "s", prompt: "p" });
    expect(r.text).toBe("plain");
    expect((calls[0].body as Record<string, unknown>).text).toBeUndefined();
    expect((calls[0].body as Record<string, unknown>).model).toBe("gpt-x");
  });

  it("readResponsesText joins output_text parts", () => {
    expect(readResponsesText({ output: [{ content: [{ type: "output_text", text: "a" }, { type: "refusal" }] }, { content: [{ type: "output_text", text: "b" }] }] })).toBe("ab");
  });

  it("invalid JSON in JSON mode is retryable; 429 retryable; 401 not", async () => {
    const bad = makeFakeFetch([{ match: () => true, respond: () => ({ json: { output_text: "not json" } }) }]);
    const e1 = await createOpenAiTextProvider({ OPENAI_API_KEY: "k" }, { fetchImpl: bad.fetchImpl }).generateText({ system: "s", prompt: "p", jsonSchema: { type: "object" } }).catch((e) => e);
    expect(e1).toBeInstanceOf(SocialGenerationFailedError);
    expect(e1.retryable).toBe(true);
    for (const [status, retryable] of [[429, true], [401, false]] as const) {
      const f = makeFakeFetch([{ match: () => true, respond: () => ({ status, json: { error: { message: "x", type: "t" } } }) }]);
      const e = await createOpenAiTextProvider({ OPENAI_API_KEY: "k" }, { fetchImpl: f.fetchImpl }).generateText({ system: "s", prompt: "p" }).catch((x) => x);
      expect(e.retryable).toBe(retryable);
    }
  });
});

describe("OpenAI image provider", () => {
  const b64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");

  it.each([
    ["1:1", "1024x1024", 0.04],
    ["4:5", "1024x1536", 0.06],
    ["9:16", "1024x1536", 0.06],
    ["16:9", "1536x1024", 0.06],
    ["3:2", "1536x1024", 0.06],
  ] as const)("aspect %s → size %s, estimated $%s", async (aspectRatio, size, cost) => {
    const { fetchImpl, calls } = makeFakeFetch([{ match: (u) => u === OPENAI_IMAGES_URL, respond: () => ({ json: { data: [{ b64_json: b64 }] } }) }]);
    const r = await createOpenAiImageProvider({ OPENAI_API_KEY: "k" }, { fetchImpl }).generateImage({ prompt: "a cat", aspectRatio });
    expect(calls[0].body).toEqual({ model: "gpt-image-1.5", prompt: "a cat", size, quality: "medium", output_format: "jpeg", n: 1 });
    expect(Array.from(r.bytes)).toEqual([0xff, 0xd8, 0xff, 0xd9]);
    expect(r.contentType).toBe("image/jpeg");
    expect(r.usage).toEqual({ units: 1, costUsd: cost, estimated: true });
  });

  it("png output when configured", async () => {
    const { fetchImpl, calls } = makeFakeFetch([{ match: () => true, respond: () => ({ json: { data: [{ b64_json: b64 }] } }) }]);
    const r = await createOpenAiImageProvider({ OPENAI_API_KEY: "k" }, { fetchImpl, outputFormat: "png" }).generateImage({ prompt: "x", aspectRatio: "1:1" });
    expect(r.contentType).toBe("image/png");
    expect((calls[0].body as Record<string, unknown>).output_format).toBe("png");
  });

  it("no image data → retryable failure; missing key → not configured", async () => {
    const { fetchImpl } = makeFakeFetch([{ match: () => true, respond: () => ({ json: { data: [] } }) }]);
    const e = await createOpenAiImageProvider({ OPENAI_API_KEY: "k" }, { fetchImpl }).generateImage({ prompt: "x", aspectRatio: "1:1" }).catch((x) => x);
    expect(e).toBeInstanceOf(SocialGenerationFailedError);
    expect(e.retryable).toBe(true);
    expect(createOpenAiImageProvider({}).missingConfiguration()).toEqual(["OPENAI_API_KEY"]);
  });
});
