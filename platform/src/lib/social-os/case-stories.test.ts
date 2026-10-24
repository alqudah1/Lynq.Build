import { describe, it, expect } from "vitest";
import { ARCUBED_CASE } from "./case-stories";
import { needsSticker, storySvg } from "./story-original";

describe("Arcubed highlight set", () => {
  it("is seven LYNQ stories numbered in order, none needing a sticker", () => {
    expect(ARCUBED_CASE).toHaveLength(7);
    ARCUBED_CASE.forEach((c, i) => {
      expect(c.spec.brand).toBe("lynq");
      expect(needsSticker(c.spec)).toBe(false);
      expect(storySvg(c.spec)).toContain(`${String(i + 1).padStart(2, "0")} / 07`);
    });
  });

  it("uses real images only for the photo and screenshot frames, and never names a city", () => {
    for (const c of ARCUBED_CASE) {
      if (c.spec.kind === "object" || c.spec.kind === "screen") expect(c.image).toBeTruthy();
      expect(JSON.stringify(c.spec)).not.toMatch(/Amman|Toronto|Jordan|GTA/);
    }
  });
});
