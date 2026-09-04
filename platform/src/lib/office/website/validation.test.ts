import { beforeAll, describe, expect, it } from "vitest";
import { brandPack, candidate, content, designProposal } from "../../../../test/support/website-fixtures";
import { buildSiteEvidence, type SiteEvidence } from "./evidence";
import { emitSiteFiles, routeSourceDir } from "./emit";
import { generateRestaurantWebsite } from "./factory";
import { renderSpecPage } from "./render";
import type { SiteSpec } from "./spec";
import { headingOutlineProblem, validateGeneratedSite, type EmittedFile } from "./validation";

/**
 * These tests exist to prove the validator has teeth. Each one takes a
 * site that passes cleanly and breaks exactly one thing, then asserts the
 * specific violation. A validator that only ever sees valid input proves
 * nothing, so every rule the brief names is broken here on purpose.
 */

let good: SiteSpec;
let evidence: SiteEvidence;

beforeAll(async () => {
  const generated = await generateRestaurantWebsite({
    projectKey: "SUMAC",
    route: "/demos/sumac",
    objective: "Show the kitchen a site that reads on a phone.",
    candidate,
    brandPack,
    generator: async () => ({ design: designProposal, content }) as never,
  });
  good = generated.spec;
  evidence = buildSiteEvidence({ candidate, brandPack });
});

function clone(spec: SiteSpec): SiteSpec {
  return JSON.parse(JSON.stringify(spec)) as SiteSpec;
}

function check(spec: SiteSpec, files?: EmittedFile[]) {
  return validateGeneratedSite({
    spec,
    evidence,
    files: files ?? emitSiteFiles(spec),
    routeSourceDir: routeSourceDir(spec),
  });
}

function codes(spec: SiteSpec, files?: EmittedFile[]): string[] {
  return check(spec, files).violations.map((item) => item.code);
}

describe("generated site validation", () => {
  it("passes the site the factory actually produced", () => {
    const report = check(good);
    expect(report.violations).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.checkedPages).toEqual(["/", "menu", "visit"]);
  });

  describe("photographs borrowed from the business's own host", () => {
    it("are loaded without telling that host where the demo lives", () => {
      // The demo is built before anyone has spoken to the restaurant. Every
      // photograph is a request their server logs, and a referrer would put
      // this preview's address in those logs days before the founder has
      // decided whether to contact them. It also gets past the hotlink
      // protection that keys on the header, which would otherwise leave a
      // hole in the page.
      const images = good.pages.flatMap((page) => renderSpecPage(good, page.path).match(/<img\b[^>]*>/gi) ?? []);
      expect(images.length).toBeGreaterThan(0);
      for (const tag of images) expect(tag).toContain('referrerpolicy="no-referrer"');
    });

    it("fail validation if that is ever dropped from the component", () => {
      // The rule lives in the validator, not only in the component, so
      // losing it stops a branch being pushed rather than quietly shipping
      // a demo that announces itself to the prospect.
      const report = validateGeneratedSite({
        spec: good,
        evidence,
        files: emitSiteFiles(good),
        routeSourceDir: routeSourceDir(good),
        renderPage: (spec, path) => renderSpecPage(spec, path).replaceAll(' referrerpolicy="no-referrer"', ""),
      });
      expect(report.violations.map((item) => item.code)).toContain("referrer_leak");
    });
  });

  describe("the preview route exists and renders", () => {
    it("fails when the route page was not emitted", () => {
      const files = emitSiteFiles(good).filter((file) => file.path !== "platform/src/app/demos/sumac/page.tsx");
      expect(codes(good, files)).toContain("route_missing");
    });

    it("fails when a page in the specification has no source file", () => {
      const files = emitSiteFiles(good).filter((file) => file.path !== "platform/src/app/demos/sumac/menu/page.tsx");
      expect(codes(good, files)).toContain("page_source_missing");
    });

    it("fails when a page source is not a route", () => {
      const files = emitSiteFiles(good).map((file) =>
        file.path === "platform/src/app/demos/sumac/page.tsx" ? { ...file, content: file.content.replace("export default function", "function") } : file,
      );
      expect(codes(good, files)).toContain("page_not_a_route");
    });

    it("fails when a generated file would escape the demo route directory", () => {
      const files = [...emitSiteFiles(good), { path: "platform/src/app/layout.tsx", content: "export default function X() { return null; }" }];
      expect(codes(good, files)).toContain("out_of_scope_file");
    });

    it("fails when the emitted metadata does not match the page", () => {
      const files = emitSiteFiles(good).map((file) =>
        file.path === "platform/src/app/demos/sumac/page.tsx" ? { ...file, content: file.content.replaceAll(JSON.stringify(good.pages[0]!.title), '"Something else"') } : file,
      );
      expect(codes(good, files)).toContain("metadata_title_mismatch");
    });

    it("fails when a page renders nothing", () => {
      const spec = clone(good);
      spec.pages[0]!.sections = spec.pages[0]!.sections.slice(0, 2);
      spec.pages[0]!.sections[0] = { kind: "closing", id: "a", heading: "Ok", body: "A very short page indeed, but a valid one.", cta: null };
      spec.pages[0]!.sections[1] = { kind: "closing", id: "b", heading: "Ok two", body: "Another short block of text here.", cta: null };
      expect(codes(spec)).toContain("render_empty");
    });
  });

  describe("navigation", () => {
    it("fails on a nav item pointing at a section that does not exist", () => {
      const spec = clone(good);
      spec.nav[0] = { label: "Ghost", href: "/demos/sumac#ghost", kind: "page" };
      expect(codes(spec)).toContain("dead_anchor");
    });

    it("fails on a nav item pointing at a route the site does not emit", () => {
      const spec = clone(good);
      spec.nav[0] = { label: "Ghost", href: "/demos/sumac/gallery", kind: "page" };
      expect(codes(spec)).toContain("dead_link");
    });

    it("fails on an in-page anchor with no target", () => {
      const spec = clone(good);
      const hero = spec.pages[0]!.sections[0]!;
      if (hero.kind !== "hero") throw new Error("fixture changed");
      hero.secondaryCta = { label: "Nowhere", href: "#nowhere", kind: "anchor", capability: null, evidenceKey: null };
      expect(codes(spec)).toContain("dead_anchor");
    });

    it("fails on a phone link that is not the researched number", () => {
      const spec = clone(good);
      spec.navCta = { label: "Call", href: "tel:+15550000000", kind: "tel", capability: null, evidenceKey: "business.phone" };
      expect(codes(spec)).toContain("unverified_contact");
    });

    it("fails on an email link that is not the researched address", () => {
      const spec = clone(good);
      const visit = spec.pages.find((page) => page.path === "visit")!;
      const contact = visit.sections.find((section) => section.kind === "contact")!;
      if (contact.kind !== "contact") throw new Error("fixture changed");
      contact.channels[0] = { label: "Mail", href: "mailto:someone@elsewhere.example", kind: "mailto", capability: null, evidenceKey: "business.email" };
      expect(codes(spec)).toContain("unverified_contact");
    });

    it("fails on an external link that is not an approved source", () => {
      const spec = clone(good);
      const visit = spec.pages[0]!.sections.find((section) => section.kind === "visit")!;
      if (visit.kind !== "visit") throw new Error("fixture changed");
      visit.actions[0] = { label: "Menu elsewhere", href: "https://aggregator.example.net/sumac", kind: "external", capability: null, evidenceKey: null };
      expect(codes(spec)).toContain("unverified_link");
    });

    it("fails on a link scheme a prospect demo may not render", () => {
      const spec = clone(good);
      spec.navCta = { label: "Chat", href: "whatsapp://send?phone=1", kind: "external", capability: null, evidenceKey: null };
      expect(codes(spec)).toContain("unsupported_link");
    });
  });

  describe("placeholder copy", () => {
    it.each([
      ["Lorem ipsum dolor sit amet, consectetur adipiscing elit and so on it goes.", "lorem"],
      ["TODO: write the closing paragraph for this restaurant before sending.", "todo"],
      ["Your headline here — replace this with something about the kitchen.", "your … here"],
      ["Reservations coming soon to this neighbourhood kitchen very shortly.", "coming soon"],
    ])("fails on %s", (text) => {
      const spec = clone(good);
      const closing = spec.pages[0]!.sections.find((section) => section.kind === "closing")!;
      if (closing.kind !== "closing") throw new Error("fixture changed");
      closing.body = text;
      expect(codes(spec)).toContain("placeholder_copy");
    });
  });

  describe("claims the evidence does not support", () => {
    it("fails when copy offers a service the ledger does not prove", () => {
      const spec = clone(good);
      const closing = spec.pages[0]!.sections.find((section) => section.kind === "closing")!;
      if (closing.kind !== "closing") throw new Error("fixture changed");
      closing.body = "Order online and have the whole mezze spread delivered to your door tonight.";
      const report = check(spec);
      expect(report.violations.filter((item) => item.code === "unsupported_service_claim").length).toBeGreaterThan(0);
    });

    it("fails when an action offers a capability the ledger does not prove", () => {
      const spec = clone(good);
      spec.navCta = { ...spec.navCta!, capability: "delivery" };
      expect(codes(spec)).toContain("unsupported_service_claim");
    });

    it("fails on awards, rankings and superlatives", () => {
      const spec = clone(good);
      const closing = spec.pages[0]!.sections.find((section) => section.kind === "closing")!;
      if (closing.kind !== "closing") throw new Error("fixture changed");
      closing.body = "An award-winning kitchen, voted the best restaurant in the neighbourhood.";
      expect(codes(spec)).toContain("unverifiable_claim");
    });

    it("fails on a number with no source in the evidence", () => {
      const spec = clone(good);
      const closing = spec.pages[0]!.sections.find((section) => section.kind === "closing")!;
      if (closing.kind !== "closing") throw new Error("fixture changed");
      closing.body = "Serving this corner since 1974, with seats for eighty guests every evening.";
      expect(codes(spec)).toContain("unverified_number");
    });

    it("allows a number that the approved research itself states", () => {
      const spec = clone(good);
      const closing = spec.pages[0]!.sections.find((section) => section.kind === "closing")!;
      if (closing.kind !== "closing") throw new Error("fixture changed");
      closing.body = "Find the room at 412 Dundas Street West and stay for the charcoal grill.";
      expect(codes(spec)).not.toContain("unverified_number");
    });

    it("fails when a fact does not match the approved value", () => {
      const spec = clone(good);
      const hero = spec.pages[0]!.sections[0]!;
      if (hero.kind !== "hero") throw new Error("fixture changed");
      hero.facts[0] = { label: "Address", value: "9 Queen Street East, Toronto", evidenceKey: "business.address" };
      expect(codes(spec)).toContain("fact_mismatch");
    });

    it("fails a fact that is merely a truncation of the approved value", () => {
      const spec = clone(good);
      const hero = spec.pages[0]!.sections[0]!;
      if (hero.kind !== "hero") throw new Error("fixture changed");
      hero.facts[0] = { label: "Address", value: "412 Dundas Street", evidenceKey: "business.address" };
      expect(codes(spec)).toContain("fact_mismatch");
    });

    it("fails when a fact cites evidence that does not exist", () => {
      const spec = clone(good);
      const hero = spec.pages[0]!.sections[0]!;
      if (hero.kind !== "hero") throw new Error("fixture changed");
      hero.facts[0] = { label: "Seats", value: "Eighty", evidenceKey: "business.seats" };
      expect(codes(spec)).toContain("missing_evidence");
    });

    it("fails when a menu item is not in the approved brand pack", () => {
      const spec = clone(good);
      const menu = spec.pages.find((page) => page.path === "menu")!.sections[0]!;
      if (menu.kind !== "menu") throw new Error("fixture changed");
      menu.categories[0]!.items.push({ name: "Wagyu tasting flight", description: null, price: null });
      expect(codes(spec)).toContain("unapproved_menu");
    });

    it("fails when a menu price was not verified", () => {
      const spec = clone(good);
      const menu = spec.pages.find((page) => page.path === "menu")!.sections[0]!;
      if (menu.kind !== "menu") throw new Error("fixture changed");
      menu.categories[0]!.items[0]!.price = "$19";
      expect(codes(spec)).toContain("unapproved_menu");
    });
  });

  describe("assets", () => {
    it("fails when the site carries an image that was never approved", () => {
      const spec = clone(good);
      spec.assets.push({ id: "borrowed", url: "https://images.example.net/stock-dinner.jpg", alt: "A stock photograph of a dinner table", credit: null });
      expect(codes(spec)).toContain("unapproved_asset");
    });

    it("fails when an approved asset's alternative text was rewritten", () => {
      const spec = clone(good);
      spec.assets[0]!.alt = "Something the approval never said";
      expect(codes(spec)).toContain("unapproved_asset");
    });

    it("fails when a section points at an image the site does not carry", () => {
      const spec = clone(good);
      const hero = spec.pages[0]!.sections[0]!;
      if (hero.kind !== "hero") throw new Error("fixture changed");
      hero.assetId = "missing-photo";
      expect(codes(spec)).toContain("dead_asset_reference");
    });
  });

  describe("accessibility and responsiveness", () => {
    it("proves one main landmark, one level-one heading and a working skip link on every page", () => {
      const report = check(good);
      expect(report.violations.filter((item) => ["heading_structure", "landmark_missing", "skip_link_missing", "skip_link_broken"].includes(item.code))).toEqual([]);
    });

    it.each([
      ["<h1>A</h1><h3>B</h3>", /skipping a level/],
      ["<h2>A</h2><h3>B</h3>", /first heading is a level 2/],
      ["<p>no headings</p>", /no headings at all/],
    ])("reports a broken heading outline in %s", (html, expected) => {
      expect(headingOutlineProblem(html)).toMatch(expected);
    });

    it("accepts an outline that only ever descends one level at a time", () => {
      expect(headingOutlineProblem("<h1>A</h1><h2>B</h2><h3>C</h3><h2>D</h2><h3>E</h3>")).toBeNull();
    });

    it("fails an illegible palette", () => {
      const spec = clone(good);
      spec.design.palette.muted = spec.design.palette.background;
      expect(codes(spec)).toContain("contrast");
    });

    it("proves the concept disclosure and the non-sending form notice survive rendering", () => {
      const report = check(good);
      expect(report.violations.filter((item) => ["disclosure_missing", "dishonest_form"].includes(item.code))).toEqual([]);
    });

    it("fails when two form controls would collapse onto one element id", () => {
      const spec = clone(good);
      const visit = spec.pages.find((page) => page.path === "visit")!;
      const contact = visit.sections.find((section) => section.kind === "contact")!;
      if (contact.kind !== "contact") throw new Error("fixture changed");
      // Two controls sharing one name collapse onto a single generated id,
      // so a label and an anchor could no longer resolve unambiguously.
      contact.form!.fields[1] = { ...contact.form!.fields[1]!, name: contact.form!.fields[0]!.name };
      expect(codes(spec)).toContain("duplicate_id");
    });
  });
});
