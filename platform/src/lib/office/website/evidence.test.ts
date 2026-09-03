import { describe, expect, it } from "vitest";
import { brandPack, candidate } from "../../../../test/support/website-fixtures";
import { buildSiteEvidence, localeForCountry, MissingResearchError, renderEvidenceTable } from "./evidence";

describe("evidence ledger", () => {
  it("refuses to build from research that is missing or off-schema", () => {
    expect(() => buildSiteEvidence({ candidate: null })).toThrow(MissingResearchError);
    expect(() => buildSiteEvidence({ candidate: { name: "Just a name" } })).toThrow(MissingResearchError);
    expect(() => buildSiteEvidence({ candidate: { ...candidate, countryCode: "US" } })).toThrow(MissingResearchError);
  });

  it("carries only the facts the research and the approved pack verified", () => {
    const evidence = buildSiteEvidence({ candidate, brandPack });
    expect(evidence.facts.get("business.phone")?.value).toBe("+1 416 555 0142");
    expect(evidence.facts.get("business.rating")?.value).toBe("4.6");
    expect(evidence.facts.has("business.seats")).toBe(false);
    expect([...evidence.capabilities]).toEqual(["dine-in", "reservation"]);
    expect(evidence.identity).toBe("Sumac & Stone · Toronto · CA");
  });

  it("keeps the retrieval date and confidence beside every fact the pack supplied", () => {
    const evidence = buildSiteEvidence({ candidate, brandPack });
    const hours = evidence.facts.get("hours.0")!;
    expect(hours.retrievedAt).toBe("2026-08-18");
    expect(hours.confidence).toBe("verified");
    // Facts that came with the approved research are labelled as such
    // rather than borrowing a retrieval date they never had.
    expect(evidence.facts.get("business.address")).toMatchObject({ retrievedAt: null, confidence: "research" });
  });

  it("never lets pack evidence quietly overwrite a researched identity fact", () => {
    const evidence = buildSiteEvidence({
      candidate,
      brandPack: {
        ...brandPack,
        facts: [{ key: "business.phone", label: "Phone", value: "+1 416 555 9999", provenance: brandPack.images[0]!.provenance }],
      },
    });
    expect(evidence.facts.get("business.phone")?.value).toBe("+1 416 555 0142");
  });

  it("omits, rather than invents, a contact the research left unverified", () => {
    const evidence = buildSiteEvidence({ candidate: { ...candidate, phone: null, email: null, rating: null, reviews: null } });
    expect(evidence.facts.has("business.phone")).toBe(false);
    expect(evidence.facts.has("business.email")).toBe(false);
    expect(evidence.facts.has("business.rating")).toBe(false);
    expect(evidence.capabilities.size).toBe(0);
  });

  it("follows the verified country code into the site language", () => {
    expect(localeForCountry("CA")).toBe("en");
    expect(localeForCountry("JO")).toBe("ar");
    expect(buildSiteEvidence({ candidate: { ...candidate, countryCode: "JO" } }).locale).toBe("ar");
  });

  it("renders a founder-readable table with a source, a date and a confidence beside every fact", () => {
    const table = renderEvidenceTable(buildSiteEvidence({ candidate, brandPack }));
    expect(table).toContain("| Fact | Value | Source | Retrieved | Confidence |");
    expect(table).toContain("412 Dundas Street West");
    expect(table).toContain("https://sumacandstone.example.ca");
    expect(table).toContain("Hours — Tuesday to Thursday");
    expect(table).toContain("2026-08-18");
    expect(table).toContain("verified");
  });
});
