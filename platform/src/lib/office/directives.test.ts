import { describe, expect, it } from "vitest";
import { deriveDirectiveProjectName } from "./directives";

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

