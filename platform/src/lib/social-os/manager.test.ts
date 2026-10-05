import { describe, it, expect } from "vitest";
import { z } from "zod";
import { boundToolResult, buildManagerSystemPrompt, parseManagerReply, protocolInstructions, runManagerLoop, type ManagerTool } from "./manager";
import { fakeTextProvider } from "./providers/ai/test-fakes";

function echoTool(log: unknown[] = []): ManagerTool {
  return {
    name: "echo",
    description: "Echo the input",
    input: z.object({ value: z.string().min(1) }).strict(),
    async execute(input) {
      log.push(input);
      return { result: { echoed: (input as { value: string }).value }, proposedActions: [{ type: "content_item", id: "item-1", label: "Echo" }] };
    },
  };
}

describe("runManagerLoop (JSON protocol)", () => {
  it("tool call → result fed back → final", async () => {
    const log: unknown[] = [];
    const fake = fakeTextProvider((req, call) => (call === 1 ? { text: 'Let me check.\n{"tool":"echo","input":{"value":"hi"}}' } : { text: `{"final":"Done: ${req.prompt.includes('"echoed":"hi"') ? "saw result" : "no result"}"}` }));
    const out = await runManagerLoop({ textProvider: fake.provider, tools: [echoTool(log)], system: "SYSTEM", messages: [{ role: "user", content: "say hi" }] });
    expect(out.stoppedReason).toBe("final");
    expect(out.final).toBe("Done: saw result");
    expect(out.modelCalls).toBe(2);
    expect(log).toEqual([{ value: "hi" }]);
    expect(out.steps).toEqual([{ tool: "echo", input: { value: "hi" }, ok: true, result: { echoed: "hi" } }]);
    expect(out.proposedActions).toEqual([{ type: "content_item", id: "item-1", label: "Echo" }]);
    expect(fake.calls[0].system).toContain("SYSTEM");
    expect(fake.calls[0].system).toContain("TOOL PROTOCOL");
    expect(fake.calls[0].system).toContain("- echo: Echo the input");
    expect(fake.calls[0].prompt).toContain("[user]\nsay hi");
  });

  it("stops at maxSteps with an honest summary", async () => {
    const fake = fakeTextProvider(() => ({ text: '{"tool":"echo","input":{"value":"again"}}' }));
    const out = await runManagerLoop({ textProvider: fake.provider, tools: [echoTool()], system: "s", messages: [{ role: "user", content: "loop" }], maxSteps: 3 });
    expect(out.stoppedReason).toBe("max_steps");
    expect(fake.calls).toHaveLength(3);
    expect(out.steps).toHaveLength(3);
    expect(out.final).toMatch(/limit of 3 steps/);
  });

  it("recovers from one malformed reply and gives up after two in a row", async () => {
    const recover = fakeTextProvider((_r, call) => (call === 1 ? { text: "I think the answer is" } : { text: '{"final":"ok"}' }));
    const r1 = await runManagerLoop({ textProvider: recover.provider, tools: [], system: "s", messages: [{ role: "user", content: "q" }] });
    expect(r1).toMatchObject({ final: "ok", stoppedReason: "final" });
    expect(recover.calls[1].prompt).toContain("PROTOCOL ERROR");

    const prose = fakeTextProvider(() => ({ text: "Plain prose answer." }));
    const r2 = await runManagerLoop({ textProvider: prose.provider, tools: [], system: "s", messages: [{ role: "user", content: "q" }] });
    expect(r2).toMatchObject({ stoppedReason: "malformed", final: "Plain prose answer." });

    const junk = fakeTextProvider(() => ({ text: '{"neither": true}' }));
    const r3 = await runManagerLoop({ textProvider: junk.provider, tools: [], system: "s", messages: [{ role: "user", content: "q" }] });
    expect(r3.stoppedReason).toBe("malformed");
    expect(r3.final).toMatch(/could not complete/);
  });

  it("unknown tools, invalid input and tool errors become error results the model can react to", async () => {
    const failing: ManagerTool = { name: "boom", description: "fails", input: z.object({}).strict(), execute: async () => { throw new Error("service said no"); } };
    const fake = fakeTextProvider((_r, call) => [
      { text: '{"tool":"publish_now","input":{}}' },
      { text: '{"tool":"echo","input":{"value":""}}' },
      { text: '{"tool":"boom","input":{}}' },
      { text: '{"final":"handled"}' },
    ][call - 1]);
    const out = await runManagerLoop({ textProvider: fake.provider, tools: [echoTool(), failing], system: "s", messages: [{ role: "user", content: "q" }] });
    expect(out.final).toBe("handled");
    expect(out.steps.map((s) => [s.tool, s.ok])).toEqual([["publish_now", false], ["echo", false], ["boom", false]]);
    expect(out.steps[0].error).toMatch(/unknown tool/);
    expect(out.steps[1].error).toMatch(/value/);
    expect(out.steps[2].error).toBe("service said no");
    expect(fake.calls[3].prompt).toContain("service said no");
  });

  it("provider errors propagate", async () => {
    const fake = fakeTextProvider(() => {
      throw new Error("provider down");
    });
    await expect(runManagerLoop({ textProvider: fake.provider, tools: [], system: "s", messages: [{ role: "user", content: "q" }] })).rejects.toThrow("provider down");
  });
});

describe("manager helpers", () => {
  it("parseManagerReply", () => {
    expect(parseManagerReply({ text: '```json\n{"tool":"x","input":{"a":1}}\n```' })).toEqual({ kind: "tool", tool: "x", input: { a: 1 } });
    expect(parseManagerReply({ text: "", json: { final: "hi" } })).toEqual({ kind: "final", text: "hi" });
    expect(parseManagerReply({ text: "[1,2]" })).toEqual({ kind: "malformed" });
  });

  it("bounds tool results to 4KB", () => {
    const big = { items: Array.from({ length: 500 }, (_, i) => ({ id: i, text: "lorem ipsum ".repeat(10) })) };
    const bounded = boundToolResult(big);
    expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(4096);
    expect((bounded as { _truncated?: boolean })._truncated).toBe(true);
    expect(boundToolResult({ small: 1 })).toEqual({ small: 1 });
  });

  it("system prompt carries the hard rules and brand context", () => {
    const s = buildManagerSystemPrompt({ brand: { brandId: "b", brandKey: "k", name: "LYNQ", text: "BRAND: LYNQ (k)", facts: { preferredPlatforms: [], contentPillars: [], callsToAction: [], prohibitedLanguage: [], neverClaim: [], websites: [], geographicMarket: "" }, recentTopics: ["t1"] }, today: new Date("2026-10-01T12:00:00Z") });
    expect(s).toContain("Today is 2026-10-01");
    expect(s).toMatch(/requires the founder's explicit approval in the Approval Center/);
    expect(s).toMatch(/Never claim something was published/);
    expect(s).toMatch(/Never invent metrics/);
    expect(s).toContain("BRAND: LYNQ (k)");
    expect(protocolInstructions([echoTool()])).toContain('"value"');
  });
});
