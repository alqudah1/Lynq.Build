import { describe, it, expect } from "vitest";
import {
  MINIMUM_DEMO_QUALITY_SCORE,
  assertDemoEligibleForOutreach,
  DemoNotEligibleForOutreachError,
  evaluateDemoContentQuality,
  evaluateDemoEligibility,
  parseDemoReview,
  usesArabicContent,
  type DemoBusinessFacts,
  type DemoReviewRecord,
} from "./demo-quality";

const SLUG = "a".repeat(40);
const OTHER_SLUG = "b".repeat(40);

const GOOD_FACTS: DemoBusinessFacts = {
  name: "Beit Sitti",
  category: "Jordanian restaurant",
  city: "Amman",
  countryCode: "JO",
  rating: 4.8,
  reviewCount: 320,
  phone: "+962796940024",
  email: "hello@beitsitti.example",
  website: null,
  photoUrl: "https://images.example/beitsitti.jpg",
  description: "A hands-on cooking experience in a restored Amman home, run by neighbourhood cooks.",
  hoursCount: 7,
};

function reviewFor(overrides: Partial<DemoReviewRecord> = {}): DemoReviewRecord {
  const { score, checks, blockingFailures } = evaluateDemoContentQuality(GOOD_FACTS);
  return {
    version: 1,
    score,
    passed: true,
    contentChecks: checks,
    blockingFailures,
    renderChecks: {
      checkedAt: new Date().toISOString(),
      viewportWidths: [390, 1440],
      noHorizontalOverflow: true,
      noBrokenImages: true,
      noConsoleErrors: true,
      httpStatus: 200,
    },
    reviewerNote: null,
    reviewedAt: new Date().toISOString(),
    reviewedBy: { kind: "agent", id: "00000000-0000-4000-8000-000000000001" },
    demoSlug: SLUG,
    ...overrides,
  };
}

describe("demo content quality", () => {
  it("scores a fully-enriched business highly", () => {
    const { score, blockingFailures } = evaluateDemoContentQuality(GOOD_FACTS);
    expect(score).toBeGreaterThanOrEqual(MINIMUM_DEMO_QUALITY_SCORE);
    expect(blockingFailures).toEqual([]);
  });

  it("blocks a business with no way to be contacted", () => {
    const { blockingFailures } = evaluateDemoContentQuality({ ...GOOD_FACTS, phone: null, email: null });
    // A premium page whose only call to action goes nowhere is worse than no page.
    expect(blockingFailures).toContain("contact_action");
  });

  it("blocks a business with no category, which would force generic copy", () => {
    const { blockingFailures } = evaluateDemoContentQuality({ ...GOOD_FACTS, category: null });
    expect(blockingFailures).toContain("category_known");
  });

  it("blocks a placeholder business name", () => {
    const { blockingFailures } = evaluateDemoContentQuality({ ...GOOD_FACTS, name: "Test" });
    expect(blockingFailures).toContain("real_business_name");
  });

  it("marks generic template description copy as failing", () => {
    const { checks } = evaluateDemoContentQuality({ ...GOOD_FACTS, description: "Welcome to our website. We offer the best quality service." });
    expect(checks.find((check) => check.id === "specific_copy")?.passed).toBe(false);
  });

  it("does not credit social proof it cannot verify", () => {
    const { checks } = evaluateDemoContentQuality({ ...GOOD_FACTS, rating: null, reviewCount: null });
    expect(checks.find((check) => check.id === "social_proof")?.passed).toBe(false);
  });

  it("rejects a non-https photo rather than rendering a broken image", () => {
    const { checks } = evaluateDemoContentQuality({ ...GOOD_FACTS, photoUrl: "http://images.example/x.jpg" });
    expect(checks.find((check) => check.id === "imagery")?.passed).toBe(false);
  });
});

describe("right-to-left layout", () => {
  it("uses Arabic layout only when the business's own content is Arabic", () => {
    expect(usesArabicContent({ name: "بيت ستي", category: "مطعم", description: null })).toBe(true);
    // A Jordanian business with an English listing must NOT get an RTL page —
    // the old implementation keyed this off countryCode === "JO".
    expect(usesArabicContent({ name: "Beit Sitti", category: "Jordanian restaurant", description: "A cooking experience in Amman." })).toBe(false);
  });
});

describe("outreach eligibility", () => {
  it("blocks a demo that has never been reviewed", () => {
    const result = evaluateDemoEligibility({ review: null, demoSlug: SLUG });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("never_reviewed");
  });

  it("blocks a review recorded against a different demo", () => {
    const result = evaluateDemoEligibility({ review: reviewFor(), demoSlug: OTHER_SLUG });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("review_is_for_a_different_demo");
  });

  it("blocks a review with no recorded render check", () => {
    // "Nobody looked at it" is never treated as "it looks fine".
    const result = evaluateDemoEligibility({ review: reviewFor({ renderChecks: null }), demoSlug: SLUG });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("render_checks_missing");
  });

  it.each([
    ["horizontal overflow", { noHorizontalOverflow: false }],
    ["broken images", { noBrokenImages: false }],
    ["console errors", { noConsoleErrors: false }],
    ["a non-200 response", { httpStatus: 500 }],
  ])("blocks a demo with %s", (_label, override) => {
    const base = reviewFor();
    const result = evaluateDemoEligibility({ review: { ...base, renderChecks: { ...base.renderChecks!, ...override } }, demoSlug: SLUG });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("render_checks_failed");
  });

  it("blocks a demo with a failed blocking content check", () => {
    const result = evaluateDemoEligibility({ review: reviewFor({ blockingFailures: ["contact_action"] }), demoSlug: SLUG });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("blocking_content_failure");
  });

  it("blocks a demo below the minimum score", () => {
    const result = evaluateDemoEligibility({ review: reviewFor({ score: MINIMUM_DEMO_QUALITY_SCORE - 1 }), demoSlug: SLUG });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("below_minimum_score");
  });

  it("allows a reviewed, rendered, high-scoring demo", () => {
    const result = evaluateDemoEligibility({ review: reviewFor(), demoSlug: SLUG });
    expect(result.eligible).toBe(true);
    expect(result.reason).toBe("eligible");
  });

  it("throws for an ineligible demo when asserted", () => {
    expect(() => assertDemoEligibleForOutreach({ review: null, demoSlug: SLUG })).toThrow(DemoNotEligibleForOutreachError);
  });
});

describe("stored review parsing", () => {
  it("treats an unparseable stored review as no review at all", () => {
    expect(parseDemoReview(null)).toBeNull();
    expect(parseDemoReview({ score: 90, passed: true })).toBeNull();
    expect(parseDemoReview(reviewFor())).not.toBeNull();
  });
});
