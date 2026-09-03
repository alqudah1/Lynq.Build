import { restaurantCandidateSchema, type RestaurantCandidate } from "../restaurant-research";
import {
  SERVICE_CAPABILITIES,
  usableBrandMaterial,
  type BrandPack,
  type Provenance,
  type ServiceCapability,
  type UsableBrandMaterial,
} from "./brand-pack";

/**
 * The evidence ledger is the only thing a generated website is allowed to
 * assert. Everything a visitor can read is either prose that survives the
 * claim guard, or a fact whose `evidenceKey` resolves here to the exact
 * same value. There is deliberately no path that lets a model contribute a
 * fact: the ledger is built from the founder-approved research plus the
 * approved brand pack, and nothing else.
 *
 * Every entry carries where it came from, when it was read and how
 * confident the collector was, so the founder-facing evidence table is a
 * projection of the ledger rather than a separate story about it.
 */

export { SERVICE_CAPABILITIES };
export type { ServiceCapability };

export type ApprovedAsset = UsableBrandMaterial["assets"][number];
export type ApprovedMenuCategory = UsableBrandMaterial["menu"][number];
export type ApprovedService = UsableBrandMaterial["services"][number];

export type EvidenceEntry = {
  key: string;
  /** Human label for the founder-facing evidence table. */
  label: string;
  value: string;
  sourceUrl: string | null;
  /** ISO date the source was read. Null for facts carried from the research itself. */
  retrievedAt: string | null;
  confidence: Provenance["confidence"] | "research";
};

export type SiteEvidence = {
  businessName: string;
  city: string;
  countryCode: "CA" | "JO";
  locale: "en" | "ar";
  identity: string;
  facts: Map<string, EvidenceEntry>;
  capabilities: Set<ServiceCapability>;
  assets: ApprovedAsset[];
  menu: ApprovedMenuCategory[];
  services: ApprovedService[];
  hours: Array<{ day: string; hours: string }>;
  brandSignals: string[];
  sources: Array<{ title: string; url: string; supports: string }>;
  /** Everything the research or the brand pack flagged as unverified, carried through to the founder. */
  uncertainties: string[];
};

export class MissingResearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingResearchError";
  }
}

function entry(key: string, label: string, value: string | null | undefined, sourceUrl: string | null): [string, EvidenceEntry] | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return null;
  return [key, { key, label, value: trimmed, sourceUrl, retrievedAt: null, confidence: "research" }];
}

function fromProvenance(key: string, label: string, value: string, provenance: Provenance): [string, EvidenceEntry] {
  return [key, { key, label, value, sourceUrl: provenance.sourceUrl, retrievedAt: provenance.retrievedAt, confidence: provenance.confidence }];
}

/**
 * `countryCode` is the only signal the research carries about language, and
 * it is a verified field. Jordanian prospects get an Arabic, RTL site.
 */
export function localeForCountry(countryCode: "CA" | "JO"): "en" | "ar" {
  return countryCode === "JO" ? "ar" : "en";
}

export function buildSiteEvidence(input: { candidate: unknown; brandPack?: BrandPack | null }): SiteEvidence {
  const parsed = restaurantCandidateSchema.safeParse(input.candidate);
  if (!parsed.success) {
    throw new MissingResearchError("The approved restaurant research is missing or does not match the verified research schema");
  }
  const candidate: RestaurantCandidate = parsed.data;
  const material: UsableBrandMaterial = input.brandPack
    ? usableBrandMaterial(input.brandPack)
    : { brandSignals: [], assets: [], menu: [], services: [], hours: [], facts: [] };
  const primarySource = candidate.sources[0]?.url ?? null;

  const facts = new Map<string, EvidenceEntry>();
  for (const item of [
    entry("business.name", "Business name", candidate.name, candidate.website ?? primarySource),
    entry("business.address", "Address", candidate.address, primarySource),
    entry("business.city", "City", candidate.city, primarySource),
    entry("business.phone", "Phone", candidate.phone, primarySource),
    entry("business.email", "Email", candidate.email, primarySource),
    entry("business.website", "Current website", candidate.website, candidate.website),
    entry("business.rating", "Public rating", candidate.rating === null ? null : candidate.rating.toFixed(1), primarySource),
    entry("business.reviews", "Public review count", candidate.reviews === null ? null : String(candidate.reviews), primarySource),
  ]) {
    if (item) facts.set(item[0], item[1]);
  }
  // Brand-pack facts are additional detail about the same business, never
  // a replacement for a researched identity fact: the research is what the
  // founder approved the prospect on.
  for (const fact of material.facts) {
    if (facts.has(fact.key)) continue;
    const [key, value] = fromProvenance(fact.key, fact.label, fact.value, fact.provenance);
    facts.set(key, value);
  }
  material.hours.forEach((row, index) => {
    const [key, value] = fromProvenance(`hours.${index}`, `Hours — ${row.day}`, `${row.day}: ${row.hours}`, row.provenance);
    facts.set(key, value);
  });
  material.services.forEach((service) => {
    const [key, value] = fromProvenance(`service.${service.capability}`, `Service — ${service.label}`, service.label, service.provenance);
    facts.set(key, value);
  });
  material.menu.forEach((category, index) => {
    const [key, value] = fromProvenance(`menu.${index}`, `Menu category — ${category.name}`, category.name, category.provenance);
    facts.set(key, value);
  });

  return {
    businessName: candidate.name,
    city: candidate.city,
    countryCode: candidate.countryCode,
    locale: localeForCountry(candidate.countryCode),
    identity: `${candidate.name} · ${candidate.city} · ${candidate.countryCode}`,
    facts,
    capabilities: new Set(material.services.map((service) => service.capability)),
    assets: material.assets,
    menu: material.menu,
    services: material.services,
    hours: material.hours.map((row) => ({ day: row.day, hours: row.hours })),
    brandSignals: material.brandSignals,
    sources: candidate.sources,
    uncertainties: [],
  };
}

/** The founder-facing evidence table: every fact the site may show, where it came from, when, and how sure. */
export function renderEvidenceTable(evidence: SiteEvidence): string {
  const rows = [...evidence.facts.values()].map((item) =>
    [
      "",
      item.label,
      item.value.replace(/\|/g, "\\|"),
      item.sourceUrl ? `[source](${item.sourceUrl})` : "Approved research",
      item.retrievedAt ?? "With the research",
      item.confidence === "research" ? "Approved research" : item.confidence,
      "",
    ].join(" | ").trim(),
  );
  return ["| Fact | Value | Source | Retrieved | Confidence |", "| --- | --- | --- | --- | --- |", ...rows].join("\n");
}
