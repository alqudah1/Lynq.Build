import { describe, expect, it } from "vitest";
import { deriveDirectiveProjectName, isRestaurantProspectingDirective } from "./directives";

describe("deriveDirectiveProjectName", () => {
  it("uses the signed client name instead of a later handoff phrase", () => {
    expect(
      deriveDirectiveProjectName(
        "We signed KidsCoding. Digitally transform the business and hand results back through the Executive Assistant for my review."
      )
    ).toBe("KidsCoding");
  });

  it("extracts an explicitly named client project", () => {
    expect(deriveDirectiveProjectName("Create a client project for North Star Dental to redesign its website.")).toBe("North Star Dental");
  });
});

describe("isRestaurantProspectingDirective", () => {
  it("recognizes the evidence-gated restaurant demo workflow", () => {
    expect(isRestaurantProspectingDirective("Find a restaurant, choose it, build a website demo, then outreach")).toBe(true);
  });

  it("does not hijack unrelated restaurant or website work", () => {
    expect(isRestaurantProspectingDirective("Book me a restaurant table")).toBe(false);
    expect(isRestaurantProspectingDirective("Build the LYNQ website")).toBe(false);
  });
});
