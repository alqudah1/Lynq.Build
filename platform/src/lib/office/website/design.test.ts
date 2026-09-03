import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  deriveDesignProposal,
  designDirectionSchema,
  designTokens,
  hslToHex,
  identitySeed,
  relativeLuminance,
  resolveDesignDirection,
} from "./design";

describe("design colour arithmetic", () => {
  it("matches the WCAG reference values for the extremes", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#000000", "#000000")).toBeCloseTo(1, 5);
    // Known reference pair: #767676 is the darkest grey that clears AA on white.
    expect(contrastRatio("#767676", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#777777", "#ffffff")).toBeLessThan(4.5);
  });

  it("is symmetric and rejects malformed colours", () => {
    expect(contrastRatio("#123456", "#abcdef")).toBeCloseTo(contrastRatio("#abcdef", "#123456"), 10);
    expect(() => relativeLuminance("#abc")).toThrow(/hex/i);
  });

  it("round-trips hsl through six-digit hex", () => {
    expect(hslToHex(0, 1, 0.5)).toBe("#ff0000");
    expect(hslToHex(120, 1, 0.5)).toBe("#00ff00");
    expect(hslToHex(240, 1, 0.5)).toBe("#0000ff");
    expect(hslToHex(0, 0, 1)).toBe("#ffffff");
    // Hue is taken modulo the wheel in both directions.
    expect(hslToHex(360, 1, 0.5)).toBe("#ff0000");
    expect(hslToHex(-120, 1, 0.5)).toBe("#0000ff");
  });
});

describe("deterministic design direction", () => {
  it("is stable for the same business and different across businesses", () => {
    expect(identitySeed("Cafe Diplomatico · Toronto")).toBe(identitySeed("  cafe diplomatico · toronto "));
    const a = deriveDesignProposal("Cafe Diplomatico · Toronto");
    const b = deriveDesignProposal("Sumac Grill · Amman");
    expect(deriveDesignProposal("Cafe Diplomatico · Toronto")).toEqual(a);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("produces a spread of directions rather than one template", () => {
    const identities = Array.from({ length: 60 }, (_, index) => `Restaurant number ${index} on King Street`);
    const directions = identities.map((identity) => deriveDesignProposal(identity));
    expect(new Set(directions.map((item) => item.layout)).size).toBeGreaterThan(1);
    expect(new Set(directions.map((item) => item.typeSystem)).size).toBeGreaterThan(1);
    expect(new Set(directions.map((item) => `${item.layout}/${item.typeSystem}/${item.scheme}`)).size).toBeGreaterThan(8);
  });

  it("always resolves to a schema-valid, AA-legible palette", () => {
    for (let index = 0; index < 400; index += 1) {
      const direction = resolveDesignDirection(deriveDesignProposal(`Prospect ${index} · city ${index % 17}`));
      expect(designDirectionSchema.safeParse(direction).success).toBe(true);
      const { background, ink, muted, accent, accentInk } = direction.palette;
      expect(contrastRatio(ink, background)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(muted, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(accent, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(accentInk, accent)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("repairs a proposal whose accent hue is intrinsically bright", () => {
    // Yellow at a mid lightness fails against a light ground until it is darkened.
    const direction = resolveDesignDirection({
      ...deriveDesignProposal("Yellow test"),
      scheme: "light",
      accentHue: 55,
      neutralHue: 55,
      neutralTint: 0,
    });
    expect(contrastRatio(direction.palette.accent, direction.palette.background)).toBeGreaterThanOrEqual(4.5);
  });

  it("emits self-contained theme tokens", () => {
    const tokens = designTokens(resolveDesignDirection(deriveDesignProposal("Token test")));
    expect(Object.keys(tokens).every((key) => key.startsWith("--demo-"))).toBe(true);
    expect(tokens["--demo-bg"]).toMatch(/^#[0-9a-f]{6}$/);
    expect(tokens["--demo-display"]).toContain("serif");
  });
});
