import { describe, expect, it, vi } from "vitest";
import { brandPack, candidate, content, designProposal } from "../../../../test/support/website-fixtures";
import { EMPTY_BRAND_PACK, MissingResearchError } from "./evidence";
import {
  generateRestaurantWebsite,
  WebsiteGenerationError,
  WebsiteProviderError,
  type WebsiteDraftGenerator,
  type WebsiteDraftRequest,
} from "./factory";

const PROJECT = { projectKey: "SUMAC", route: "/demos/sumac", objective: "Show the kitchen a site that reads on a phone." };

function generator(draft: unknown): WebsiteDraftGenerator {
  return async () => draft as never;
}

describe("restaurant website factory", () => {
  it("generates a validated multi-page site from approved research", async () => {
    const result = await generateRestaurantWebsite({
      ...PROJECT,
      candidate,
      brandPack,
      generator: generator({ design: designProposal, content }),
    });

    expect(result.report.ok).toBe(true);
    expect(result.report.violations).toEqual([]);
    expect(result.attempts).toBe(1);
    expect(result.spec.route).toBe("/demos/sumac");
    expect(result.spec.pages.map((page) => page.path)).toEqual(["", "menu", "visit"]);
    expect(result.report.checkedPages).toEqual(["/", "menu", "visit"]);

    // The direct preview route is a real App Router page, and each page
    // ships its own metadata rather than inheriting a generic title.
    const paths = result.files.map((file) => file.path);
    expect(paths).toContain("platform/src/app/demos/sumac/page.tsx");
    expect(paths).toContain("platform/src/app/demos/sumac/layout.tsx");
    expect(paths).toContain("platform/src/app/demos/sumac/menu/page.tsx");
    expect(paths).toContain("platform/src/app/demos/sumac/visit/page.tsx");
    const home = result.files.find((file) => file.path === "platform/src/app/demos/sumac/page.tsx")!.content;
    expect(home).toContain("export default function DemoHomePage");
    expect(home).toContain(JSON.stringify(content.siteTitle));

    // Every page actually rendered, and rendered substantially.
    for (const bytes of Object.values(result.report.renderedBytes)) expect(bytes).toBeGreaterThan(2000);

    // Real navigation: every nav target is a route this site emits.
    const routes = new Set(["/demos/sumac", "/demos/sumac/menu", "/demos/sumac/visit"]);
    for (const item of result.spec.nav) expect(routes.has(item.href.split("#")[0]!)).toBe(true);

    // Contact and booking actions are wired to the verified channels only.
    expect(result.spec.navCta?.href).toBe("tel:+14165550142");
    expect(result.designRationale).toContain("Charcoal counter");
    expect(result.evidenceTable).toContain("+1 416 555 0142");
  });

  it("refuses to build when the approved research is missing or malformed", async () => {
    await expect(
      generateRestaurantWebsite({ ...PROJECT, candidate: null, brandPack, generator: generator({ design: designProposal, content }) }),
    ).rejects.toBeInstanceOf(MissingResearchError);

    await expect(
      generateRestaurantWebsite({
        ...PROJECT,
        candidate: { ...candidate, sources: [] },
        brandPack,
        generator: generator({ design: designProposal, content }),
      }),
    ).rejects.toBeInstanceOf(MissingResearchError);
  });

  it("ships an image-free site, and says so, when no assets were approved", async () => {
    const result = await generateRestaurantWebsite({
      ...PROJECT,
      candidate,
      brandPack: { ...brandPack, assets: [] },
      generator: generator({ design: designProposal, content }),
    });

    expect(result.report.ok).toBe(true);
    expect(result.spec.assets).toEqual([]);
    expect(result.spec.pages.flatMap((page) => page.sections).some((section) => section.kind === "gallery")).toBe(false);
    expect(result.uncertainties.some((item) => item.includes("No approved photography"))).toBe(true);
  });

  it("degrades honestly when there is no brand pack at all", async () => {
    const result = await generateRestaurantWebsite({
      ...PROJECT,
      candidate,
      brandPack: EMPTY_BRAND_PACK,
      generator: generator({ design: designProposal, content }),
    });

    expect(result.report.ok).toBe(true);
    // No menu evidence means no menu page rather than an invented one.
    expect(result.spec.pages.map((page) => page.path)).toEqual(["", "visit"]);
    expect(result.uncertainties).toEqual(
      expect.arrayContaining([
        expect.stringContaining("No menu was verified"),
        expect.stringContaining("Opening hours were not verified"),
        expect.stringContaining("No bookable or orderable service"),
      ]),
    );
    // With no verified reservation service, nothing on the page may offer one.
    const ctas = result.spec.pages.flatMap((page) => page.sections).flatMap((section) => (section.kind === "visit" ? section.actions : []));
    expect(ctas.every((cta) => cta.capability === null)).toBe(true);
  });

  it("surfaces a provider outage as a provider failure after exhausting its attempts", async () => {
    const generate = vi.fn(async () => {
      throw new Error("Gateway upstream returned 503");
    });

    const error = await generateRestaurantWebsite({
      ...PROJECT,
      candidate,
      brandPack,
      attempts: 3,
      generator: generate as unknown as WebsiteDraftGenerator,
    }).catch((thrown) => thrown);

    expect(error).toBeInstanceOf(WebsiteProviderError);
    expect((error as WebsiteProviderError).attempts).toBe(3);
    expect((error as WebsiteProviderError).message).toContain("503");
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it("rejects structurally invalid model output instead of shipping it", async () => {
    const generate = vi.fn(async () => ({ design: designProposal, content: { ...content, hero: { headline: "Too short" } } }));

    const error = await generateRestaurantWebsite({
      ...PROJECT,
      candidate,
      brandPack,
      attempts: 2,
      generator: generate as unknown as WebsiteDraftGenerator,
    }).catch((thrown) => thrown);

    expect(error).toBeInstanceOf(WebsiteGenerationError);
    expect((error as WebsiteGenerationError).violations.some((item) => item.code === "invalid_output")).toBe(true);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("refuses copy that claims a service the evidence does not establish", async () => {
    const claiming = {
      ...content,
      highlights: {
        ...content.highlights,
        items: [
          ...content.highlights.items.slice(1),
          { title: "Delivered to your door", body: "Order online and we deliver across the neighbourhood every evening." },
        ],
      },
    };
    const error = await generateRestaurantWebsite({
      ...PROJECT,
      candidate,
      brandPack,
      attempts: 1,
      generator: generator({ design: designProposal, content: claiming }),
    }).catch((thrown) => thrown);

    expect(error).toBeInstanceOf(WebsiteGenerationError);
    const codes = (error as WebsiteGenerationError).violations.map((item) => item.code);
    expect(codes).toContain("unsupported_service_claim");
  });

  it("retries with the concrete violations and accepts the corrected attempt", async () => {
    const requests: WebsiteDraftRequest[] = [];
    const generate = vi.fn(async (request: WebsiteDraftRequest) => {
      requests.push(request);
      if (request.attempt === 1) {
        return {
          design: designProposal,
          content: {
            ...content,
            closing: { heading: "Award-winning charcoal", body: "Voted the best kitchen on the street, with free delivery every night." },
          },
        } as never;
      }
      return { design: designProposal, content } as never;
    });

    const result = await generateRestaurantWebsite({ ...PROJECT, candidate, brandPack, attempts: 3, generator: generate });

    expect(result.attempts).toBe(2);
    expect(result.report.ok).toBe(true);
    expect(requests[0]?.corrections).toEqual([]);
    const codes = (requests[1]?.corrections ?? []).map((item) => item.code);
    expect(codes).toContain("unverifiable_claim");
    expect(codes).toContain("unsupported_service_claim");
    expect(requests[1]?.evidenceBrief).toContain("Sumac & Stone");
  });

  it("falls back to the identity-seeded design when the model's direction is unusable, without inventing copy", async () => {
    const result = await generateRestaurantWebsite({
      ...PROJECT,
      candidate,
      brandPack,
      generator: generator({ design: { layout: "not-a-layout" }, content }),
    });

    expect(result.report.ok).toBe(true);
    expect(result.design.rationale).toContain("Derived from the business identity");
    expect(result.spec.pages[0]?.sections[0]).toMatchObject({ kind: "hero", heading: content.hero.headline });
  });
});
