import { describe, expect, it } from "vitest";
import { brandPack, candidate } from "../../../../test/support/website-fixtures";
import {
  brandPackMarker,
  brandPackParseFailed,
  buildSiteEvidence,
  EMPTY_BRAND_PACK,
  localeForCountry,
  MissingResearchError,
  parseBrandPack,
  renderEvidenceTable,
} from "./evidence";

describe("approved brand pack", () => {
  it("round-trips through the project artifact marker", () => {
    const parsed = parseBrandPack(`Some project notes\n\n${brandPackMarker(brandPack)}\n\nMore notes`);
    expect(parsed.menu).toHaveLength(2);
    expect(parsed.services.map((service) => service.capability)).toEqual(["dine-in", "reservation"]);
    expect(brandPackParseFailed(`${brandPackMarker(brandPack)}`)).toBe(false);
  });

  it("treats an absent pack as an empty one rather than an error", () => {
    expect(parseBrandPack(null)).toEqual(EMPTY_BRAND_PACK);
    expect(parseBrandPack("A project with no approved brand material.")).toEqual(EMPTY_BRAND_PACK);
    expect(brandPackParseFailed("A project with no approved brand material.")).toBe(false);
  });

  it("refuses a malformed pack loudly rather than half-reading it", () => {
    const broken = "<!-- LYNQ_APPROVED_BRAND_PACK {\"assets\":[{\"id\":\"x\"}]} -->";
    expect(parseBrandPack(broken)).toEqual(EMPTY_BRAND_PACK);
    expect(brandPackParseFailed(broken)).toBe(true);
    expect(brandPackParseFailed("<!-- LYNQ_APPROVED_BRAND_PACK {not json}")).toBe(true);
  });

  it("rejects an asset that is not served over https", () => {
    const insecure = brandPackMarker({
      ...brandPack,
      assets: [{ ...brandPack.assets[0]!, url: "http://cdn.example.ca/sumac/dining-room.jpg" }],
    });
    expect(brandPackParseFailed(insecure)).toBe(true);
    expect(parseBrandPack(insecure).assets).toEqual([]);
  });
});

describe("evidence ledger", () => {
  it("refuses to build from research that is missing or off-schema", () => {
    expect(() => buildSiteEvidence({ candidate: null })).toThrow(MissingResearchError);
    expect(() => buildSiteEvidence({ candidate: { name: "Just a name" } })).toThrow(MissingResearchError);
    expect(() => buildSiteEvidence({ candidate: { ...candidate, countryCode: "US" } })).toThrow(MissingResearchError);
  });

  it("carries only the facts the research verified", () => {
    const evidence = buildSiteEvidence({ candidate, brandPack });
    expect(evidence.facts.get("business.phone")?.value).toBe("+1 416 555 0142");
    expect(evidence.facts.get("business.rating")?.value).toBe("4.6");
    expect(evidence.facts.has("business.seats")).toBe(false);
    expect([...evidence.capabilities]).toEqual(["dine-in", "reservation"]);
    expect(evidence.identity).toBe("Sumac & Stone · Toronto · CA");
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

  it("renders a founder-readable table with a source beside every fact", () => {
    const table = renderEvidenceTable(buildSiteEvidence({ candidate, brandPack }));
    expect(table).toContain("| Fact | Value | Evidence |");
    expect(table).toContain("412 Dundas Street West");
    expect(table).toContain("https://sumacandstone.example.ca");
    expect(table).toContain("Hours — Tuesday to Thursday");
  });
});
