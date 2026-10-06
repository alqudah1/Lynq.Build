import { describe, it, expect } from "vitest";
import { createOpenAiImageProvider, createOpenAiTextProvider, OPENAI_IMAGE_EDITS_URL, OPENAI_IMAGES_URL, OPENAI_MODELS_URL, OPENAI_RESPONSES_URL, pickAvailableModel, OPENAI_TEXT_MODEL_PREFERENCE, readResponsesText } from "./openai";
import { SocialGenerationFailedError, SocialProviderNotConfiguredError } from "../../errors";
import { makeFakeFetch } from "./test-fetch";

const modelsRoute = (ids: string[]) => ({ match: (u: string) => u === OPENAI_MODELS_URL, respond: () => ({ json: { data: ids.map((id) => ({ id })) } }) });
/** Calls other than the one-time model listing. */
const nonModelCalls = <T extends { url: string }>(calls: T[]) => calls.filter((c) => c.url !== OPENAI_MODELS_URL);

describe("OpenAI text provider (Responses API)", () => {
  it("missing configuration", async () => {
    const p = createOpenAiTextProvider({});
    expect(p.missingConfiguration()).toEqual(["OPENAI_API_KEY"]);
    expect(p.defaultModel).toBe(OPENAI_TEXT_MODEL_PREFERENCE[0]);
    await expect(p.generateText({ system: "s", prompt: "p" })).rejects.toBeInstanceOf(SocialProviderNotConfiguredError);
  });

  it("sends instructions/input/max_output_tokens and a json_schema format when requested", async () => {
    const { fetchImpl, calls } = makeFakeFetch([modelsRoute(["gpt-4o-mini", "gpt-5.3-mini", "whisper-1"]), { match: (u) => u === OPENAI_RESPONSES_URL, respond: () => ({ json: { model: "gpt-5.3-mini", output: [{ type: "message", content: [{ type: "output_text", text: '{"ok":true}' }] }], usage: { input_tokens: 10, output_tokens: 4 } } }) }]);
    const schema = { type: "object", properties: { ok: { type: "boolean" } } };
    const r = await createOpenAiTextProvider({ OPENAI_API_KEY: "sk-o" }, { fetchImpl }).generateText({ system: "sys", prompt: "hello", jsonSchema: schema, maxOutputTokens: 100 });
    expect(r.json).toEqual({ ok: true });
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 4 });
    // The account's model list was consulted once and the best available preferred model picked (not the first preference, which this account lacks).
    expect(calls[0].url).toBe(OPENAI_MODELS_URL);
    expect(calls[1].headers.authorization).toBe("Bearer sk-o");
    expect(calls[1].body).toEqual({ model: "gpt-5.3-mini", instructions: "sys", input: "hello", max_output_tokens: 100, text: { format: { type: "json_schema", name: "result", schema, strict: false } } });
  });

  it("plain text: no text.format; falls back to output_text", async () => {
    const { fetchImpl, calls } = makeFakeFetch([{ match: () => true, respond: () => ({ json: { output_text: "plain" } }) }]);
    const r = await createOpenAiTextProvider({ OPENAI_API_KEY: "k", OPENAI_TEXT_MODEL: "gpt-x" }, { fetchImpl }).generateText({ system: "s", prompt: "p" });
    expect(r.text).toBe("plain");
    // An explicitly configured model is used as-is, with no model listing round-trip.
    expect(calls).toHaveLength(1);
    expect((calls[0].body as Record<string, unknown>).text).toBeUndefined();
    expect((calls[0].body as Record<string, unknown>).model).toBe("gpt-x");
  });

  it("model resolution: preference order, listing failure falls back to the first preference, listing is cached", async () => {
    expect(pickAvailableModel(["gpt-4o-mini", "gpt-5"], OPENAI_TEXT_MODEL_PREFERENCE)).toBe("gpt-5");
    expect(pickAvailableModel(["dall-e-3"], OPENAI_TEXT_MODEL_PREFERENCE)).toBeUndefined();
    const failing = makeFakeFetch([{ match: (u) => u === OPENAI_MODELS_URL, respond: () => ({ status: 500, json: { error: { message: "down" } } }) }, { match: () => true, respond: () => ({ json: { output_text: "ok" } }) }]);
    const p = createOpenAiTextProvider({ OPENAI_API_KEY: "k" }, { fetchImpl: failing.fetchImpl });
    await p.generateText({ system: "s", prompt: "p" });
    expect((failing.calls[1].body as Record<string, unknown>).model).toBe(OPENAI_TEXT_MODEL_PREFERENCE[0]);
    const cached = makeFakeFetch([modelsRoute(["gpt-5-mini"]), { match: () => true, respond: () => ({ json: { output_text: "ok" } }) }]);
    const q = createOpenAiTextProvider({ OPENAI_API_KEY: "k" }, { fetchImpl: cached.fetchImpl });
    await q.generateText({ system: "s", prompt: "a" });
    await q.generateText({ system: "s", prompt: "b" });
    expect(cached.calls.filter((c) => c.url === OPENAI_MODELS_URL)).toHaveLength(1);
    expect(nonModelCalls(cached.calls).map((c) => (c.body as Record<string, unknown>).model)).toEqual(["gpt-5-mini", "gpt-5-mini"]);
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
    const { fetchImpl, calls } = makeFakeFetch([modelsRoute(["gpt-image-1.5"]), { match: (u) => u === OPENAI_IMAGES_URL, respond: () => ({ json: { data: [{ b64_json: b64 }] } }) }]);
    const r = await createOpenAiImageProvider({ OPENAI_API_KEY: "k" }, { fetchImpl }).generateImage({ prompt: "a cat", aspectRatio });
    expect(nonModelCalls(calls)[0].body).toEqual({ model: "gpt-image-1.5", prompt: "a cat", size, quality: "medium", output_format: "jpeg", n: 1 });
    expect(Array.from(r.bytes)).toEqual([0xff, 0xd8, 0xff, 0xd9]);
    expect(r.contentType).toBe("image/jpeg");
    expect(r.usage).toEqual({ units: 1, costUsd: cost, estimated: true });
  });

  it("png output when configured", async () => {
    const { fetchImpl, calls } = makeFakeFetch([{ match: () => true, respond: () => ({ json: { data: [{ b64_json: b64 }] } }) }]);
    const r = await createOpenAiImageProvider({ OPENAI_API_KEY: "k", OPENAI_IMAGE_MODEL: "gpt-image-1" }, { fetchImpl, outputFormat: "png" }).generateImage({ prompt: "x", aspectRatio: "1:1" });
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

  it("with brand reference images, uses the edits endpoint so the mascot stays the same", async () => {
    const seen: { url: string; body: unknown }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen.push({ url, body: init?.body });
      return new Response(JSON.stringify({ data: [{ b64_json: b64 }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const ref = { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), contentType: "image/png", tag: "mascot" };
    const r = await createOpenAiImageProvider({ OPENAI_API_KEY: "k", OPENAI_IMAGE_MODEL: "gpt-image-1" }, { fetchImpl }).generateImage({ prompt: "mascot reading a book", aspectRatio: "4:5", references: [ref] });
    expect(seen[0].url).toBe(OPENAI_IMAGE_EDITS_URL);
    const form = seen[0].body as FormData;
    expect(form.get("model")).toBe("gpt-image-1");
    expect(String(form.get("prompt"))).toContain("mascot reading a book");
    expect(String(form.get("prompt"))).toContain("Keep that character exactly the same");
    expect(form.getAll("image[]")).toHaveLength(1);
    expect(Array.from(r.bytes)).toEqual([0xff, 0xd8, 0xff, 0xd9]);
  });

  it("falls back to plain generation when the edits call fails (but not on bad credentials)", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      if (url === OPENAI_IMAGE_EDITS_URL) return new Response(JSON.stringify({ error: { message: "edits not supported" } }), { status: 400 });
      return new Response(JSON.stringify({ data: [{ b64_json: b64 }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const ref = { bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg", tag: "logo" };
    await createOpenAiImageProvider({ OPENAI_API_KEY: "k", OPENAI_IMAGE_MODEL: "gpt-image-1" }, { fetchImpl }).generateImage({ prompt: "x", aspectRatio: "1:1", references: [ref] });
    expect(urls).toEqual([OPENAI_IMAGE_EDITS_URL, OPENAI_IMAGES_URL]);
    const denied = (async () => new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 })) as unknown as typeof fetch;
    const e = await createOpenAiImageProvider({ OPENAI_API_KEY: "k", OPENAI_IMAGE_MODEL: "gpt-image-1" }, { fetchImpl: denied }).generateImage({ prompt: "x", aspectRatio: "1:1", references: [ref] }).catch((x) => x);
    expect(e).toBeInstanceOf(SocialGenerationFailedError);
  });
});
