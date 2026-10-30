import { describe, expect, it } from "vitest";
import { formatSvg, type CardFormat } from "./codeit-formats";
import { WEEK_PLANS } from "./week-plans";

const FORMATS: CardFormat[] = [
  { kind: "split", top: { code: "speed = 2", caption: "Strolling cat" }, bottom: { code: "speed = 20", caption: "Zoomy cat" } },
  { kind: "bug", symptom: "STUCK", code: ["ghost.x = 100", "speed = 0", "ghost.x += speed"], question: "Which line is the bug?" },
  { kind: "comic", panels: [{ pose: "think", caption: "a" }, { pose: "type", code: "jump()", caption: "b" }, { pose: "type", caption: "c" }, { pose: "jump", caption: "d" }] },
  { kind: "cheat", word: "variable", like: "a jar", object: "jar", lines: ["one"], code: "score = 3" },
  { kind: "guess", code: ["rocket.y -= 5"], options: ["A", "B", "C", "D"], hint: "Answer tomorrow" },
  { kind: "ask", prompt: "Tell me a game", example: "a bunny", promise: "We build it" },
];

describe("CodeIt creative formats", () => {
  it.each(FORMATS.map((f) => [f.kind, f] as const))("%s draws a complete 1080 card", (_k, f) => {
    const svg = formatSvg("Eyebrow", "Headline", "Sub", f);
    expect(svg).toContain('width="1080"');
    expect(svg).not.toMatch(/undefined|NaN/);
    expect(svg).toContain("codeitlearn.com");
  });

  it("tonight's CodeIt post is the one line, two games split", () => {
    const post = WEEK_PLANS.flatMap((p) => p.feed).find((f) => f.key === "n-codeit-start");
    expect(post?.card?.format?.kind).toBe("split");
    expect(post?.pillar).toBe("OFFER");
  });
});
