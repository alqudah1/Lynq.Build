import { describe, it, expect } from "vitest";
import { checkImageEdges, edgeRetryInstruction, scoreEdges } from "./image-check";

const flat = (w: number, h: number, v = 240) => Array.from({ length: h }, () => Array.from({ length: w }, () => v));

describe("generated image edge check", () => {
  it("a plain or softly lit frame passes", () => {
    const rows = flat(100, 100);
    // soft vignette: slow change, never a sharp jump
    for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) rows[y]![x] = 200 - Math.round(y / 4) - Math.round(x / 4);
    expect(scoreEdges(rows).ok).toBe(true);
  });

  it("text or a badge on the top edge fails the top band only", () => {
    const rows = flat(100, 100);
    // a striped "badge" across the top 4 rows, spanning the middle 40% of the width
    for (let y = 0; y < 4; y++) for (let x = 30; x < 70; x++) rows[y]![x] = x % 2 ? 20 : 240;
    const r = scoreEdges(rows);
    expect(r.ok).toBe(false);
    expect(r.top).toBeGreaterThan(1);
    expect(r.bottom).toBeLessThanOrEqual(1);
    expect(edgeRetryInstruction(r)).toContain("top edge");
  });

  it("the same badge 12% in from the edge passes", () => {
    const rows = flat(100, 100);
    for (let y = 12; y < 16; y++) for (let x = 30; x < 70; x++) rows[y]![x] = x % 2 ? 20 : 240;
    expect(scoreEdges(rows).ok).toBe(true);
  });

  it("reads a real image: a square with a logo-like block on the top edge fails, centred passes", async () => {
    const sharp = (await import("sharp")).default;
    const block = Buffer.alloc(300 * 40 * 3);
    block.fill(30); // a solid dark badge
    const edge = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: { r: 255, g: 246, b: 236 } } }).composite([{ input: block, raw: { width: 300, height: 40, channels: 3 }, top: 0, left: 362 }]).png().toBuffer();
    const centred = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: { r: 255, g: 246, b: 236 } } }).composite([{ input: block, raw: { width: 300, height: 40, channels: 3 }, top: 300, left: 362 }]).png().toBuffer();
    expect((await checkImageEdges(new Uint8Array(edge))).ok).toBe(false);
    expect((await checkImageEdges(new Uint8Array(centred))).ok).toBe(true);
  });
});
