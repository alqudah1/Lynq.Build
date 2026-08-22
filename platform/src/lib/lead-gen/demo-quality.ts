import { z } from "zod";

/**
 * ============================================================================
 * Demo quality — the gate between "a demo exists" and "we may message them"
 * ============================================================================
 * A prospect demo is a real business's real name on a real page that a
 * stranger will judge in four seconds. Two independent things have to be
 * true before LYNQ is allowed to send anyone a link to one:
 *
 *   1. CONTENT quality — the page is built from enough genuine, specific
 *      business facts that it reads as that business's own site rather
 *      than a template with a name dropped in. Computed here, from data.
 *   2. RENDERED quality — the page actually renders: no horizontal
 *      overflow, no broken images, no console errors, on both mobile and
 *      desktop. That cannot be inferred from a database row; it has to be
 *      observed. So it is RECORDED here, not computed, and a demo with no
 *      recorded render check is ineligible — "not yet checked" is never
 *      treated as "fine".
 *
 * Eligibility reads the STORED review verdict, never a fresh recompute at
 * send time, so what someone actually signed off on is what gates the
 * message.
 */

export const MINIMUM_DEMO_QUALITY_SCORE = 70;

export type DemoCheckSeverity = "blocking" | "advisory";

export interface DemoQualityCheck {
  id: string;
  label: string;
  severity: DemoCheckSeverity;
  passed: boolean;
  /** Weight toward the 0-100 content score. Advisory checks still carry weight; blocking ones also veto. */
  weight: number;
  detail: string;
}

/** The business facts a demo is built from — exactly the fields `demo/[slug]/page.tsx` reads. */
export interface DemoBusinessFacts {
  name: string;
  category?: string | null;
  city?: string | null;
  countryCode?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  photoUrl?: string | null;
  description?: string | null;
  hoursCount?: number;
}

const ARABIC_SCRIPT = /[؀-ۿݐ-ݿ]/;

/**
 * RTL is a property of the CONTENT, not of the country. A Jordanian
 * business whose own name, category and description are in English gets an
 * LTR page; one whose real content is Arabic gets RTL. The previous
 * implementation keyed the whole layout off `countryCode === "JO"`, which
 * rendered right-to-left around English text whenever a Jordanian
 * business's listing happened to be in English.
 */
export function usesArabicContent(facts: Pick<DemoBusinessFacts, "name" | "category" | "description">): boolean {
  return [facts.name, facts.category, facts.description].some((value) => typeof value === "string" && ARABIC_SCRIPT.test(value));
}

/** Generic filler that means the demo would read as a template rather than as this business's site. */
const GENERIC_DESCRIPTION_PATTERNS = [
  /welcome to our (website|business)/i,
  /lorem ipsum/i,
  /your (trusted|premier|number one) (partner|choice|destination)/i,
  /we (offer|provide) (the )?best (quality )?(service|products)/i,
  /coming soon/i,
];

export function evaluateDemoContentQuality(facts: DemoBusinessFacts): { score: number; checks: DemoQualityCheck[]; blockingFailures: string[] } {
  const checks: DemoQualityCheck[] = [];

  const name = facts.name?.trim() ?? "";
  checks.push({
    id: "real_business_name",
    label: "Uses the business's real name",
    severity: "blocking",
    weight: 20,
    passed: name.length >= 2 && !/^(business|company|test|demo|untitled)$/i.test(name),
    detail: name ? `name="${name}"` : "no business name on the record",
  });

  const category = facts.category?.trim() ?? "";
  checks.push({
    id: "category_known",
    label: "Business category is known, so the page can be category-specific",
    severity: "blocking",
    weight: 15,
    passed: category.length >= 3,
    detail: category ? `category="${category}"` : "no category — the page would fall back to generic copy",
  });

  const city = facts.city?.trim() ?? "";
  checks.push({
    id: "city_known",
    label: "City is known",
    severity: "advisory",
    weight: 8,
    passed: city.length >= 2,
    detail: city ? `city="${city}"` : "no city",
  });

  const hasRating = typeof facts.rating === "number" && facts.rating > 0;
  const hasReviews = typeof facts.reviewCount === "number" && facts.reviewCount > 0;
  checks.push({
    id: "social_proof",
    label: "Real rating and review count available",
    severity: "advisory",
    weight: 12,
    passed: hasRating && hasReviews,
    detail: hasRating && hasReviews ? `${facts.rating} from ${facts.reviewCount} reviews` : "no verifiable rating/review data — the page must not imply any",
  });

  const hasContact = Boolean(facts.phone?.trim() || facts.email?.trim());
  checks.push({
    id: "contact_action",
    label: "A real contact route exists for the page's primary action",
    severity: "blocking",
    weight: 20,
    passed: hasContact,
    detail: hasContact ? "phone and/or email present" : "no phone or email — the demo would have a call-to-action that goes nowhere",
  });

  const photo = facts.photoUrl?.trim() ?? "";
  const photoIsHttps = photo.startsWith("https://");
  checks.push({
    id: "imagery",
    label: "At least one usable https photo of the business",
    severity: "advisory",
    weight: 15,
    passed: photoIsHttps,
    detail: photo ? (photoIsHttps ? "https photo present" : "photo URL is not https and will be dropped") : "no photo — the page falls back to typography only",
  });

  const description = facts.description?.trim() ?? "";
  const genericDescription = GENERIC_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(description));
  checks.push({
    id: "specific_copy",
    label: "Description is specific rather than generic template language",
    severity: "advisory",
    weight: 10,
    passed: description.length === 0 ? false : !genericDescription,
    detail: description.length === 0 ? "no description" : genericDescription ? "description matches generic template phrasing" : "description is business-specific",
  });

  checks.push({
    id: "opening_hours",
    label: "Opening hours available",
    severity: "advisory",
    weight: 5,
    passed: (facts.hoursCount ?? 0) > 0,
    detail: `${facts.hoursCount ?? 0} day(s) of hours`,
  });

  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
  const earned = checks.reduce((sum, check) => sum + (check.passed ? check.weight : 0), 0);
  const score = Math.round((earned / totalWeight) * 100);
  const blockingFailures = checks.filter((check) => check.severity === "blocking" && !check.passed).map((check) => check.id);

  return { score, checks, blockingFailures };
}

/**
 * What an automated render check must actually observe. Every field is
 * required — an optional "we didn't look" is how a broken page gets sent
 * to a hundred businesses.
 */
export const demoRenderChecksSchema = z.object({
  checkedAt: z.string().datetime(),
  /** The viewport widths actually exercised. Must include a phone width and a desktop width. */
  viewportWidths: z.array(z.number().int().min(280).max(3840)).min(2),
  noHorizontalOverflow: z.boolean(),
  noBrokenImages: z.boolean(),
  noConsoleErrors: z.boolean(),
  httpStatus: z.number().int(),
  /** Anything the checker wants to surface to a human reviewer. */
  notes: z.string().max(2000).optional(),
});
export type DemoRenderChecks = z.infer<typeof demoRenderChecksSchema>;

export const demoQualityCheckSchema = z.object({
  id: z.string().min(1).max(60),
  label: z.string().min(1).max(200),
  severity: z.enum(["blocking", "advisory"]),
  passed: z.boolean(),
  weight: z.number().int().min(0).max(100),
  detail: z.string().max(500),
});

/** The verdict persisted on `crm_companies.demo_review`. */
export const demoReviewRecordSchema = z.object({
  version: z.literal(1),
  score: z.number().int().min(0).max(100),
  passed: z.boolean(),
  contentChecks: z.array(demoQualityCheckSchema).max(40),
  blockingFailures: z.array(z.string()).max(40),
  renderChecks: demoRenderChecksSchema.nullable(),
  /** Free-text reviewer judgement — a Claude reviewer's or a human's. */
  reviewerNote: z.string().max(4000).nullable(),
  reviewedAt: z.string().datetime(),
  reviewedBy: z.object({ kind: z.enum(["user", "agent"]), id: z.string().uuid() }),
  /** The demo slug reviewed, so a review can never be read as covering a different page. */
  demoSlug: z.string().regex(/^[a-f0-9]{40}$/),
});
export type DemoReviewRecord = z.infer<typeof demoReviewRecordSchema>;

export function parseDemoReview(raw: unknown): DemoReviewRecord | null {
  if (!raw) return null;
  const parsed = demoReviewRecordSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export interface DemoEligibility {
  eligible: boolean;
  /** Machine-readable, so a tool can return it and a UI can explain it. */
  reason: "eligible" | "never_reviewed" | "review_is_for_a_different_demo" | "render_checks_missing" | "render_checks_failed" | "blocking_content_failure" | "below_minimum_score";
  detail: string;
  score: number | null;
}

/**
 * The single question every outreach path asks before drafting, batching
 * or sending: may we put this demo in front of this business?
 */
export function evaluateDemoEligibility(input: { review: DemoReviewRecord | null; demoSlug: string }): DemoEligibility {
  const review = input.review;
  if (!review) {
    return { eligible: false, reason: "never_reviewed", detail: "This demo has never been reviewed. Outreach is blocked until it is.", score: null };
  }
  if (review.demoSlug !== input.demoSlug) {
    return { eligible: false, reason: "review_is_for_a_different_demo", detail: "The stored review was recorded against a different demo slug.", score: review.score };
  }
  if (!review.renderChecks) {
    return { eligible: false, reason: "render_checks_missing", detail: "No automated render check has been recorded for this demo.", score: review.score };
  }
  const render = review.renderChecks;
  if (render.httpStatus !== 200 || !render.noHorizontalOverflow || !render.noBrokenImages || !render.noConsoleErrors) {
    const failed = [
      render.httpStatus !== 200 ? `http ${render.httpStatus}` : null,
      !render.noHorizontalOverflow ? "horizontal overflow" : null,
      !render.noBrokenImages ? "broken images" : null,
      !render.noConsoleErrors ? "console errors" : null,
    ].filter(Boolean);
    return { eligible: false, reason: "render_checks_failed", detail: `Render checks failed: ${failed.join(", ")}.`, score: review.score };
  }
  if (review.blockingFailures.length > 0) {
    return { eligible: false, reason: "blocking_content_failure", detail: `Blocking content checks failed: ${review.blockingFailures.join(", ")}.`, score: review.score };
  }
  if (review.score < MINIMUM_DEMO_QUALITY_SCORE) {
    return { eligible: false, reason: "below_minimum_score", detail: `Quality score ${review.score} is below the minimum of ${MINIMUM_DEMO_QUALITY_SCORE}.`, score: review.score };
  }
  return { eligible: true, reason: "eligible", detail: `Quality score ${review.score}.`, score: review.score };
}

export class DemoNotEligibleForOutreachError extends Error {
  readonly reason: DemoEligibility["reason"];
  constructor(eligibility: DemoEligibility) {
    super(eligibility.detail);
    this.name = "DemoNotEligibleForOutreachError";
    this.reason = eligibility.reason;
  }
}

export function assertDemoEligibleForOutreach(input: { review: DemoReviewRecord | null; demoSlug: string }): DemoEligibility {
  const eligibility = evaluateDemoEligibility(input);
  if (!eligibility.eligible) throw new DemoNotEligibleForOutreachError(eligibility);
  return eligibility;
}
