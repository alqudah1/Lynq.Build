import { describe, it, expect } from "vitest";
import { cardKey, codeItCardSvg, panelHeight, wrap, type CodeItCard } from "./codeit-card";

const spec: CodeItCard = {
  eyebrow: "We prove it", headline: "The game works.", sub: "Now, one question.", rows: [[0, 1], [2]],
  steps: [
    { label: "Their game", panel: { type: "game", hero: "cat", item: "pizza", score: "12" } },
    { label: "Their code", panel: { type: "code", lines: ["cat = Cat()", "jump = 8"], highlight: 1 } },
    { label: "The question", panel: { type: "question", prompt: "What makes the cat jump?", options: ["jump = 5", "jump = 8", "jump = 12"], correct: 1 } },
  ],
  takeaway: "Wrong answers come from their own code.", tryThis: "Try tonight: ask what makes their character move.",
};

describe("CodeIt story cards", () => {
  it("draws the website's system: cream canvas, orange eyebrow, brown and orange headline, the dark code box, numbered steps", () => {
    const svg = codeItCardSvg(spec);
    expect(svg).toContain('fill="#fff4e5"');
    expect(svg).toContain("WE PROVE IT");
    expect(svg).toContain("The game works.");
    expect(svg).toContain("Now, one question.");
    expect(svg).toContain("jump = 8");
    expect(svg).toContain("codeitlearn.com");
    expect((svg.match(/<circle cx="\d+" cy="\d+" r="26" fill="#ff7a00"/g) ?? []).length).toBe(3);
  });

  it("the right answer is the orange pill with a tick, the others stay cream", () => {
    const svg = codeItCardSvg(spec);
    expect(svg).toContain('stroke="#fff" stroke-width="6"');
    expect((svg.match(/rx="31" fill="#ff7a00"/g) ?? []).length).toBe(1);
  });

  it("steps are scaled down, never clipped, when they run longer than the space above the takeaway", () => {
    const tall: CodeItCard = { ...spec, rows: undefined, steps: [spec.steps[0]!, spec.steps[1]!, spec.steps[2]!, { label: "More", panel: { type: "terminal", text: "ok" } }] };
    const m = /scale\(([\d.]+)\)/.exec(codeItCardSvg(tall));
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeLessThan(1);
    expect(Number(/scale\(([\d.]+)\)/.exec(codeItCardSvg(spec))![1])).toBeLessThanOrEqual(1);
  });

  it("panel heights are fixed per type so layout is predictable; wrap splits long lines", () => {
    expect(panelHeight({ type: "run" })).toBe(72);
    expect(panelHeight({ type: "code", lines: ["a", "b", "c"] })).toBe(220);
    expect(wrap("one two three four five six seven eight nine ten", 30, 300).length).toBeGreaterThan(1);
  });

  it("the card key changes with the spec, so an edited card remakes the image", () => {
    expect(cardKey(spec)).toMatch(/^codeit-card:[0-9a-f]{16}$/);
    expect(cardKey({ ...spec, headline: "Other" })).not.toBe(cardKey(spec));
    expect(cardKey(spec).length).toBeLessThan(64);
  });
});
