import { describe, expect, it } from "vitest";
import { brandPack, collectedBrandPack, packFrom, restaurantIdentity } from "../../../../test/support/website-fixtures";
import { emptyBrandPack, fingerprintBrandPack } from "./brand-pack";
import { approvalSummaryLine, recommendedDesignDirection, renderProspectApproval } from "./founder-review";

/**
 * The approval page is the founder's only view of what Jarvis is about to
 * build from, so these tests check that everything they need to make the
 * decision is actually on it — including the things Jarvis could not do.
 */

const review = (pack = brandPack, failure: string | null = null, uncertainty: string[] = []) =>
  renderProspectApproval({ restaurantName: "Sumac & Stone", pack, collectionFailure: failure, researchUncertainty: uncertainty });

describe("the prospect approval page", () => {
  it("shows the restaurant, and the evidence version the approval will bind to", () => {
    const page = review();
    expect(page).toContain("Approve the prospect and its evidence — Sumac & Stone");
    expect(page).toContain(fingerprintBrandPack(brandPack));
    expect(page).toContain("collected 2026-08-20");
    expect(page).toContain("412 Dundas Street West, Toronto, ON");
  });

  it("says in plain words that approving covers this exact evidence", () => {
    expect(review()).toContain("If Jarvis gathers evidence again, the version changes and it will ask you to approve it again");
  });

  it("puts a source, a date and a confidence beside every fact", () => {
    const page = review();
    expect(page).toContain("| Fact | Value | Source | Retrieved | Confidence |");
    expect(page).toContain("[source](https://sumacandstone.example.ca)");
    expect(page).toContain("2026-08-18");
    expect(page).toContain("verified");
  });

  it("shows the images, the menu, the hours and the services that were verified", () => {
    const page = review();
    expect(page).toContain("The dining room at Sumac and Stone");
    expect(page).toContain("### Mezze");
    expect(page).toContain("Muhammara");
    expect(page).toContain("Tuesday to Thursday");
    expect(page).toContain("Table reservations");
  });

  it("names what could not be verified rather than leaving it out", () => {
    const page = review(brandPack, null, ["Opening hours were only listed on one aggregator."]);
    expect(page).toContain("## Not verified");
    expect(page).toContain("Opening hours were only listed on one aggregator.");
  });

  it("shows where two sources disagreed, and says neither value is used", () => {
    const conflicted = packFrom({
      ...collectedBrandPack,
      facts: [
        ...collectedBrandPack.facts,
        { key: "contact.phone", label: "Phone", value: "+1 416 555 7777", provenance: { sourceUrl: "https://listings.example.ca/sumac-and-stone", sourceType: "public_listing", retrievedAt: "2026-08-18", confidence: "verified", note: null } },
      ],
    });
    const page = review(conflicted);
    expect(page).toContain("## Where sources disagree");
    expect(page).toContain("Jarvis uses none of these");
    expect(page).toContain('"+1 416 555 0142" vs "+1 416 555 7777"');
  });

  it("states plainly when evidence collection did not finish", () => {
    const page = review(emptyBrandPack(restaurantIdentity, "2026-08-20"), "The research provider did not respond.");
    expect(page).toContain("**Evidence collection did not finish.** The research provider did not respond.");
    expect(page).toContain("_No published menu was verified, so the site will not describe any dish._");
    expect(page).toContain("_Nothing verified._");
  });

  it("recommends a design direction the founder can see before approving", () => {
    const page = review();
    const design = recommendedDesignDirection("Sumac & Stone · Toronto · CA");
    expect(page).toContain("## Recommended design direction");
    expect(page).toContain(design.name);
    expect(page).toContain(design.layout);
    expect(page).toContain(design.palette.accent);
  });

  it("recommends the same direction every time for the same business, and a different one for another", () => {
    expect(recommendedDesignDirection("Sumac & Stone · Toronto · CA")).toEqual(recommendedDesignDirection("Sumac & Stone · Toronto · CA"));
    expect(recommendedDesignDirection("Sumac & Stone · Toronto · CA")).not.toEqual(recommendedDesignDirection("Other Kitchen · Amman · JO"));
  });

  it("repeats that nothing reaches the restaurant at this stage", () => {
    expect(review()).toContain("No message reaches the restaurant at this stage");
  });

  it("summarises what is being approved in one line", () => {
    expect(approvalSummaryLine(brandPack)).toBe(
      `2 verified facts, 3 images, 2 menu sections, 2 opening-hours rows, evidence version ${fingerprintBrandPack(brandPack)}`,
    );
    expect(approvalSummaryLine(emptyBrandPack(restaurantIdentity, "2026-08-20"))).toContain("0 verified facts");
  });
});
