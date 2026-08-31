import { describe, expect, it } from "vitest";
import { extractEngineeringLinks, extractFounderDirective, jarvisRecommendation } from "./jarvis-presentation";

describe("Jarvis presentation helpers", () => {
  it("extracts the founder's original directive", () => {
    expect(extractFounderDirective("Founder directive\n\nBuild a client demo overnight.\n\nExecutive Assistant kickoff\n\nStarting now.")).toBe("Build a client demo overnight.");
    expect(extractFounderDirective("Ordinary project")).toBeNull();
  });

  it("extracts real pull request and preview links from engineering evidence", () => {
    expect(extractEngineeringLinks("- Pull request: https://github.com/a/b/pull/1\n- Preview: https://preview.vercel.app")).toEqual({
      pullRequestUrl: "https://github.com/a/b/pull/1",
      previewUrl: "https://preview.vercel.app",
    });
  });

  it("never recommends bypassing a pending approval", () => {
    expect(jarvisRecommendation("needs_approval")).toContain("will not continue");
  });
});
