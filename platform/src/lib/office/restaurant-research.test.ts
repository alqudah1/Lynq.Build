import { describe, expect, it } from "vitest";
import { parseRestaurantResearch, renderRestaurantResearch, restaurantResearchMarker, type RestaurantResearch } from "./restaurant-research";

const research: RestaurantResearch = {
  searchArea: "Toronto, Canada",
  recommendation: {
    name: "Example Bistro",
    address: "1 Example Street, Toronto, ON",
    city: "Toronto",
    countryCode: "CA",
    website: "https://example.com",
    email: "hello@example.com",
    phone: null,
    rating: 4.4,
    reviews: 120,
    websiteScore: 42,
    opportunityScore: 83,
    whySelected: "The public site makes booking difficult on mobile.",
    websiteProblems: ["The booking path is not visible on the home page."],
    demoOpportunities: ["A mobile-first booking call to action."],
    sources: [
      { title: "Official website", url: "https://example.com", supports: "Shows the current customer journey." },
      { title: "Public listing", url: "https://example.org/listing", supports: "Confirms the address and category." },
    ],
  },
  alternatives: [
    {
      name: "Second Bistro",
      address: "2 Example Street, Toronto, ON",
      city: "Toronto",
      countryCode: "CA",
      website: null,
      email: null,
      phone: null,
      rating: null,
      reviews: null,
      websiteScore: 20,
      opportunityScore: 70,
      whySelected: "No official website was verified.",
      websiteProblems: ["No official website was found in the cited public sources."],
      demoOpportunities: ["A simple menu and location landing page."],
      sources: [
        { title: "Directory A", url: "https://example.net/a", supports: "Confirms the restaurant identity." },
        { title: "Directory B", url: "https://example.net/b", supports: "Confirms the restaurant location." },
      ],
    },
  ],
  uncertainty: ["Confirm ownership before sending outreach."],
};

describe("restaurant research evidence", () => {
  it("round-trips the durable research marker", () => {
    expect(parseRestaurantResearch(`${restaurantResearchMarker(research)}\n\nvisible report`)).toEqual(research);
  });

  it("renders evidence links and the founder gate", () => {
    const report = renderRestaurantResearch(research);
    expect(report).toContain("[Official website](https://example.com)");
    expect(report).toContain("Approve this restaurant before Product or Engineering starts");
    expect(report).toContain("No outreach is sent at this stage");
  });
});
