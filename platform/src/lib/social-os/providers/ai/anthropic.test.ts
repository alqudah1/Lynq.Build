import { describe, it, expect } from "vitest";
import { createAnthropicProvider, ANTHROPIC_MESSAGES_URL } from "./anthropic";
import { SocialGenerationFailedError, SocialProviderNotConfiguredError } from "../../errors";
import { makeFakeFetch } from "./test-fetch";

const ok = (text: string, usage = { input_tokens: 1000, output_tokens: 500 }) => ({ json: { model: "claude-sonnet-5-5", content: [{ type: "text", text }], usage } });

describe("Anthropic text provider", () => {
  it("reports missing configuration and refuses to call without a key", async () => {
    const p = createAnthropicProvider({});
    expect(p.missingConfiguration()).toEqual(["ANTHROPIC_API_KEY"]);
    expect(p.defaultModel).toBe("claude-sonnet-5-5");
    await expect(p.generateText({ system: "s", prompt: "p" })).rejects.toBeInstanceOf(SocialProviderNotConfiguredError);
  });

  it("sends the Messages API request shape and estimates cost", async () => {
    const { fetchImpl, calls } = makeFakeFetch([{ match: (u) => u === ANTHROPIC_MESSAGES_URL, respond: () => ok("Hello there") }]);
    const p = createAnthropicProvider({ ANTHROPIC_API_KEY: "sk-test", ANTHROPIC_MODEL: "claude-sonnet-5-5" }, { fetchImpl });
    const r = await p.generateText({ system: "be brief", prompt: "say hi", maxOutputTokens: 300 });
    expect(r.text).toBe("Hello there");
    expect(r.provider).toBe("anthropic");
    const call = calls[0];
    expect(call.init?.method).toBe("POST");
    expect(call.headers["x-api-key"]).toBe("sk-test");
    expect(call.headers["anthropic-version"]).toBe("2023-06-01");
    expect(call.headers["content-type"]).toBe("application/json");
    expect(call.body).toEqual({ model: "claude-sonnet-5-5", max_tokens: 300, system: "be brief", messages: [{ role: "user", content: "say hi" }] });
    // 1000 * $2/MTok + 500 * $10/MTok = 0.002 + 0.005
    expect(r.usage).toEqual({ inputTokens: 1000, outputTokens: 500, costUsd: 0.007, estimated: true });
  });

  it("unknown model → no cost estimate", async () => {
    const { fetchImpl } = makeFakeFetch([{ match: () => true, respond: () => ({ json: { content: [{ type: "text", text: "x" }], usage: { input_tokens: 5, output_tokens: 5 } } }) }]);
    const r = await createAnthropicProvider({ ANTHROPIC_API_KEY: "k", ANTHROPIC_MODEL: "claude-mystery-1" }, { fetchImpl }).generateText({ system: "s", prompt: "p" });
    expect(r.usage.costUsd).toBeUndefined();
    expect(r.usage.estimated).toBeUndefined();
  });

  it("JSON mode: appends the schema instruction and extracts the first object from fenced text", async () => {
    const { fetchImpl, calls } = makeFakeFetch([{ match: () => true, respond: () => ok('Sure!\n```json\n{"a": 1, "b": "x}"}\n```\nanything else') }]);
    const r = await createAnthropicProvider({ ANTHROPIC_API_KEY: "k" }, { fetchImpl }).generateText({ system: "s", prompt: "give json", jsonSchema: { type: "object", properties: { a: { type: "number" } } } });
    expect(r.json).toEqual({ a: 1, b: "x}" });
    const content = (calls[0].body as { messages: { content: string }[] }).messages[0].content;
    expect(content).toContain("give json");
    expect(content).toContain("ONLY a single JSON object");
    expect(content).toContain('"properties"');
  });

  it("JSON mode: an unparseable reply is a retryable invalid-JSON failure", async () => {
    const { fetchImpl } = makeFakeFetch([{ match: () => true, respond: () => ok("no json here") }]);
    const err = await createAnthropicProvider({ ANTHROPIC_API_KEY: "k" }, { fetchImpl }).generateText({ system: "s", prompt: "p", jsonSchema: { type: "object" } }).catch((e) => e);
    expect(err).toBeInstanceOf(SocialGenerationFailedError);
    expect(err.retryable).toBe(true);
    expect(err.message).toContain("invalid JSON");
  });

  it.each([
    [429, true],
    [529, true],
    [500, true],
    [503, true],
    [401, false],
    [400, false],
  ])("HTTP %i → retryable=%s, message never contains the key", async (status, retryable) => {
    const { fetchImpl } = makeFakeFetch([{ match: () => true, respond: () => ({ status, json: { type: "error", error: { type: "some_error", message: "nope" } } }) }]);
    const err = await createAnthropicProvider({ ANTHROPIC_API_KEY: "sk-secret-value" }, { fetchImpl }).generateText({ system: "s", prompt: "p" }).catch((e) => e);
    expect(err).toBeInstanceOf(SocialGenerationFailedError);
    expect(err.retryable).toBe(retryable);
    expect(err.message).toContain(String(status));
    expect(err.message).not.toContain("sk-secret-value");
  });

  it("network failure is retryable", async () => {
    const err = await createAnthropicProvider({ ANTHROPIC_API_KEY: "k" }, { fetchImpl: async () => { throw new TypeError("fetch failed"); } }).generateText({ system: "s", prompt: "p" }).catch((e) => e);
    expect(err).toBeInstanceOf(SocialGenerationFailedError);
    expect(err.retryable).toBe(true);
  });
});
