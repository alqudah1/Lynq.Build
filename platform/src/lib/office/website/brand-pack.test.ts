import { describe, expect, it } from "vitest";
import { candidate, collectedBrandPack, packFrom, restaurantIdentity } from "../../../../test/support/website-fixtures";
import {
  brandPackMarker,
  brandPackParseFailed,
  emptyBrandPack,
  fingerprintBrandPack,
  hostOf,
  normalizeBrandPack,
  parseBrandPack,
  usableBrandMaterial,
  type CollectedBrandPack,
} from "./brand-pack";

/**
 * The brand pack decides what a generated website is allowed to say, so
 * these tests are mostly about refusal: what the normaliser throws away,
 * why, and whether the founder is told.
 */

const official = { sourceUrl: "https://sumacandstone.example.ca", sourceType: "official_website" as const, retrievedAt: "2026-08-18", confidence: "verified" as const, note: null };

function collect(overrides: Partial<CollectedBrandPack>): CollectedBrandPack {
  return { facts: [], images: [], menu: [], services: [], hours: [], socials: [], brandSignals: [], uncertain: [], ...overrides };
}

describe("brand pack normalisation", () => {
  it("keeps verified material from the business's own approved sources", () => {
    const pack = packFrom(collectedBrandPack);
    expect(pack.images).toHaveLength(3);
    expect(pack.menu.map((category) => category.name)).toEqual(["Mezze", "From the grill"]);
    expect(pack.services.map((service) => service.capability)).toEqual(["dine-in", "reservation"]);
    expect(pack.hours).toHaveLength(2);
    expect(pack.rejected).toEqual([]);
    expect(pack.conflicts).toEqual([]);
    expect(pack.collectedAt).toBe("2026-08-20");
    expect(pack.restaurant).toEqual(restaurantIdentity);
  });

  it("records where every kept item came from, when it was read and how sure the collector was", () => {
    const pack = packFrom(collectedBrandPack);
    for (const item of [...pack.images, ...pack.menu, ...pack.services, ...pack.hours, ...pack.facts]) {
      expect(item.provenance.sourceUrl).toMatch(/^https:\/\//);
      expect(item.provenance.retrievedAt).toBe("2026-08-18");
      expect(item.provenance.confidence).toBe("verified");
    }
  });

  describe("missing and unusable evidence", () => {
    it("refuses anything the collector was not certain about, and tells the founder", () => {
      const pack = packFrom(collect({
        hours: [{ day: "Sunday", hours: "Closed", provenance: { ...official, confidence: "reported" } }],
      }));
      expect(pack.hours).toEqual([]);
      expect(pack.rejected[0]).toMatchObject({ kind: "hours", label: "Sunday", reason: expect.stringContaining("reported") });
      expect(pack.uncertain.some((item) => item.label === "Sunday")).toBe(true);
    });

    it("refuses a source that is not one of this business's approved sources", () => {
      const pack = packFrom(collect({
        facts: [{ key: "contact.phone", label: "Phone", value: "+1 416 555 9999", provenance: { ...official, sourceUrl: "https://random-aggregator.example.net/sumac" } }],
      }));
      expect(pack.facts).toEqual([]);
      expect(pack.rejected[0]?.reason).toContain("not one of the approved sources");
    });

    it("refuses a retrieval date that has not happened yet", () => {
      const pack = packFrom(collect({
        facts: [{ key: "contact.phone", label: "Phone", value: "+1 416 555 0142", provenance: { ...official, retrievedAt: "2027-01-01" } }],
      }));
      expect(pack.facts).toEqual([]);
      expect(pack.rejected[0]?.reason).toContain("future");
    });

    it("leaves an empty pack empty rather than filling it in", () => {
      const pack = packFrom(collect({}));
      expect(pack.facts).toEqual([]);
      expect(pack.images).toEqual([]);
      expect(pack.menu).toEqual([]);
      expect(pack.services).toEqual([]);
      expect(pack.hours).toEqual([]);
      expect(usableBrandMaterial(pack)).toEqual({ brandSignals: [], assets: [], menu: [], services: [], hours: [], facts: [] });
    });
  });

  describe("conflicting sources", () => {
    it("uses neither value when two approved sources disagree", () => {
      const pack = packFrom(collect({
        facts: [
          { key: "contact.phone", label: "Phone", value: "+1 416 555 0142", provenance: official },
          { key: "contact.phone", label: "Phone", value: "+1 416 555 7777", provenance: { ...official, sourceUrl: "https://listings.example.ca/sumac-and-stone", sourceType: "public_listing" } },
        ],
      }));
      expect(pack.facts).toEqual([]);
      expect(pack.conflicts).toHaveLength(1);
      expect(pack.conflicts[0]?.values.map((item) => item.value)).toEqual(["+1 416 555 0142", "+1 416 555 7777"]);
      expect(pack.uncertain[0]?.reason).toContain("Conflicting sources");
    });

    it("treats two sources that agree as one fact rather than a conflict", () => {
      const pack = packFrom(collect({
        facts: [
          { key: "contact.phone", label: "Phone", value: "+1 416 555 0142", provenance: official },
          { key: "contact.phone", label: "Phone", value: "  +1 416 555 0142  ", provenance: { ...official, sourceUrl: "https://listings.example.ca/sumac-and-stone", sourceType: "public_listing" } },
        ],
      }));
      expect(pack.facts).toHaveLength(1);
      expect(pack.conflicts).toEqual([]);
    });

    it("drops a service two sources describe differently rather than picking one", () => {
      const pack = packFrom(collect({
        services: [
          { capability: "reservation", label: "Table reservations", detail: null, provenance: official },
          { capability: "reservation", label: "Walk-ins only", detail: null, provenance: { ...official, sourceUrl: "https://listings.example.ca/sumac-and-stone", sourceType: "public_listing" } },
        ],
      }));
      expect(pack.services).toEqual([]);
      expect(pack.conflicts[0]?.key).toBe("service.reservation");
      expect(pack.uncertain[0]?.reason).toContain("not offered on the page");
    });
  });

  describe("images", () => {
    it("accepts an image hosted on a CDN when its source page is the business's own site", () => {
      const pack = packFrom(collectedBrandPack);
      expect(pack.images.map((image) => hostOf(image.url))).toEqual(["cdn.example.ca", "cdn.example.ca", "cdn.example.ca"]);
    });

    it("refuses an image that did not come from the business's own site or social profile", () => {
      const pack = packFrom(collect({
        images: [{
          id: "listing-photo",
          url: "https://cdn.example.ca/stock/dinner.jpg",
          alt: "A photograph of a dinner table found on a listing",
          kind: "photo",
          credit: null,
          provenance: { ...official, sourceUrl: "https://listings.example.ca/sumac-and-stone", sourceType: "public_listing" },
        }],
      }));
      expect(pack.images).toEqual([]);
      expect(pack.rejected[0]?.reason).toContain("own website or social profile");
    });

    it("refuses an image from a site that has nothing to do with this business", () => {
      const pack = packFrom(collect({
        images: [{
          id: "stock",
          url: "https://stock.example.net/dinner.jpg",
          alt: "A stock photograph of a dinner table",
          kind: "photo",
          credit: null,
          provenance: { ...official, sourceUrl: "https://stock.example.net/licence" },
        }],
      }));
      expect(pack.images).toEqual([]);
      expect(pack.rejected[0]?.reason).toContain("not one of the approved sources");
    });

    it("accepts an image from a verified official social profile once that profile is evidence", () => {
      const pack = packFrom(collect({
        socials: [{ platform: "Instagram", url: "https://instagram.com/sumacandstone", provenance: official }],
        images: [{
          id: "grill-night",
          url: "https://scontent.instagram.com/sumac/grill.jpg",
          alt: "Skewers over the grill, posted by the kitchen",
          kind: "photo",
          credit: null,
          provenance: { ...official, sourceUrl: "https://instagram.com/sumacandstone", sourceType: "official_social" },
        }],
      }));
      expect(pack.images.map((image) => image.id)).toEqual(["grill-night"]);
    });

    it("refuses a social profile that is not on a social platform, and everything sourced from it", () => {
      const pack = packFrom(collect({
        socials: [{ platform: "Instagram", url: "https://not-instagram.example.net/sumac", provenance: official }],
        images: [{
          id: "borrowed",
          url: "https://not-instagram.example.net/sumac/photo.jpg",
          alt: "An image from a site pretending to be a social profile",
          kind: "photo",
          credit: null,
          provenance: { ...official, sourceUrl: "https://not-instagram.example.net/sumac", sourceType: "official_social" },
        }],
      }));
      expect(pack.socials).toEqual([]);
      expect(pack.images).toEqual([]);
      expect(pack.rejected.map((item) => item.kind)).toEqual(["social", "image"]);
    });

    it("keeps one copy of a duplicated image", () => {
      const image = collectedBrandPack.images[0]!;
      const pack = packFrom(collect({ images: [image, { ...image, id: "dining-room-again" }] }));
      expect(pack.images).toHaveLength(1);
      expect(pack.rejected[0]?.reason).toBe("Duplicate image");
    });
  });
});

describe("brand pack versioning", () => {
  it("is stable for identical evidence and independent of key order", () => {
    const pack = packFrom(collectedBrandPack);
    const reordered = JSON.parse(JSON.stringify({ ...pack, restaurant: { countryCode: pack.restaurant.countryCode, city: pack.restaurant.city, address: pack.restaurant.address, name: pack.restaurant.name } }));
    expect(fingerprintBrandPack(packFrom(collectedBrandPack))).toBe(fingerprintBrandPack(pack));
    expect(fingerprintBrandPack(reordered)).toBe(fingerprintBrandPack(pack));
    expect(fingerprintBrandPack(pack)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("changes when any part of the evidence changes", () => {
    const base = fingerprintBrandPack(packFrom(collectedBrandPack));
    const extraImage = packFrom({ ...collectedBrandPack, images: collectedBrandPack.images.slice(0, 2) });
    const laterRetrieval = packFrom({
      ...collectedBrandPack,
      hours: collectedBrandPack.hours.map((row) => ({ ...row, provenance: { ...row.provenance, retrievedAt: "2026-08-19" } })),
    });
    const differentDay = packFrom({ ...collectedBrandPack, hours: [{ ...collectedBrandPack.hours[0]!, hours: "Closed" }, collectedBrandPack.hours[1]!] });
    expect(new Set([base, fingerprintBrandPack(extraImage), fingerprintBrandPack(laterRetrieval), fingerprintBrandPack(differentDay)]).size).toBe(4);
  });

  it("changes when the same evidence is collected on a different day", () => {
    const later = normalizeBrandPack({
      collected: collectedBrandPack,
      restaurant: restaurantIdentity,
      officialWebsite: candidate.website,
      researchSources: candidate.sources.map((source) => source.url),
      now: new Date("2026-08-21T00:00:00.000Z"),
    });
    expect(fingerprintBrandPack(later)).not.toBe(fingerprintBrandPack(packFrom(collectedBrandPack)));
  });
});

describe("brand pack transport", () => {
  it("round-trips through the project artifact marker", () => {
    const pack = packFrom(collectedBrandPack);
    const parsed = parseBrandPack(`Project notes\n\n${brandPackMarker(pack)}\n\nMore notes`);
    expect(parsed).toEqual(pack);
    expect(fingerprintBrandPack(parsed!)).toBe(fingerprintBrandPack(pack));
    expect(brandPackParseFailed(brandPackMarker(pack))).toBe(false);
  });

  it("reports an absent pack as absent and a malformed one as broken", () => {
    expect(parseBrandPack(null)).toBeNull();
    expect(parseBrandPack("A project with no approved brand material.")).toBeNull();
    expect(brandPackParseFailed("A project with no approved brand material.")).toBe(false);

    const broken = '<!-- LYNQ_APPROVED_BRAND_PACK {"schemaVersion":1,"images":[{"id":"x"}]} -->';
    expect(parseBrandPack(broken)).toBeNull();
    expect(brandPackParseFailed(broken)).toBe(true);
    expect(brandPackParseFailed("<!-- LYNQ_APPROVED_BRAND_PACK {not json}")).toBe(true);
  });

  it("refuses evidence that is not served over https", () => {
    const insecure = brandPackMarker({
      ...packFrom(collectedBrandPack),
      images: [{ ...packFrom(collectedBrandPack).images[0]!, url: "http://cdn.example.ca/sumac/dining-room.jpg" }],
    });
    expect(brandPackParseFailed(insecure)).toBe(true);
  });

  it("builds an empty pack for a business with no evidence at all", () => {
    const pack = emptyBrandPack(restaurantIdentity, "2026-08-20");
    expect(pack.facts).toEqual([]);
    expect(fingerprintBrandPack(pack)).toMatch(/^[0-9a-f]{32}$/);
  });
});
