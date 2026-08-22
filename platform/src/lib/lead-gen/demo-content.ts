import { createHash } from "node:crypto";
import { z } from "zod";
import type { DemoBusinessFacts } from "./demo-quality";

/**
 * ============================================================================
 * Generated demo content — bounded, attributable, and checked for invention
 * ============================================================================
 * The demo page shipped with three hand-written copy sets chosen by an
 * industry keyword match. That is exactly the "generic template language"
 * the quality rules forbid: every restaurant got the same paragraph.
 *
 * A model may now write the copy per business — but only into this fixed
 * shape, only through `assertNoFabricatedClaims`, and only stamped with the
 * hash of the facts it was written from, so copy written against an older
 * version of a business's data is detectable rather than silently stale.
 * Free-form HTML is never accepted; the page renders these fields into its
 * own markup.
 */

export const DEMO_STYLE_KEYS = ["hospitality", "retail", "services", "wellness", "professional"] as const;
export type DemoStyleKey = (typeof DEMO_STYLE_KEYS)[number];

const line = (max: number) => z.string().trim().min(1).max(max);

export const demoContentSchema = z.object({
  version: z.literal(1),
  styleKey: z.enum(DEMO_STYLE_KEYS),
  /** Written in the language of the business's own content — see `usesArabicContent`. */
  language: z.enum(["en", "ar"]),
  eyebrow: line(40),
  headline: line(160),
  intro: line(320),
  imageLine: line(240),
  experienceLabel: line(40),
  experienceTitle: line(120),
  closing: line(80),
  experiences: z.array(z.object({ title: line(60), description: line(200) })).length(3),
  /** SHA-256 of the business facts this copy was written from. */
  factsHash: z.string().regex(/^[a-f0-9]{64}$/),
  generatedAt: z.string().datetime(),
  generatedBy: z.object({ kind: z.enum(["user", "agent"]), id: z.string().uuid() }),
  /** The model role/id that produced it — provenance, never a credential. */
  model: z.string().trim().max(120),
});

export type DemoContent = z.infer<typeof demoContentSchema>;

export function parseDemoContent(raw: unknown): DemoContent | null {
  if (!raw) return null;
  const parsed = demoContentSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Stable over the facts that actually change what the page says. */
export function hashBusinessFacts(facts: DemoBusinessFacts): string {
  const canonical = JSON.stringify([
    facts.name,
    facts.category ?? null,
    facts.city ?? null,
    facts.countryCode ?? null,
    facts.rating ?? null,
    facts.reviewCount ?? null,
    facts.description ?? null,
    facts.photoUrl ?? null,
    facts.website ?? null,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

/** Copy is stale — not wrong, but no longer describing the current facts — once the facts move underneath it. */
export function isDemoContentStale(content: DemoContent, facts: DemoBusinessFacts): boolean {
  return content.factsHash !== hashBusinessFacts(facts);
}

/**
 * Claims a model has no way to know and a prospect can immediately
 * disprove. Awards, founding dates, family ownership, superlative rank and
 * head-counts are the recurring ones; a business owner who reads "voted best
 * in the city since 1998" about a business founded last year stops reading.
 * Anything matched here is refused rather than sanitized, so the failure is
 * visible at generation time.
 */
const FABRICATION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\baward[- ]winning\b|\bwinner of\b|\bvoted (the )?best\b|\baward\b/i, label: "an award claim" },
  {
    // "best coffee in the city" is the same claim as "best in the city" —
    // the earlier, narrower pattern missed every phrasing with a noun in
    // between, which is the phrasing a model actually writes.
    pattern: /\b(?:no\.?|number|#)\s?1\b|\bbest\b[^.!?]{0,60}\bin (?:the )?(?:city|town|country|region|area|neighbou?rhood|world)\b|\b(?:top|highest)[- ]rated\b/i,
    label: "a superlative ranking claim",
  },
  { pattern: /\bsince \d{4}\b|\bestablished (?:in )?\d{4}\b|\bfounded (?:in )?\d{4}\b|\b\d+\+? years of\b/i, label: "a founding-date or tenure claim" },
  { pattern: /\bfamily[- ]owned\b|\bfamily[- ]run\b|\bthird[- ]generation\b|\bwoman[- ]owned\b/i, label: "an ownership claim" },
  { pattern: /\b(?:michelin|halal[- ]certified|organic[- ]certified|iso ?900\d)\b/i, label: "a certification claim" },
  { pattern: /\b(?:free (?:delivery|parking|wifi)|open 24\/7|money[- ]back guarantee)\b/i, label: "an unverified offer claim" },
  { pattern: /\b\d+\s?(?:staff|employees|locations|branches|seats|tables)\b/i, label: "a size claim" },
  { pattern: /\bdemo\b|\bmock ?up\b|\bplaceholder\b|\blorem ipsum\b/i, label: "a reference to this being a demo" },
  { pattern: /\b\d+\s?(?:JOD|CAD|USD|دينار)\b|\$\s?\d/i, label: "a price" },
];

export class FabricatedDemoContentError extends Error {
  readonly field: string;
  readonly claim: string;
  constructor(field: string, claim: string) {
    super(`Generated demo copy for "${field}" contains ${claim}, which cannot be verified from this business's data.`);
    this.name = "FabricatedDemoContentError";
    this.field = field;
    this.claim = claim;
  }
}

/**
 * A claim is allowed only if the business's own stored description already
 * says it — a model repeating what the business published about itself is
 * reporting; a model inventing it is fabricating.
 */
export function assertNoFabricatedClaims(content: DemoContent, facts: DemoBusinessFacts): void {
  const source = `${facts.description ?? ""} ${facts.category ?? ""} ${facts.name}`.toLowerCase();

  const fields: Array<[string, string]> = [
    ["eyebrow", content.eyebrow],
    ["headline", content.headline],
    ["intro", content.intro],
    ["imageLine", content.imageLine],
    ["experienceLabel", content.experienceLabel],
    ["experienceTitle", content.experienceTitle],
    ["closing", content.closing],
    ...content.experiences.flatMap((entry, index): Array<[string, string]> => [
      [`experiences[${index}].title`, entry.title],
      [`experiences[${index}].description`, entry.description],
    ]),
  ];

  for (const [field, value] of fields) {
    for (const { pattern, label } of FABRICATION_PATTERNS) {
      const match = value.match(pattern);
      if (!match) continue;
      // Present in the business's own published description: reporting, not inventing.
      if (source.includes(match[0].toLowerCase())) continue;
      throw new FabricatedDemoContentError(field, label);
    }
  }
}
