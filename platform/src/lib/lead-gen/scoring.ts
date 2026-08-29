import { type DemoBusinessFacts } from "./demo-quality";

/**
 * ============================================================================
 * Lead scoring — one implementation, inside the platform
 * ============================================================================
 * The opportunity score previously lived in two standalone Node scripts
 * (`api/run-pipeline.js` and `scripts/discover-leads.js`), each with its own
 * copy of the weights, and the platform simply stored whatever number the
 * importer handed it. Anything inside LYNQ that needs to score or re-score a
 * lead now uses this, so a lead scored at import and a lead re-scored by an
 * agent six weeks later are scored the same way.
 *
 * The thesis the weights encode: the best prospect is a business customers
 * already like (strong rating, real review volume, so it is genuinely
 * operating) whose digital presence does not match that quality (no site, or
 * a weak one) and that we can actually reach.
 */

export interface LeadScoreInput extends Pick<DemoBusinessFacts, "rating" | "reviewCount" | "website" | "phone" | "email"> {
  /** 0-100 assessment of an existing website, when one was fetched and analysed. Null means no site was found at all. */
  websiteScore?: number | null;
}

export interface LeadScoreBreakdown {
  score: number;
  reputation: number;
  digitalNeed: number;
  contactability: number;
  qualified: boolean;
  reasons: string[];
}

/** Below this, an existing website is weak enough that a rebuild is a real offer rather than a nuisance. */
export const WEAK_WEBSITE_THRESHOLD = 55;
export const MINIMUM_QUALIFIED_RATING = 4.0;

export function scoreLead(input: LeadScoreInput): LeadScoreBreakdown {
  const reasons: string[] = [];

  const rating = typeof input.rating === "number" ? input.rating : null;
  const reviewCount = typeof input.reviewCount === "number" ? input.reviewCount : null;

  let reputation = 0;
  if (rating !== null) {
    if (rating >= 4.7) reputation += 25;
    else if (rating >= 4.4) reputation += 20;
    else if (rating >= 4.0) reputation += 10;
  }
  if (reviewCount !== null) {
    if (reviewCount >= 100) reputation += 15;
    else if (reviewCount >= 30) reputation += 10;
    else if (reviewCount >= 10) reputation += 5;
  }
  if (rating !== null && reviewCount !== null && rating >= 4.4 && reviewCount >= 30) {
    reasons.push(`strong reputation (${rating} from ${reviewCount} reviews)`);
  }

  const hasWebsite = Boolean(input.website?.trim());
  const websiteScore = typeof input.websiteScore === "number" ? input.websiteScore : null;
  let digitalNeed: number;
  if (!hasWebsite) {
    digitalNeed = 50;
    reasons.push("no website found");
  } else if (websiteScore === null) {
    // A site exists but was never assessed. Treat that as unknown, not as
    // "fine" and not as "broken" — half credit, and say so.
    digitalNeed = 25;
    reasons.push("website exists but has not been assessed");
  } else {
    digitalNeed = Math.round((Math.max(0, WEAK_WEBSITE_THRESHOLD - websiteScore) / WEAK_WEBSITE_THRESHOLD) * 50);
    if (websiteScore < WEAK_WEBSITE_THRESHOLD) reasons.push(`weak existing website (scored ${websiteScore}/100)`);
  }

  let contactability = 0;
  if (input.email?.trim()) contactability += 5;
  if (input.phone?.trim()) contactability += 5;
  if (contactability === 0) reasons.push("no reachable phone or email");

  const score = Math.min(100, reputation + digitalNeed + contactability);

  const reputationFit = rating !== null && rating >= MINIMUM_QUALIFIED_RATING;
  const digitalGap = !hasWebsite || (websiteScore !== null && websiteScore < WEAK_WEBSITE_THRESHOLD);
  const reachable = contactability > 0;
  const qualified = reputationFit && digitalGap && reachable;

  if (!reputationFit) reasons.push(`rating below the ${MINIMUM_QUALIFIED_RATING} qualification floor`);
  if (!digitalGap) reasons.push("existing website is already strong enough that there is no clear gap");

  return { score, reputation, digitalNeed, contactability, qualified, reasons };
}
