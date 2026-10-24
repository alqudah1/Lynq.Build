import { describe, it, expect } from "vitest";
import { ARCUBED_CASE, HOUSE_DEALS_CASE } from "./case-stories";

describe.each([ARCUBED_CASE, HOUSE_DEALS_CASE])("case set $series", (set) => {
  it("runs cover → brief → the build → what we built → the result", () => {
    expect(set.frames[0]!.kind).toBe("cover");
    expect(set.frames[1]!.kind).toBe("brief");
    expect(set.frames.at(-1)!.kind).toBe("cta");
    expect(set.frames.some((f) => f.kind === "bento")).toBe(true);
  });

  it("names no city or region and quotes no one", () => {
    const copy = JSON.stringify(set.frames.map((f) => ({ ...f, photo: undefined, shots: undefined, tiles: "tiles" in f ? f.tiles.map((t) => [t.label, t.sub]) : undefined })));
    expect(copy).not.toMatch(/Toronto|Amman|Jordan|GTA|Ontario|Alberta|Calgary|Edmonton|“|"[^"]*said/);
  });

  it("keeps every headline line short enough for the frame", () => {
    for (const f of set.frames) if (f.kind === "phones") for (const l of f.headline) expect(l.length, l).toBeLessThanOrEqual(19);
  });
});
