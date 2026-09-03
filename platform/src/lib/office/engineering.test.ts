import { describe, expect, it } from "vitest";
import { brandPack, candidate, content, designProposal } from "../../../test/support/website-fixtures";
import { brandPackMarker } from "./website/evidence";
import { buildApprovedRestaurantWebsite, restaurantDemoPath, RestaurantResearchUnavailableError, withPreviewPath } from "./engineering";

describe("Office engineering preview routing", () => {
  it("derives a stable public restaurant demo route", () => {
    expect(restaurantDemoPath("BISTRO9-A7")).toBe("/demos/bistro9-a7");
  });

  it("points a deployment preview at the generated demo", () => {
    expect(withPreviewPath("https://platform-example.vercel.app", "/demos/bistro9-a7")).toBe(
      "https://platform-example.vercel.app/demos/bistro9-a7",
    );
  });

  it("keeps ordinary product previews at the deployment root", () => {
    expect(withPreviewPath("https://platform-example.vercel.app", null)).toBe("https://platform-example.vercel.app");
    expect(withPreviewPath(null, "/demos/bistro9-a7")).toBeNull();
  });
});

describe("Office engineering restaurant website build", () => {
  const sharedContext = [
    "# Prospect project",
    `<!-- LYNQ_RESTAURANT_RESEARCH ${JSON.stringify({
      searchArea: "Toronto, Canada",
      recommendation: candidate,
      alternatives: [candidate],
      uncertainty: ["Opening hours were only listed on one aggregator."],
    })} -->`,
    brandPackMarker(brandPack),
  ].join("\n\n");

  const generator = async () => ({ design: designProposal, content }) as never;

  it("refuses to build without founder-approved research recorded on the project", async () => {
    await expect(
      buildApprovedRestaurantWebsite({ projectKey: "SUMAC", route: "/demos/sumac", objective: "Build it.", sharedContext: "No research here.", generator }),
    ).rejects.toBeInstanceOf(RestaurantResearchUnavailableError);
  });

  it("refuses to build when approved brand material will not parse, rather than quietly dropping it", async () => {
    const broken = `${sharedContext}\n\n<!-- LYNQ_APPROVED_BRAND_PACK {"assets":[{"id":"x"}]} -->`;
    await expect(
      buildApprovedRestaurantWebsite({ projectKey: "SUMAC", route: "/demos/sumac", objective: "Build it.", sharedContext: broken, generator }),
    ).rejects.toThrow(/brand pack .* is malformed/i);
  });

  it("builds a validated site from the approved research and brand pack", async () => {
    const website = await buildApprovedRestaurantWebsite({ projectKey: "SUMAC", route: "/demos/sumac", objective: "Build it.", sharedContext, generator });
    expect(website.report.ok).toBe(true);
    expect(website.routeSourceDir).toBe("platform/src/app/demos/sumac");
    expect(website.spec.businessName).toBe("Sumac & Stone");
    expect(website.uncertainties).toContain("Opening hours were only listed on one aggregator.");
  });
});
