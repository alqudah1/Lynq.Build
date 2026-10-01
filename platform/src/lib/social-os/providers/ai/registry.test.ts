import { describe, it, expect, vi } from "vitest";
import { describeAiProviders, resolveImageProvider, resolveProviderById, resolveTextProvider, resolveVideoProvider } from "./registry";
import { createGatewayTextProvider } from "./gateway";
import { extractJsonObject } from "./http";
import { SocialProviderNotConfiguredError } from "../../errors";

describe("AI provider registry", () => {
  it("describes every provider's availability from env only", () => {
    const list = describeAiProviders({ OPENAI_API_KEY: "k" });
    const byKey = Object.fromEntries(list.map((p) => [`${p.kind}:${p.id}`, p]));
    expect(Object.keys(byKey).sort()).toEqual(["image:openai", "image:runway", "text:anthropic", "text:gateway", "text:openai", "video:higgsfield", "video:runway"]);
    expect(byKey["text:openai"].configured).toBe(true);
    expect(byKey["image:openai"].configured).toBe(true);
    expect(byKey["text:anthropic"]).toMatchObject({ configured: false, missing: ["ANTHROPIC_API_KEY"] });
    expect(byKey["text:gateway"]).toMatchObject({ configured: false, missing: ["OFFICE_PLANNING_MODEL or GOOGLE_GENERATIVE_AI_API_KEY"], label: "LYNQ Office model gateway" });
    expect(byKey["video:runway"].configured).toBe(false);
  });

  it("text order anthropic → openai → gateway; preferred honoured only when configured", () => {
    expect(resolveTextProvider({ ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o" }).id).toBe("anthropic");
    expect(resolveTextProvider({ OPENAI_API_KEY: "o" }).id).toBe("openai");
    expect(resolveTextProvider({ GOOGLE_GENERATIVE_AI_API_KEY: "g" }).id).toBe("gateway");
    expect(resolveTextProvider({ OFFICE_PLANNING_MODEL: "openai/gpt-5" }).id).toBe("gateway");
    expect(resolveTextProvider({ ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o" }, "openai").id).toBe("openai");
    expect(() => resolveTextProvider({ OPENAI_API_KEY: "o" }, "anthropic")).toThrow(SocialProviderNotConfiguredError);
  });

  it("throws an honest not-configured error when nothing is set", () => {
    const err = (() => {
      try {
        resolveTextProvider({});
      } catch (e) {
        return e as SocialProviderNotConfiguredError;
      }
    })();
    expect(err).toBeInstanceOf(SocialProviderNotConfiguredError);
    expect(err?.provider).toBe("text generation");
    expect(err?.missing).toEqual(["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OFFICE_PLANNING_MODEL or GOOGLE_GENERATIVE_AI_API_KEY"]);
    expect(() => resolveImageProvider({})).toThrow(SocialProviderNotConfiguredError);
    expect(() => resolveVideoProvider({})).toThrow(SocialProviderNotConfiguredError);
  });

  it("image openai → runway; video runway → higgsfield; by id", () => {
    expect(resolveImageProvider({ OPENAI_API_KEY: "o", RUNWAYML_API_SECRET: "r" }).id).toBe("openai");
    expect(resolveImageProvider({ RUNWAYML_API_SECRET: "r" }).id).toBe("runway");
    expect(resolveVideoProvider({ RUNWAYML_API_SECRET: "r", HIGGSFIELD_API_KEY: "k", HIGGSFIELD_API_SECRET: "s" }).id).toBe("runway");
    expect(resolveVideoProvider({ HIGGSFIELD_API_KEY: "k", HIGGSFIELD_API_SECRET: "s" }).id).toBe("higgsfield");
    expect(resolveProviderById({}, "higgsfield", "video")?.id).toBe("higgsfield");
    expect(resolveProviderById({}, "anthropic", "video")).toBeNull();
  });
});

describe("gateway text provider", () => {
  it("wraps generateText with Output.object for JSON and reports usage", async () => {
    const generateTextImpl = vi.fn(async (args: Record<string, unknown>) => ({ text: '{"a":1}', output: args.output ? { a: 1 } : undefined, usage: { inputTokens: 3, outputTokens: 2 } }));
    const p = createGatewayTextProvider({ OFFICE_PLANNING_MODEL: "openai/gpt-5" }, { generateTextImpl: generateTextImpl as never });
    const r = await p.generateText({ system: "s", prompt: "p", jsonSchema: { type: "object", properties: { a: { type: "number" } } } });
    expect(r.json).toEqual({ a: 1 });
    expect(r.usage).toEqual({ inputTokens: 3, outputTokens: 2 });
    const args = generateTextImpl.mock.calls[0][0];
    expect(args.system).toBe("s");
    expect(args.prompt).toBe("p");
    expect(args.output).toBeDefined();
    expect(args.model).toBeDefined();
  });

  it("refuses without configuration", async () => {
    await expect(createGatewayTextProvider({}).generateText({ system: "s", prompt: "p" })).rejects.toBeInstanceOf(SocialProviderNotConfiguredError);
  });
});

describe("extractJsonObject", () => {
  it("handles fences, prose, nested braces and strings with braces", () => {
    expect(extractJsonObject('```json\n{"a":{"b":[1,2]}}\n```')).toEqual({ a: { b: [1, 2] } });
    expect(extractJsonObject('Here: {"t":"a } b","n":2} trailing')).toEqual({ t: "a } b", n: 2 });
    expect(extractJsonObject("{broken {\"ok\":true}")).toEqual({ ok: true });
    expect(extractJsonObject("nothing")).toBeUndefined();
  });
});
