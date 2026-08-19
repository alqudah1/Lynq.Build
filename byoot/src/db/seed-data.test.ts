import { describe, it, expect } from "vitest";
import { generateSyntheticListings } from "./seed-data";

/**
 * Proves the generator actually includes the messy real-world cases the
 * task required — not by inspection, but by assertion, so a future edit
 * that accidentally removes an edge case is caught here rather than
 * discovered later as a UI bug against real data.
 */
describe("generateSyntheticListings — messy real-world case coverage", () => {
  const listings = generateSyntheticListings(300);

  it("generates the requested count, all with a non-empty required listOfficeName", () => {
    expect(listings).toHaveLength(300);
    expect(listings.every((l) => l.listOfficeName.length > 0)).toBe(true);
  });

  it("includes listings with no photos at all", () => {
    expect(listings.some((l) => l.images.length === 0)).toBe(true);
  });

  it("includes listings with a missing description", () => {
    expect(listings.some((l) => l.description === null)).toBe(true);
  });

  it("includes an extreme low price and an extreme high price", () => {
    expect(listings.some((l) => l.price < 100)).toBe(true);
    expect(listings.some((l) => l.price > 30_000_000)).toBe(true);
  });

  it("includes a very long address", () => {
    expect(listings.some((l) => l.address.length > 60)).toBe(true);
  });

  it("includes listings missing optional RESO-derived fields (year built, lot size, parking, garage, style, sqft)", () => {
    expect(listings.some((l) => l.yearBuilt === null)).toBe(true);
    expect(listings.some((l) => l.lotSize === null)).toBe(true);
    expect(listings.some((l) => l.parking === null)).toBe(true);
    expect(listings.some((l) => l.garageSpaces === null)).toBe(true);
    expect(listings.some((l) => l.style === null)).toBe(true);
    expect(listings.some((l) => l.sqft === null)).toBe(true);
  });

  it("includes unusual property types, not just Detached/Condo", () => {
    const types = new Set(listings.map((l) => l.propertyType));
    expect(types.has("Land")).toBe(true);
    expect(types.has("MobileTrailer")).toBe(true);
    expect(types.has("Industrial")).toBe(true);
  });

  it("includes listings with a missing city and a missing postal code", () => {
    expect(listings.some((l) => l.city === null)).toBe(true);
    expect(listings.some((l) => l.postalCode === null)).toBe(true);
  });

  it("never produces a real-looking MLS number — every one is SYN-prefixed", () => {
    expect(listings.every((l) => l.mlsNumber.startsWith("SYN-"))).toBe(true);
  });

  it("is deterministic for a given seed, so local dev data is reproducible", () => {
    const again = generateSyntheticListings(300);
    expect(again).toEqual(listings);
  });
});
