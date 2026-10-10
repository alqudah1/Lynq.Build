import { describe, it, expect } from "vitest";
import { composeHighlightCover, composeStoryCard, storyOverlaySvg, wrapLine } from "./story-card";

describe("story cards", () => {
  it("wraps a caption line to at most three lines and marks a cut", () => {
    expect(wrapLine("Four businesses. Two cities. One standard.", 54, 920)).toEqual(["Four businesses. Two cities. One", "standard."]);
    const long = wrapLine("word ".repeat(80), 54, 920);
    expect(long).toHaveLength(3);
    expect(long[2]!.endsWith("…")).toBe(true);
  });

  it("overlay carries the wordmark, the series label and the next step, in the brand's colours", () => {
    const svg = storyOverlaySvg({ brand: "lynq", series: "Fix this", line: "Your menu is a PDF.", cta: "DM AUDIT" });
    expect(svg).toContain(">LYNQ<");
    expect(svg).toContain(">FIX THIS<");
    expect(svg).toContain(">DM AUDIT<");
    expect(svg).toContain("#c7ff3d");
    const c = storyOverlaySvg({ brand: "codeit", series: "Lessons", line: "x", cta: "Link in bio" });
    expect(c).toContain(">CODEIT<");
    expect(c).toContain("#f97316");
  });

  it("composes a 1080×1920 card from a square image and a 1080×1920 cover", async () => {
    const sharp = (await import("sharp")).default;
    const square = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: { r: 20, g: 20, b: 22 } } }).png().toBuffer();
    const card = await composeStoryCard({ brand: "lynq", image: new Uint8Array(square), series: "PROOF", line: "One site. Two visitors.", cta: "DM AUDIT" });
    const meta = await sharp(Buffer.from(card.bytes)).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1920]);
    const cover = await sharp(Buffer.from(await composeHighlightCover("codeit", "LESSONS"))).metadata();
    expect([cover.width, cover.height]).toEqual([1080, 1920]);
  });
});
