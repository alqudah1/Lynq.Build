import { beforeAll, describe, expect, it } from "vitest";
import { brandPack, candidate, content, designProposal } from "../../../../test/support/website-fixtures";
import { resolveDesignDirection } from "./design";
import { buildSiteEvidence } from "./evidence";
import { emitSiteFiles, routeSourceDir } from "./emit";
import { assembleSiteSpec, type SiteSpec } from "./spec";

let spec: SiteSpec;

beforeAll(() => {
  spec = assembleSiteSpec({
    projectKey: "SUMAC",
    route: "/demos/sumac",
    evidence: buildSiteEvidence({ candidate, brandPack }),
    design: resolveDesignDirection(designProposal),
    content,
  });
});

describe("emitted route sources", () => {
  it("writes the direct preview route and every sub-page inside its own directory", () => {
    expect(routeSourceDir(spec)).toBe("platform/src/app/demos/sumac");
    const paths = emitSiteFiles(spec).map((file) => file.path);
    expect(paths).toEqual([
      "platform/src/app/demos/sumac/site.data.ts",
      "platform/src/app/demos/sumac/layout.tsx",
      "platform/src/app/demos/sumac/page.tsx",
      "platform/src/app/demos/sumac/menu/page.tsx",
      "platform/src/app/demos/sumac/visit/page.tsx",
    ]);
    expect(paths.every((path) => path.startsWith("platform/src/app/demos/sumac/"))).toBe(true);
  });

  it("resolves the shared data module from whatever depth a page sits at", () => {
    const files = new Map(emitSiteFiles(spec).map((file) => [file.path, file.content]));
    expect(files.get("platform/src/app/demos/sumac/page.tsx")).toContain('from "./site.data"');
    expect(files.get("platform/src/app/demos/sumac/menu/page.tsx")).toContain('from "../site.data"');
  });

  it("renders through the shared component system rather than bespoke markup", () => {
    const home = emitSiteFiles(spec).find((file) => file.path.endsWith("demos/sumac/page.tsx"))!.content;
    expect(home).toContain('import { DemoSitePage } from "@/components/demos/DemoSite"');
    expect(home).toContain('<DemoSitePage spec={siteSpec} path={""} />');
    expect(home).not.toContain("<div");
  });

  it("types the generated data against the specification so a schema change breaks the build", () => {
    const data = emitSiteFiles(spec).find((file) => file.path.endsWith("site.data.ts"))!.content;
    expect(data).toContain('import type { SiteSpec } from "@/lib/office/website/spec"');
    expect(data).toContain("export const siteSpec: SiteSpec =");
    const literal = data.slice(data.indexOf("export const siteSpec: SiteSpec = ") + "export const siteSpec: SiteSpec = ".length, data.lastIndexOf("}") + 1);
    expect(JSON.parse(literal)).toEqual(spec);
  });

  it("gives every page its own metadata and keeps prospect demos out of search results", () => {
    for (const page of spec.pages) {
      const file = emitSiteFiles(spec).find((item) => item.path.endsWith(page.path ? `${page.path}/page.tsx` : "sumac/page.tsx"))!;
      expect(file.content).toContain(`title: ${JSON.stringify(page.title)}`);
      expect(file.content).toContain(`description: ${JSON.stringify(page.description)}`);
      expect(file.content).toContain("robots: { index: false, follow: false }");
    }
  });

  it("gives the demo segment a mobile viewport and its own theme colour", () => {
    const layout = emitSiteFiles(spec).find((file) => file.path.endsWith("layout.tsx"))!.content;
    expect(layout).toContain('width: "device-width"');
    expect(layout).toContain(JSON.stringify(spec.design.palette.background));
  });

  it("names each page component distinctly so two routes never collide", () => {
    const names = emitSiteFiles(spec)
      .filter((file) => file.path.endsWith("page.tsx"))
      .map((file) => /export default function (\w+)/.exec(file.content)?.[1]);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("DemoHomePage");
    expect(names).toContain("DemoMenuPage");
  });
});
