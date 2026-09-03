import { z } from "zod";
import { restaurantCandidateSchema, type RestaurantCandidate } from "../restaurant-research";

/**
 * The evidence ledger is the only thing a generated website is allowed to
 * assert. Everything a visitor can read is either prose that survives the
 * claim guard, or a fact whose `evidenceKey` resolves here to the exact
 * same value. There is deliberately no path that lets a model contribute a
 * fact: the ledger is built from the founder-approved research plus an
 * explicitly approved brand pack, and nothing else.
 */

const httpsUrl = z
  .string()
  .url()
  .max(2000)
  .refine((value) => value.startsWith("https://"), { message: "Approved assets and sources must be https" });

export const approvedAssetSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,40}$/, "Asset ids are lowercase slugs"),
  url: httpsUrl,
  /** Written by a human or carried from the approved source; never invented at generation time. */
  alt: z.string().trim().min(4).max(300),
  kind: z.enum(["photo", "logo", "illustration"]),
  credit: z.string().trim().max(200).nullable().default(null),
  sourceUrl: httpsUrl,
});
export type ApprovedAsset = z.infer<typeof approvedAssetSchema>;

export const approvedMenuItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(400).nullable().default(null),
  /** Only ever a price that was verified on a public source. */
  price: z.string().trim().max(40).nullable().default(null),
});

export const approvedMenuCategorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(400).nullable().default(null),
  items: z.array(approvedMenuItemSchema).min(1).max(24),
  sourceUrl: httpsUrl,
});
export type ApprovedMenuCategory = z.infer<typeof approvedMenuCategorySchema>;

/** A capability the business demonstrably offers. Anything absent here may not be claimed on the page. */
export const SERVICE_CAPABILITIES = [
  "dine-in",
  "takeaway",
  "delivery",
  "reservation",
  "online-order",
  "catering",
  "events",
  "gift-cards",
] as const;
export type ServiceCapability = (typeof SERVICE_CAPABILITIES)[number];

export const approvedServiceSchema = z.object({
  capability: z.enum(SERVICE_CAPABILITIES),
  label: z.string().trim().min(2).max(80),
  detail: z.string().trim().max(300).nullable().default(null),
  sourceUrl: httpsUrl,
});
export type ApprovedService = z.infer<typeof approvedServiceSchema>;

export const approvedHoursSchema = z.object({
  day: z.string().trim().min(1).max(40),
  hours: z.string().trim().min(1).max(80),
});

export const brandPackSchema = z.object({
  /** Words the business already uses about itself, carried verbatim from public sources. */
  brandSignals: z.array(z.string().trim().min(1).max(200)).max(12).default([]),
  assets: z.array(approvedAssetSchema).max(12).default([]),
  menu: z.array(approvedMenuCategorySchema).max(10).default([]),
  services: z.array(approvedServiceSchema).max(10).default([]),
  hours: z.array(approvedHoursSchema).max(14).default([]),
  sourceUrl: httpsUrl.nullable().default(null),
});
export type BrandPack = z.infer<typeof brandPackSchema>;

export const EMPTY_BRAND_PACK: BrandPack = {
  brandSignals: [],
  assets: [],
  menu: [],
  services: [],
  hours: [],
  sourceUrl: null,
};

const BRAND_PACK_START = "<!-- LYNQ_APPROVED_BRAND_PACK ";
const BRAND_PACK_END = " -->";

export function brandPackMarker(pack: BrandPack): string {
  return `${BRAND_PACK_START}${JSON.stringify(pack)}${BRAND_PACK_END}`;
}

/**
 * Absent or malformed brand material is not an error — it is a smaller
 * ledger, and the site is expected to be honest about what it does not
 * have. Callers distinguish the two cases through `brandPackParseFailed`.
 */
export function parseBrandPack(content: string | null): BrandPack {
  if (!content) return EMPTY_BRAND_PACK;
  const start = content.lastIndexOf(BRAND_PACK_START);
  if (start < 0) return EMPTY_BRAND_PACK;
  const end = content.indexOf(BRAND_PACK_END, start + BRAND_PACK_START.length);
  if (end < 0) return EMPTY_BRAND_PACK;
  const parsed = brandPackSchema.safeParse(safeJson(content.slice(start + BRAND_PACK_START.length, end)));
  return parsed.success ? parsed.data : EMPTY_BRAND_PACK;
}

export function brandPackParseFailed(content: string | null): boolean {
  if (!content) return false;
  const start = content.lastIndexOf(BRAND_PACK_START);
  if (start < 0) return false;
  const end = content.indexOf(BRAND_PACK_END, start + BRAND_PACK_START.length);
  if (end < 0) return true;
  return !brandPackSchema.safeParse(safeJson(content.slice(start + BRAND_PACK_START.length, end))).success;
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* The ledger                                                          */
/* ------------------------------------------------------------------ */

export type EvidenceEntry = {
  key: string;
  /** Human label for the founder-facing evidence table. */
  label: string;
  value: string;
  sourceUrl: string | null;
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
  /** Everything the research itself flagged as unverified, carried through to the founder. */
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
  return [key, { key, label, value: trimmed, sourceUrl }];
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
  const pack = input.brandPack ?? EMPTY_BRAND_PACK;
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
  pack.hours.forEach((row, index) => {
    facts.set(`hours.${index}`, { key: `hours.${index}`, label: `Hours — ${row.day}`, value: `${row.day}: ${row.hours}`, sourceUrl: pack.sourceUrl });
  });
  pack.services.forEach((service) => {
    facts.set(`service.${service.capability}`, {
      key: `service.${service.capability}`,
      label: `Service — ${service.label}`,
      value: service.label,
      sourceUrl: service.sourceUrl,
    });
  });
  pack.menu.forEach((category, index) => {
    facts.set(`menu.${index}`, { key: `menu.${index}`, label: `Menu category — ${category.name}`, value: category.name, sourceUrl: category.sourceUrl });
  });

  return {
    businessName: candidate.name,
    city: candidate.city,
    countryCode: candidate.countryCode,
    locale: localeForCountry(candidate.countryCode),
    identity: `${candidate.name} · ${candidate.city} · ${candidate.countryCode}`,
    facts,
    capabilities: new Set(pack.services.map((service) => service.capability)),
    assets: pack.assets,
    menu: pack.menu,
    services: pack.services,
    hours: pack.hours,
    brandSignals: pack.brandSignals,
    sources: candidate.sources,
    uncertainties: [],
  };
}

/** The founder-facing evidence table: every fact the site may show, and where it came from. */
export function renderEvidenceTable(evidence: SiteEvidence): string {
  const rows = [...evidence.facts.values()].map(
    (item) => `| ${item.label} | ${item.value.replace(/\|/g, "\\|")} | ${item.sourceUrl ? `[source](${item.sourceUrl})` : "Approved research"} |`,
  );
  return ["| Fact | Value | Evidence |", "| --- | --- | --- |", ...rows].join("\n");
}
