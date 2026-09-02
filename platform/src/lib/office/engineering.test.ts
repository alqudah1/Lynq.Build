import { describe, expect, it } from "vitest";
import { restaurantDemoPath, withPreviewPath } from "./engineering";

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
