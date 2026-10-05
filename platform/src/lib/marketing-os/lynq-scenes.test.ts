import { describe, expect, it } from "vitest";
import { LYNQ_METAPHORS, assignLynqMetaphors, lynqLabelsFor, parseLynqVisualDirection } from "./lynq-scenes";

describe("LYNQ scene direction", () => {
  it("parses the director grammar", () => {
    const parsed = parseLynqVisualDirection("website: metaphor=open_door | A door ajar in a dark wall, lime light on the floor. | labels: First impression; What customers see");
    expect(parsed).toEqual({ scene: "website", metaphor: "open_door", description: "A door ajar in a dark wall, lime light on the floor.", labels: ["First impression", "What customers see"] });
  });

  it("tolerates hand-written directions", () => {
    const parsed = parseLynqVisualDirection("Real premium landing-page work.");
    expect(parsed.scene).toBeNull();
    expect(parsed.metaphor).toBeNull();
    expect(parsed.labels).toEqual([]);
    expect(parsed.description).toBe("Real premium landing-page work.");
    expect(parseLynqVisualDirection("brand: metaphor=hologram | nope").metaphor).toBeNull();
  });

  it("infers a distinct metaphor for every panel of a legacy carousel and closes on cta", () => {
    const metaphors = assignLynqMetaphors([
      { visual: "website: Real premium landing-page work.", onScreenText: "Start with the page customers see." },
      { visual: "portfolio: Real LYNQ website or portfolio proof.", onScreenText: "Make the offer clear." },
      { visual: "website: Real page and call-to-action detail.", onScreenText: "Make the next step obvious." },
      { visual: "systems: Connected CRM and workflow behind the page.", onScreenText: "Then connect what happens next." },
      { visual: "cta: LYNQ brand card and lynq.build.", onScreenText: "Start with your website." },
    ]);
    expect(new Set(metaphors).size).toBe(5);
    expect(metaphors[0]).toBe("storefront");
    expect(metaphors[3]).toBe("stack");
    expect(metaphors[4]).toBe("cta");
    for (const metaphor of metaphors) expect(LYNQ_METAPHORS).toContain(metaphor);
  });

  it("keeps an explicit metaphor even when repeated and never uses cta mid-carousel", () => {
    const metaphors = assignLynqMetaphors([
      { visual: "brand: metaphor=bottleneck | one", onScreenText: "" },
      { visual: "brand: metaphor=bottleneck | two", onScreenText: "" },
      { visual: "brand: Something quiet", onScreenText: "Book a strategy call" },
    ]);
    expect(metaphors.slice(0, 2)).toEqual(["bottleneck", "bottleneck"]);
    expect(metaphors[2]).toBe("cta");
    expect(assignLynqMetaphors([{ visual: "website: Real work", onScreenText: "" }])).toEqual(["storefront"]);
  });

  it("places supplied labels on the scene's anchors and falls back to defaults", () => {
    expect(lynqLabelsFor("bottleneck", ["Leads", "Reception"]).map((label) => label.text)).toEqual(["Leads", "Reception"]);
    expect(lynqLabelsFor("bottleneck", []).length).toBe(3);
    expect(lynqLabelsFor("cta", ["ignored"])).toEqual([]);
    expect(lynqLabelsFor("sticky_note", ["On the note", "Pinned"]).map((label) => label.text)).toEqual(["Pinned"]);
  });
});
