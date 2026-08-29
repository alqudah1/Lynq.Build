import { describe, it, expect } from "vitest";
import { FabricatedDemoContentError, assertNoFabricatedClaims, demoContentSchema, hashBusinessFacts, isDemoContentStale, parseDemoContent } from "./demo-content";
import type { DemoBusinessFacts } from "./demo-quality";

const FACTS: DemoBusinessFacts = {
  name: "Drift Coffee",
  category: "Coffee shop",
  city: "Toronto",
  countryCode: "CA",
  rating: 4.7,
  reviewCount: 180,
  phone: "+16478927346",
  email: null,
  website: null,
  photoUrl: "https://images.example/drift.jpg",
  description: "A small batch roaster on Dundas West pouring single origin espresso.",
  hoursCount: 7,
};

function content(overrides: Record<string, unknown> = {}) {
  return demoContentSchema.parse({
    version: 1,
    styleKey: "hospitality",
    language: "en",
    eyebrow: "The shop",
    headline: "Single origin espresso on Dundas West",
    intro: "A small batch roaster where the counter is the whole experience.",
    imageLine: "The room, the roast and the people behind it.",
    experienceLabel: "Guest experience",
    experienceTitle: "From the door to the cup",
    closing: "Come find us on Dundas West.",
    experiences: [
      { title: "The roast", description: "What is on the bar this week and where it came from." },
      { title: "Order ahead", description: "A direct path from the phone to the counter." },
      { title: "Find us", description: "Hours, location and how to get in touch." },
    ],
    factsHash: hashBusinessFacts(FACTS),
    generatedAt: new Date().toISOString(),
    generatedBy: { kind: "agent", id: "00000000-0000-4000-8000-000000000001" },
    model: "anthropic/claude-sonnet-5",
    ...overrides,
  });
}

describe("generated demo content", () => {
  it("accepts copy written from the business's own facts", () => {
    expect(() => assertNoFabricatedClaims(content(), FACTS)).not.toThrow();
  });

  it.each([
    ["an award claim", { headline: "Award-winning espresso on Dundas West" }],
    ["a superlative ranking claim", { headline: "The best coffee in the city, by a distance" }],
    ["a founding-date or tenure claim", { intro: "Serving Dundas West since 1998 with the same roast." }],
    ["an ownership claim", { intro: "A family-owned roaster on Dundas West." }],
    ["a size claim", { closing: "Come see our 3 locations." }],
    ["a price", { closing: "Subscriptions from 100 CAD a month." }],
    ["a reference to this being a demo", { eyebrow: "Demo" }],
  ])("refuses copy containing %s", (label, override) => {
    try {
      assertNoFabricatedClaims(content(override), FACTS);
      throw new Error("expected a refusal");
    } catch (err) {
      expect(err).toBeInstanceOf(FabricatedDemoContentError);
      expect((err as FabricatedDemoContentError).claim).toBe(label);
    }
  });

  it("allows a claim the business's own description already makes", () => {
    // Repeating what a business published about itself is reporting, not inventing.
    const facts = { ...FACTS, description: "A family-owned roaster on Dundas West since 1998." };
    expect(() => assertNoFabricatedClaims(content({ intro: "A family-owned roaster on Dundas West." }), facts)).not.toThrow();
  });

  it("detects copy written against older facts", () => {
    const written = content();
    expect(isDemoContentStale(written, FACTS)).toBe(false);
    expect(isDemoContentStale(written, { ...FACTS, category: "Bakery" })).toBe(true);
    expect(isDemoContentStale(written, { ...FACTS, rating: 4.2 })).toBe(true);
  });

  it("requires exactly three experiences and a fixed style", () => {
    expect(() => content({ experiences: [{ title: "One", description: "Only one" }] })).toThrow();
    expect(() => content({ styleKey: "whatever" })).toThrow();
  });

  it("treats malformed stored content as absent", () => {
    expect(parseDemoContent(null)).toBeNull();
    expect(parseDemoContent({ headline: "hi" })).toBeNull();
    expect(parseDemoContent(content())).not.toBeNull();
  });
});
