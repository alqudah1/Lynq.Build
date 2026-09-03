import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * The brand pack is the evidence a prospect's website is built from, and
 * it is deliberately shaped so that a fact cannot exist without a source.
 *
 * Three properties carry the weight:
 *
 *  1. **Provenance is mandatory.** Every fact, image, menu category,
 *     service and opening-hours row names the URL it came from, the day it
 *     was retrieved and how confident the collector was. There is no field
 *     a collector can fill without saying where it got it.
 *  2. **Nothing is silently filled.** Normalisation drops what it cannot
 *     stand behind and records *why* in `rejected`, so a founder sees the
 *     gap rather than a plausible-looking guess. Sources that disagree
 *     produce a conflict and the fact becomes unusable — the code never
 *     picks a winner.
 *  3. **A version is a content fingerprint.** Approval binds to the
 *     fingerprint, so changing so much as one retrieval date produces a
 *     different pack that the previous approval no longer covers.
 */

const httpsUrl = z
  .string()
  .url()
  .max(2000)
  .refine((value) => value.startsWith("https://"), { message: "Evidence sources and images must be https" });

export const SOURCE_TYPES = ["official_website", "official_social", "public_menu", "public_listing", "founder_supplied"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** Only `verified` material may appear on a generated page. Everything else is shown to the founder as uncertain. */
export const CONFIDENCE_LEVELS = ["verified", "reported", "uncertain"] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

/** Hosts that count as an official social profile. A profile anywhere else is not evidence. */
export const SOCIAL_HOSTS = [
  "instagram.com",
  "facebook.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "youtube.com",
  "linkedin.com",
] as const;

export const provenanceSchema = z.object({
  sourceUrl: httpsUrl,
  sourceType: z.enum(SOURCE_TYPES),
  /** ISO date the page was read. A pack is only as current as this says it is. */
  retrievedAt: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z)?$/, "Retrieval dates are ISO dates"),
  confidence: z.enum(CONFIDENCE_LEVELS),
  /** How the value was observed, in the collector's own words. */
  note: z.string().trim().max(300).nullable().default(null),
});
export type Provenance = z.infer<typeof provenanceSchema>;

export const evidenceFactSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9.]{1,60}$/, "Fact keys are dotted lowercase paths"),
  label: z.string().trim().min(2).max(120),
  value: z.string().trim().min(1).max(400),
  provenance: provenanceSchema,
});
export type EvidenceFact = z.infer<typeof evidenceFactSchema>;

export const brandImageSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,40}$/, "Image ids are lowercase slugs"),
  url: httpsUrl,
  /** Carried from the source page or written by a person; never invented at generation time. */
  alt: z.string().trim().min(4).max(300),
  kind: z.enum(["photo", "logo", "illustration"]),
  credit: z.string().trim().max(200).nullable().default(null),
  provenance: provenanceSchema,
});
export type BrandImage = z.infer<typeof brandImageSchema>;

export const menuItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(400).nullable().default(null),
  price: z.string().trim().max(40).nullable().default(null),
});

export const menuCategorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(400).nullable().default(null),
  items: z.array(menuItemSchema).min(1).max(24),
  provenance: provenanceSchema,
});
export type BrandMenuCategory = z.infer<typeof menuCategorySchema>;

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

export const brandServiceSchema = z.object({
  capability: z.enum(SERVICE_CAPABILITIES),
  label: z.string().trim().min(2).max(80),
  detail: z.string().trim().max(300).nullable().default(null),
  provenance: provenanceSchema,
});
export type BrandService = z.infer<typeof brandServiceSchema>;

export const brandHoursSchema = z.object({
  day: z.string().trim().min(1).max(40),
  hours: z.string().trim().min(1).max(80),
  provenance: provenanceSchema,
});
export type BrandHours = z.infer<typeof brandHoursSchema>;

export const socialProfileSchema = z.object({
  platform: z.string().trim().min(2).max(40),
  url: httpsUrl,
  provenance: provenanceSchema,
});

export const brandSignalSchema = z.object({
  phrase: z.string().trim().min(1).max(200),
  provenance: provenanceSchema,
});

/** Two sources said different things. Neither is used, and the founder is told. */
export const sourceConflictSchema = z.object({
  key: z.string().trim().min(1).max(120),
  label: z.string().trim().min(2).max(120),
  values: z.array(z.object({ value: z.string().trim().min(1).max(400), sourceUrl: z.string().max(2000) })).min(2).max(6),
});
export type SourceConflict = z.infer<typeof sourceConflictSchema>;

/** Seen but not confirmed. Recorded so the founder can decide, never used on a page. */
export const uncertainClaimSchema = z.object({
  label: z.string().trim().min(2).max(160),
  detail: z.string().trim().min(2).max(400),
  sourceUrl: z.string().max(2000).nullable(),
  reason: z.string().trim().min(2).max(200),
});
export type UncertainClaim = z.infer<typeof uncertainClaimSchema>;

/** Material the collector offered and normalisation refused, with the reason. */
export const rejectedEvidenceSchema = z.object({
  kind: z.enum(["fact", "image", "menu", "service", "hours", "social", "signal"]),
  label: z.string().trim().min(1).max(200),
  sourceUrl: z.string().max(2000).nullable(),
  reason: z.string().trim().min(2).max(200),
});
export type RejectedEvidence = z.infer<typeof rejectedEvidenceSchema>;

export const brandPackSchema = z.object({
  schemaVersion: z.literal(1),
  restaurant: z.object({
    name: z.string().trim().min(1).max(200),
    address: z.string().trim().min(1).max(500),
    city: z.string().trim().min(1).max(200),
    countryCode: z.enum(["CA", "JO"]),
  }),
  collectedAt: z.string().trim().min(4).max(40),
  facts: z.array(evidenceFactSchema).max(40).default([]),
  images: z.array(brandImageSchema).max(12).default([]),
  menu: z.array(menuCategorySchema).max(10).default([]),
  services: z.array(brandServiceSchema).max(10).default([]),
  hours: z.array(brandHoursSchema).max(14).default([]),
  socials: z.array(socialProfileSchema).max(8).default([]),
  brandSignals: z.array(brandSignalSchema).max(12).default([]),
  conflicts: z.array(sourceConflictSchema).max(20).default([]),
  uncertain: z.array(uncertainClaimSchema).max(30).default([]),
  rejected: z.array(rejectedEvidenceSchema).max(40).default([]),
});
export type BrandPack = z.infer<typeof brandPackSchema>;

/* ------------------------------------------------------------------ */
/* Versioning                                                          */
/* ------------------------------------------------------------------ */

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

/**
 * The immutable identity of one exact set of evidence. Key order and
 * whitespace cannot change it; a single altered character anywhere in the
 * evidence does. Approvals bind to this, so re-collecting evidence after
 * approval invalidates that approval by construction rather than by
 * anybody remembering to check.
 */
export function fingerprintBrandPack(pack: BrandPack): string {
  return createHash("sha256").update(canonical(pack)).digest("hex").slice(0, 32);
}

export const EMPTY_BRAND_PACK_INPUT = {
  facts: [],
  images: [],
  menu: [],
  services: [],
  hours: [],
  socials: [],
  brandSignals: [],
  uncertain: [],
} as const;

export function emptyBrandPack(restaurant: BrandPack["restaurant"], collectedAt: string): BrandPack {
  return {
    schemaVersion: 1,
    restaurant,
    collectedAt,
    facts: [],
    images: [],
    menu: [],
    services: [],
    hours: [],
    socials: [],
    brandSignals: [],
    conflicts: [],
    uncertain: [],
    rejected: [],
  };
}

/* ------------------------------------------------------------------ */
/* Collection input                                                    */
/* ------------------------------------------------------------------ */

/** What a collector may propose. Normalisation decides what survives. */
export const collectedBrandPackSchema = z.object({
  facts: z.array(evidenceFactSchema).max(60).default([]),
  images: z.array(brandImageSchema).max(20).default([]),
  menu: z.array(menuCategorySchema).max(14).default([]),
  services: z.array(brandServiceSchema).max(14).default([]),
  hours: z.array(brandHoursSchema).max(20).default([]),
  socials: z.array(socialProfileSchema).max(10).default([]),
  brandSignals: z.array(brandSignalSchema).max(16).default([]),
  uncertain: z.array(uncertainClaimSchema).max(30).default([]),
});
export type CollectedBrandPack = z.infer<typeof collectedBrandPackSchema>;

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

export function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function normalizedSourceUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.toString();
  } catch {
    return null;
  }
}

type EvidenceSourcePolicy = {
  approvedHosts: Set<string>;
  approvedExactUrls: Set<string>;
  approvedSocialUrls: Set<string>;
  officialHost: string | null;
};

function isSocialHost(host: string): boolean {
  return SOCIAL_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function normalizeValue(value: string): string {
  return value.trim().toLocaleLowerCase("en-CA").replace(/\s+/g, " ");
}

export type NormalizeInput = {
  collected: CollectedBrandPack;
  restaurant: BrandPack["restaurant"];
  /** The prospect's official website, when the research verified one. */
  officialWebsite: string | null;
  /** URLs the research already cited for this prospect. */
  researchSources: string[];
  /** Injected so a pack is reproducible in tests and stamped honestly in production. */
  now: Date;
};

/**
 * Turn what a collector proposed into evidence the pipeline is willing to
 * stand behind. Everything refused is recorded rather than dropped
 * silently, because "we could not verify the opening hours" is useful to a
 * founder and an invented opening hour is not.
 */
export function normalizeBrandPack(input: NormalizeInput): BrandPack {
  const pack = emptyBrandPack(input.restaurant, input.now.toISOString().slice(0, 10));
  const approvedHosts = new Set<string>();
  const officialHost = input.officialWebsite ? hostOf(input.officialWebsite) : null;
  if (officialHost) approvedHosts.add(officialHost);
  const approvedExactUrls = new Set<string>();
  const approvedSocialUrls = new Set<string>();
  if (input.officialWebsite) {
    const normalized = normalizedSourceUrl(input.officialWebsite);
    if (normalized) approvedExactUrls.add(normalized);
  }
  for (const source of input.researchSources) {
    const host = hostOf(source);
    if (host) approvedHosts.add(host);
    const normalized = normalizedSourceUrl(source);
    if (normalized) {
      approvedExactUrls.add(normalized);
      if (host && isSocialHost(host)) approvedSocialUrls.add(normalized);
    }
  }
  const sourcePolicy: EvidenceSourcePolicy = { approvedHosts, approvedExactUrls, approvedSocialUrls, officialHost };
  // An official social profile becomes an approved source only when it is
  // on a real social host; a "profile" on someone's blog is not one.
  for (const social of input.collected.socials) {
    const host = hostOf(social.url);
    if (!host || !isSocialHost(host)) {
      pack.rejected.push({ kind: "social", label: social.platform, sourceUrl: social.url, reason: "Not a recognised social platform" });
      continue;
    }
    if (!isUsable(social.provenance, sourcePolicy, input.now)) {
      pack.rejected.push({ kind: "social", label: social.platform, sourceUrl: social.url, reason: rejectionReason(social.provenance, sourcePolicy, input.now) });
      continue;
    }
    approvedHosts.add(host);
    const normalized = normalizedSourceUrl(social.url);
    if (normalized) approvedSocialUrls.add(normalized);
    pack.socials.push(social);
  }

  const keep = <T extends { provenance: Provenance }>(
    items: T[],
    kind: RejectedEvidence["kind"],
    label: (item: T) => string,
  ): T[] => {
    const kept: T[] = [];
    for (const item of items) {
      if (isUsable(item.provenance, sourcePolicy, input.now)) kept.push(item);
      else pack.rejected.push({ kind, label: label(item), sourceUrl: item.provenance.sourceUrl, reason: rejectionReason(item.provenance, sourcePolicy, input.now) });
    }
    return kept;
  };

  // Facts are the only material where two sources can contradict each
  // other on the same key, so they get the conflict pass.
  const factCandidates = keep(input.collected.facts, "fact", (item) => item.label);
  const byKey = new Map<string, EvidenceFact[]>();
  for (const fact of factCandidates) byKey.set(fact.key, [...(byKey.get(fact.key) ?? []), fact]);
  for (const [key, facts] of byKey) {
    const distinct = new Map<string, EvidenceFact>();
    for (const fact of facts) if (!distinct.has(normalizeValue(fact.value))) distinct.set(normalizeValue(fact.value), fact);
    if (distinct.size === 1) {
      pack.facts.push([...distinct.values()][0]!);
      continue;
    }
    const values = [...distinct.values()];
    pack.conflicts.push({
      key,
      label: values[0]!.label,
      values: values.slice(0, 6).map((fact) => ({ value: fact.value, sourceUrl: fact.provenance.sourceUrl })),
    });
    pack.uncertain.push({
      label: values[0]!.label,
      detail: `Sources disagree: ${values.map((fact) => `"${fact.value}"`).join(" vs ")}`,
      sourceUrl: values[0]!.provenance.sourceUrl,
      reason: "Conflicting sources, so nothing is shown",
    });
  }

  for (const image of input.collected.images) {
    if (!isUsable(image.provenance, sourcePolicy, input.now)) {
      pack.rejected.push({ kind: "image", label: image.alt, sourceUrl: image.provenance.sourceUrl, reason: rejectionReason(image.provenance, sourcePolicy, input.now) });
      continue;
    }
    // An image may only come from the business's own site or social
    // profile. A photograph found on a listing or a stock library is
    // somebody else's to license, and is never used.
    if (image.provenance.sourceType !== "official_website" && image.provenance.sourceType !== "official_social") {
      pack.rejected.push({ kind: "image", label: image.alt, sourceUrl: image.provenance.sourceUrl, reason: "Images may only come from the business's own website or social profile" });
      continue;
    }
    if (pack.images.some((existing) => existing.id === image.id || existing.url === image.url)) {
      pack.rejected.push({ kind: "image", label: image.alt, sourceUrl: image.provenance.sourceUrl, reason: "Duplicate image" });
      continue;
    }
    pack.images.push(image);
  }

  pack.menu.push(...dedupe(keep(input.collected.menu, "menu", (item) => item.name), (item) => normalizeValue(item.name)));
  pack.hours.push(...dedupe(keep(input.collected.hours, "hours", (item) => item.day), (item) => normalizeValue(item.day)));
  pack.brandSignals.push(...dedupe(keep(input.collected.brandSignals, "signal", (item) => item.phrase), (item) => normalizeValue(item.phrase)));

  const services = keep(input.collected.services, "service", (item) => item.label);
  const byCapability = new Map<ServiceCapability, BrandService[]>();
  for (const service of services) byCapability.set(service.capability, [...(byCapability.get(service.capability) ?? []), service]);
  for (const [capability, group] of byCapability) {
    const distinct = new Map<string, BrandService>();
    for (const service of group) if (!distinct.has(normalizeValue(service.label))) distinct.set(normalizeValue(service.label), service);
    if (distinct.size === 1) {
      pack.services.push([...distinct.values()][0]!);
      continue;
    }
    const values = [...distinct.values()];
    pack.conflicts.push({
      key: `service.${capability}`,
      label: `Service — ${capability}`,
      values: values.slice(0, 6).map((service) => ({ value: service.label, sourceUrl: service.provenance.sourceUrl })),
    });
    pack.uncertain.push({
      label: `Service — ${capability}`,
      detail: `Sources describe this service differently: ${values.map((service) => `"${service.label}"`).join(" vs ")}`,
      sourceUrl: values[0]!.provenance.sourceUrl,
      reason: "Conflicting sources, so the service is not offered on the page",
    });
  }

  pack.uncertain.push(...input.collected.uncertain);
  // Anything refused is also uncertainty the founder should see, phrased
  // as what is missing rather than as a technical rejection.
  for (const item of pack.rejected) {
    pack.uncertain.push({ label: item.label.slice(0, 160), detail: `Not used: ${item.reason}`, sourceUrl: item.sourceUrl, reason: item.reason });
  }
  pack.uncertain = pack.uncertain.slice(0, 30);
  return brandPackSchema.parse(pack);
}

function dedupe<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const item of items) {
    const identity = key(item);
    if (seen.has(identity)) continue;
    seen.add(identity);
    kept.push(item);
  }
  return kept;
}

function isUsable(provenance: Provenance, policy: EvidenceSourcePolicy, now: Date): boolean {
  return rejectionReason(provenance, policy, now) === "";
}

function rejectionReason(provenance: Provenance, policy: EvidenceSourcePolicy, now: Date): string {
  if (provenance.confidence !== "verified") return `Confidence was "${provenance.confidence}" rather than verified`;
  const host = hostOf(provenance.sourceUrl);
  if (!host) return "Source URL could not be read";
  if (!policy.approvedHosts.has(host)) return `Source ${host} is not one of the approved sources for this business`;
  const normalized = normalizedSourceUrl(provenance.sourceUrl);
  if (!normalized) return "Source URL could not be read";
  if (provenance.sourceType === "official_website" && host !== policy.officialHost) {
    return "The page is not on the business's official website";
  }
  if (provenance.sourceType === "official_social" && !policy.approvedSocialUrls.has(normalized)) {
    return "The page is not the business's approved social profile";
  }
  if (
    (provenance.sourceType === "public_listing" || provenance.sourceType === "founder_supplied")
    && !policy.approvedExactUrls.has(normalized)
  ) {
    return "The exact source page was not approved for this business";
  }
  if (
    provenance.sourceType === "public_menu"
    && host !== policy.officialHost
    && !policy.approvedExactUrls.has(normalized)
  ) {
    return "The exact menu page was not approved for this business";
  }
  const retrieved = new Date(provenance.retrievedAt);
  if (Number.isNaN(retrieved.getTime())) return "Retrieval date could not be read";
  // A day of slack absorbs time-zone differences between a collector and
  // this process; anything beyond that is not a retrieval, it is a guess.
  if (retrieved.getTime() > now.getTime() + 36 * 3600 * 1000) return "Retrieval date is in the future";
  return "";
}

/* ------------------------------------------------------------------ */
/* The usable view                                                     */
/* ------------------------------------------------------------------ */

export type UsableBrandMaterial = {
  brandSignals: string[];
  assets: Array<{ id: string; url: string; alt: string; kind: BrandImage["kind"]; credit: string | null; sourceUrl: string; provenance: Provenance }>;
  menu: Array<{ name: string; description: string | null; items: BrandMenuCategory["items"]; sourceUrl: string; provenance: Provenance }>;
  services: Array<{ capability: ServiceCapability; label: string; detail: string | null; sourceUrl: string; provenance: Provenance }>;
  hours: Array<{ day: string; hours: string; provenance: Provenance }>;
  facts: EvidenceFact[];
};

/** Flatten an approved pack into exactly the shapes the site evidence ledger consumes. */
export function usableBrandMaterial(pack: BrandPack): UsableBrandMaterial {
  return {
    brandSignals: pack.brandSignals.map((signal) => signal.phrase),
    assets: pack.images.map((image) => ({
      id: image.id,
      url: image.url,
      alt: image.alt,
      kind: image.kind,
      credit: image.credit,
      sourceUrl: image.provenance.sourceUrl,
      provenance: image.provenance,
    })),
    menu: pack.menu.map((category) => ({
      name: category.name,
      description: category.description,
      items: category.items,
      sourceUrl: category.provenance.sourceUrl,
      provenance: category.provenance,
    })),
    services: pack.services.map((service) => ({
      capability: service.capability,
      label: service.label,
      detail: service.detail,
      sourceUrl: service.provenance.sourceUrl,
      provenance: service.provenance,
    })),
    hours: pack.hours.map((row) => ({ day: row.day, hours: row.hours, provenance: row.provenance })),
    facts: pack.facts,
  };
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

const BRAND_PACK_START = "<!-- LYNQ_APPROVED_BRAND_PACK ";
const BRAND_PACK_END = " -->";

export function brandPackMarker(pack: BrandPack): string {
  return `${BRAND_PACK_START}${JSON.stringify(pack)}${BRAND_PACK_END}`;
}

/** `null` means "no pack recorded"; a thrown-away pack is reported separately by `brandPackParseFailed`. */
export function parseBrandPack(content: string | null): BrandPack | null {
  if (!content) return null;
  const start = content.lastIndexOf(BRAND_PACK_START);
  if (start < 0) return null;
  const end = content.indexOf(BRAND_PACK_END, start + BRAND_PACK_START.length);
  if (end < 0) return null;
  const parsed = brandPackSchema.safeParse(safeJson(content.slice(start + BRAND_PACK_START.length, end)));
  return parsed.success ? parsed.data : null;
}

export function brandPackParseFailed(content: string | null): boolean {
  if (!content) return false;
  const start = content.lastIndexOf(BRAND_PACK_START);
  if (start < 0) return false;
  return parseBrandPack(content) === null;
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
