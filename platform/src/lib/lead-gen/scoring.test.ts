import { describe, it, expect } from "vitest";
import { MINIMUM_QUALIFIED_RATING, WEAK_WEBSITE_THRESHOLD, scoreLead } from "./scoring";

describe("lead scoring", () => {
  it("gives the highest score to a well-reviewed, reachable business with no website", () => {
    const result = scoreLead({ rating: 4.8, reviewCount: 400, website: null, phone: "+962796940024", email: "hi@example.com" });
    expect(result.score).toBe(100);
    expect(result.digitalNeed).toBe(50);
    expect(result.qualified).toBe(true);
    expect(result.reasons).toContain("no website found");
  });

  it("disqualifies a business whose existing site is already strong", () => {
    const result = scoreLead({ rating: 4.8, reviewCount: 400, website: "https://example.com", websiteScore: 85, phone: "+1", email: null });
    expect(result.digitalNeed).toBe(0);
    expect(result.qualified).toBe(false);
    expect(result.reasons.some((reason) => reason.includes("already strong"))).toBe(true);
  });

  it("qualifies a business with a weak existing site", () => {
    const result = scoreLead({ rating: 4.5, reviewCount: 60, website: "https://example.com", websiteScore: WEAK_WEBSITE_THRESHOLD - 30, phone: "+1", email: null });
    expect(result.qualified).toBe(true);
    expect(result.digitalNeed).toBeGreaterThan(0);
  });

  it("does not treat an unassessed website as fine, or as broken", () => {
    const result = scoreLead({ rating: 4.5, reviewCount: 60, website: "https://example.com", websiteScore: null, phone: "+1", email: null });
    expect(result.digitalNeed).toBe(25);
    expect(result.reasons).toContain("website exists but has not been assessed");
  });

  it("disqualifies a business below the rating floor", () => {
    const result = scoreLead({ rating: MINIMUM_QUALIFIED_RATING - 0.1, reviewCount: 400, website: null, phone: "+1", email: null });
    expect(result.qualified).toBe(false);
  });

  it("disqualifies a business nobody can reach", () => {
    const result = scoreLead({ rating: 4.9, reviewCount: 900, website: null, phone: null, email: null });
    expect(result.contactability).toBe(0);
    expect(result.qualified).toBe(false);
    expect(result.reasons).toContain("no reachable phone or email");
  });

  it("never exceeds 100", () => {
    expect(scoreLead({ rating: 5, reviewCount: 100000, website: null, phone: "+1", email: "a@b.c" }).score).toBeLessThanOrEqual(100);
  });
});
