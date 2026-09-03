import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DemoSitePage } from "@/components/demos/DemoSite";
import { brandPack, candidate, content, designProposal } from "../../../../test/support/website-fixtures";
import { resolveDesignDirection } from "./design";
import { buildSiteEvidence, EMPTY_BRAND_PACK, type BrandPack } from "./evidence";
import { assembleSiteSpec, type SiteSpec } from "./spec";
import { renderSpecPage } from "./render";

/**
 * `render.ts` exists because the Next application may not pull
 * `react-dom/server` into its module graph, and the validator must still
 * render every page before a branch is pushed. That substitution is only
 * honest if the two renderers agree, so this test renders real generated
 * sites both ways and compares everything the validator actually reads.
 *
 * Tests are not bundled by Next, so importing the real renderer here is
 * exactly where it belongs.
 */

function specFor(pack: BrandPack, countryCode: "CA" | "JO" = "CA"): SiteSpec {
  return assembleSiteSpec({
    projectKey: "SUMAC",
    route: "/demos/sumac",
    evidence: buildSiteEvidence({ candidate: { ...candidate, countryCode }, brandPack: pack }),
    design: resolveDesignDirection(designProposal),
    content,
  });
}

function visibleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function values(html: string, pattern: RegExp): string[] {
  return [...html.matchAll(pattern)].map((match) => match[1] ?? "");
}

/** Everything the validator inspects, extracted from a page's HTML. */
function semantics(html: string) {
  return {
    ids: values(html, /\sid="([^"]*)"/g),
    hrefs: values(html, /<a\b[^>]*\shref="([^"]*)"/g),
    headings: [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((match) => `h${match[1]}:${visibleText(match[2] ?? "")}`),
    alts: values(html, /<img\b[^>]*\salt="([^"]*)"/g),
    labels: values(html, /<label\b[^>]*\sfor="([^"]*)"/g),
    controls: (html.match(/<(?:input|textarea|select)\b[^>]*>/gi) ?? []).map((tag) => /\sid="([^"]*)"/.exec(tag)?.[1] ?? ""),
    images: values(html, /<img\b[^>]*\ssrc="([^"]*)"/g),
    landmarks: (html.match(/<(?:main|nav|footer|section)\b/gi) ?? []).length,
    lang: /\slang="([^"]*)"/.exec(html)?.[1],
    dir: /\sdir="([^"]*)"/.exec(html)?.[1],
    text: visibleText(html),
  };
}

const cases: Array<[string, SiteSpec]> = [
  ["a full site with menu, services and photography", specFor(brandPack)],
  ["a site with no approved photography", specFor({ ...brandPack, assets: [] })],
  ["a site with no approved brand material at all", specFor(EMPTY_BRAND_PACK)],
  ["an Arabic, right-to-left site", specFor(brandPack, "JO")],
];

describe("the demo renderer agrees with react-dom/server", () => {
  for (const [name, spec] of cases) {
    for (const page of spec.pages) {
      it(`renders ${page.path || "the home page"} of ${name} identically`, () => {
        const mine = renderSpecPage(spec, page.path);
        const reference = renderToStaticMarkup(createElement(DemoSitePage, { spec, path: page.path }));
        expect(semantics(mine)).toEqual(semantics(reference));
      });
    }
  }

  it("escapes text and attribute content rather than emitting raw markup", () => {
    const spec = specFor(brandPack);
    const hostile: SiteSpec = {
      ...spec,
      footerNote: '</p><script>alert("x")</script> & "quoted" copy',
      businessName: 'Sumac & <Stone> "the room"',
    };
    const html = renderSpecPage(hostile, "");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(visibleText(html)).toContain('Sumac & <Stone> "the room"');
    expect(semantics(html)).toEqual(semantics(renderToStaticMarkup(createElement(DemoSitePage, { spec: hostile, path: "" }))));
  });

  it("refuses a component tree it cannot render rather than emitting a silently wrong page", () => {
    const spec = specFor(brandPack);
    expect(() => renderSpecPage({ ...spec, pages: [] }, "")).toThrow(/no page/i);
  });
});
