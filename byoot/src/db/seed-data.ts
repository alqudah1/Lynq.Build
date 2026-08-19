/**
 * Pure, DB-free synthetic data generation — separated from seed.ts
 * specifically so the "does this actually include the messy real-world
 * cases" claim is unit-testable without a database (see seed-data.test.ts).
 *
 * Hard rule, per the task that created this scaffold: no real TRREB data
 * anywhere in this repo, in any environment, ever. Every value below is
 * either a fixed, obviously-fictional constant or randomly generated —
 * never scraped, copied, or derived from a real listing. MLS numbers are
 * prefixed `SYN-` specifically so a synthetic row can never be confused
 * with (or accidentally matched against) a real TRREB ListingKey.
 */

const ONTARIO_CITIES = [
  "Toronto",
  "Oakville",
  "Hamilton",
  "Kitchener",
  "Waterloo",
  "Niagara Falls",
  "Oshawa",
  "Whitby",
  "Ajax",
  "Pickering",
  "St. Catharines",
  "Burlington",
];

const STREET_NAMES = ["Maple", "King", "Queen", "Elm", "Birch", "Cedar", "Lakeshore", "Highland", "Sunset", "River"];
const STREET_SUFFIXES = ["St", "Ave", "Rd", "Blvd", "Crescent", "Court", "Terrace"];

const PROPERTY_TYPES = [
  "Detached",
  "Semi-Detached",
  "Condo",
  "Townhome",
  "Multi-Family",
  "Land",
  "Commercial",
  "Industrial",
  "MobileTrailer",
  "Other",
] as const;

const STATUSES = ["Active", "Pending", "Sold", "Off-Market"] as const;

const BROKERAGES = [
  "Northern Gate Realty Inc., Brokerage",
  "Lakeview Properties Ltd., Brokerage",
  "Harbourfront Realty Corp., Brokerage",
  "Golden Horseshoe Realty Inc., Brokerage",
];

function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** A small, seedable PRNG (mulberry32) — deterministic across runs given the same seed, so seed data is reproducible for local dev without needing to persist a random state. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SyntheticListing {
  mlsNumber: string;
  title: string;
  address: string;
  city: string | null;
  province: string;
  postalCode: string | null;
  price: number;
  beds: number;
  baths: number;
  propertyType: (typeof PROPERTY_TYPES)[number];
  status: (typeof STATUSES)[number];
  description: string | null;
  yearBuilt: number | null;
  lotSize: string | null;
  parking: number | null;
  garageSpaces: number | null;
  style: string | null;
  listOfficeName: string;
  sqft: number | null;
  images: string[];
  source: "synthetic";
}

/**
 * Deliberately messy real-world cases, generated at fixed intervals rather
 * than left to chance — this is the actual point of the exercise (per the
 * task: "deliberately include the messy real-world cases"), so coverage
 * shouldn't depend on the RNG happening to produce them.
 */
export function generateSyntheticListings(count: number, seed = 42): SyntheticListing[] {
  const rng = mulberry32(seed);
  const listings: SyntheticListing[] = [];

  for (let i = 0; i < count; i++) {
    const streetNum = 1 + Math.floor(rng() * 999);
    const street = `${streetNum} ${pick(STREET_NAMES, rng)} ${pick(STREET_SUFFIXES, rng)}`;
    const city = pick(ONTARIO_CITIES, rng);
    const propertyType = pick(PROPERTY_TYPES, rng);
    const status = pick(STATUSES, rng);

    const hasNoPhotos = i % 7 === 0;
    const hasNoDescription = i % 11 === 0;
    const isExtremeLowPrice = i % 23 === 0;
    const isExtremeHighPrice = i % 29 === 0;
    const hasVeryLongAddress = i % 31 === 0;
    const isMissingOptionalFields = i % 5 === 0;

    const basePrice = 350_000 + Math.floor(rng() * 1_400_000);
    const price = isExtremeLowPrice ? 1 : isExtremeHighPrice ? 38_500_000 : basePrice;

    const address = hasVeryLongAddress
      ? `${street}, Unit 1204B, Building 3, Phase II, Northgate Estates Master-Planned Community, RR#4`
      : street;

    listings.push({
      mlsNumber: `SYN-${String(i + 1).padStart(6, "0")}`,
      title: `${propertyType} in ${city}`,
      address,
      // Every ~40th listing has no city at all — the client's own audit
      // found `city` can be null when the feed's normalization misses an
      // unrecognized sub-area; worth reproducing, not assuming away.
      city: i % 40 === 0 ? null : city,
      province: "ON",
      postalCode: i % 13 === 0 ? null : `${String.fromCharCode(65 + (i % 26))}${1 + (i % 9)}${String.fromCharCode(65 + ((i + 3) % 26))} ${1 + (i % 9)}${String.fromCharCode(65 + ((i + 5) % 26))}${1 + (i % 9)}`,
      price,
      beds: propertyType === "Land" ? 0 : 1 + Math.floor(rng() * 5),
      baths: propertyType === "Land" ? 0 : 1 + Math.floor(rng() * 4),
      propertyType,
      status,
      description: hasNoDescription
        ? null
        : `Synthetic fixture listing. A ${propertyType.toLowerCase()} property in ${city}. Not a real property; do not use for anything beyond local development.`,
      yearBuilt: isMissingOptionalFields ? null : 1960 + Math.floor(rng() * 65),
      lotSize: isMissingOptionalFields ? null : `${(0.1 + rng() * 0.8).toFixed(2)} acres`,
      parking: isMissingOptionalFields ? null : Math.floor(rng() * 4),
      garageSpaces: isMissingOptionalFields ? null : Math.floor(rng() * 3),
      style: isMissingOptionalFields ? null : pick(["2-Storey", "Bungalow", "Sidesplit", "Backsplit", "1.5-Storey"], rng),
      // Required at the schema level (see schema.ts's comment on
      // listOfficeName) — the generator never omits it, which is itself
      // part of proving the schema constraint is meaningful: every
      // synthetic row satisfies it, same as a correct real sync must.
      listOfficeName: pick(BROKERAGES, rng),
      sqft: isMissingOptionalFields ? null : 600 + Math.floor(rng() * 4000),
      // Seeded, not crypto.randomUUID() — every value here must derive from
      // the same `rng()` so generateSyntheticListings stays deterministic
      // for a given seed (see the "is deterministic" test in
      // seed-data.test.ts, which caught this exact mistake once already).
      images: hasNoPhotos
        ? []
        : Array.from({ length: 1 + Math.floor(rng() * 8) }, () => `https://picsum.photos/seed/${i}-${Math.floor(rng() * 1_000_000_000)}/800/600`),
      source: "synthetic",
    });
  }

  return listings;
}

export interface SyntheticVowRecord {
  soldPrice: number | null;
  soldDate: Date | null;
  priceHistory: Array<{ date: string; price: number; event: string }>;
  domHistorical: number | null;
}

/** Generates a plausible VOW record for a listing whose status is "Sold" — for all other statuses, no VOW row should be created (a listing that never sold has no sold data, not a null-filled one). */
export function generateSyntheticVowRecord(listing: SyntheticListing, seed: number): SyntheticVowRecord {
  const rng = mulberry32(seed);
  const soldPrice = Math.round(listing.price * (0.92 + rng() * 0.1));
  const soldDate = new Date(2025, Math.floor(rng() * 12), 1 + Math.floor(rng() * 28));

  return {
    soldPrice,
    soldDate,
    priceHistory: [
      { date: new Date(soldDate.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString(), price: Math.round(soldPrice * 1.05), event: "listed" },
      { date: soldDate.toISOString(), price: soldPrice, event: "sold" },
    ],
    domHistorical: 5 + Math.floor(rng() * 90),
  };
}
