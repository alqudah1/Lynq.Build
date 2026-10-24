import { describe, it, expect } from "vitest";
import { needsSticker, stickerInstructions, stickerZone, storySvg, type StorySpec } from "./story-original";

const quiz: StorySpec = { kind: "quiz", brand: "codeit", eyebrow: "Guess the output", headline: "What does this print?", code: ['word = "ha"', "print(word * 3)"], sticker: { type: "quiz", question: "What does it print?", options: ["ha 3", "hahaha", "an error"], correct: 1 } };
const fix: StorySpec = { kind: "oneFix", brand: "lynq", eyebrow: "One fix", headline: ["Your phone number", "goes here."], fix: "Tap to call", detail: "Top of the page, on every page. Not in the footer." };

describe("story-only stories", () => {
  it("sticker stories are posted by hand, the rest by the Office", () => {
    expect(needsSticker(quiz)).toBe(true);
    expect(needsSticker(fix)).toBe(false);
  });

  it("the Telegram line spells out the sticker exactly, with the right quiz answer marked", () => {
    expect(stickerInstructions({ type: "quiz", question: "What does it print?", options: ["ha 3", "hahaha", "an error"], correct: 1 })).toBe('Quiz sticker: "What does it print?"\n▫️ ha 3\n✅ hahaha\n▫️ an error');
    expect(stickerInstructions({ type: "poll", question: "Which one?", options: ["A", "B"] })).toContain("Poll sticker");
    expect(stickerInstructions({ type: "slider", question: "Apps", emoji: "😩" })).toContain("😩");
  });

  it("the sticker zone stays out of Instagram's top 250 and bottom 320 px", () => {
    for (const s of [quiz, fix]) {
      const z = stickerZone(s);
      expect(z.y).toBeGreaterThanOrEqual(250);
      expect(z.y + z.h).toBeLessThanOrEqual(1920 - 320);
    }
  });

  it("uses each brand's own system", () => {
    expect(storySvg(quiz)).toContain('fill="#fff4e5"');
    expect(storySvg(fix)).toContain('fill="#0b0b0c"');
    expect(storySvg(fix)).toContain("the footer.");
  });
});
