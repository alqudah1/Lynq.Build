import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { metadata } from "./layout";
import robots from "./robots";

describe("search engines", () => {
  it("serves a robots.txt that lets crawlers in, so they can read noindex", () => {
    expect(robots().rules).toEqual([{ userAgent: "*", allow: "/" }]);
  });
  it("marks every page noindex in the layout metadata", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
  it("sends X-Robots-Tag: noindex, nofollow on every response", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toContainEqual({ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] });
  });
});
