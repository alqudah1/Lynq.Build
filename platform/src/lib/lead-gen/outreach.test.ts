import { describe, it, expect } from "vitest";
import { resolveMarket } from "./markets";
import {
  OUTREACH_TEMPLATE_BODIES,
  OUTREACH_TEMPLATE_NAMES,
  OUTREACH_VARIABLE_BY_POSITION,
  buildOutreach,
  detectOptOutIntent,
  hasStrongReviews,
  namedOutreachTemplateBody,
  outreachTemplateValues,
  renderOutreachTemplateBody,
} from "./outreach";

const JORDAN = resolveMarket("JO");
const CANADA = resolveMarket("CA");

const STRONG = { rating: 4.8, reviewCount: 240 };

describe("outreach copy", () => {
  it("writes Jordanian outreach in English at 25 JOD", () => {
    const built = buildOutreach({ market: JORDAN, businessName: "Beit Sitti", demoUrl: "https://app.lynq.build/demo/" + "a".repeat(40), ...STRONG });
    expect(built.bodyText).toContain("Hi, this is Mustafa from LYNQ.");
    expect(built.bodyText).toContain("The subscription is 25 JOD per month.");
    expect(built.bodyText).toContain("reply STOP");
    // No Arabic anywhere — the Jordanian message used to be Levantine Arabic.
    expect(built.bodyText).not.toMatch(/[؀-ۿ]/);
  });

  it("writes Canadian outreach in English at 100 CAD", () => {
    const built = buildOutreach({ market: CANADA, businessName: "Drift Coffee", demoUrl: "https://app.lynq.build/demo/" + "b".repeat(40), ...STRONG });
    expect(built.bodyText).toContain("The subscription is 100 CAD per month.");
    expect(built.bodyText).not.toContain("JOD");
  });

  it("never quotes the other market's price", () => {
    const jordan = buildOutreach({ market: JORDAN, businessName: "Beit Sitti", demoUrl: "https://x.example/demo", ...STRONG });
    const canada = buildOutreach({ market: CANADA, businessName: "Drift Coffee", demoUrl: "https://x.example/demo", ...STRONG });
    expect(jordan.bodyText).not.toContain("100 CAD");
    expect(canada.bodyText).not.toContain("25 JOD");
  });

  it("passes business name, demo URL and price as the three template parameters", () => {
    const demoUrl = "https://app.lynq.build/demo/" + "c".repeat(40);
    const built = buildOutreach({ market: JORDAN, businessName: "Beit Sitti", demoUrl, ...STRONG });
    expect(built.templateParameters).toEqual(["Beit Sitti", demoUrl, "25 JOD"]);
    expect(OUTREACH_VARIABLE_BY_POSITION).toEqual(["businessName", "demoUrl", "price"]);
  });

  it("renders the same text the approved template will produce", () => {
    const built = buildOutreach({ market: CANADA, businessName: "Drift Coffee", demoUrl: "https://x.example/demo", ...STRONG });
    // This equality is the whole safety property: what a human approves in
    // LYNQ is character-for-character what Meta delivers.
    expect(renderOutreachTemplateBody(built.templateName, built.templateParameters)).toBe(built.bodyText);
  });

  it("keeps the named Communications OS body equivalent to the positional Meta body", () => {
    for (const templateName of Object.values(OUTREACH_TEMPLATE_NAMES)) {
      const values = { businessName: "Beit Sitti", demoUrl: "https://x.example/demo", price: "25 JOD" };
      const named = namedOutreachTemplateBody(templateName).replace(/\{\{(\w+)\}\}/g, (_m, key: string) => values[key as keyof typeof values]);
      const positional = renderOutreachTemplateBody(templateName, [values.businessName, values.demoUrl, values.price]);
      expect(named).toBe(positional);
    }
  });

  it("maps a built outreach to the named template values", () => {
    const built = buildOutreach({ market: JORDAN, businessName: "Beit Sitti", demoUrl: "https://x.example/demo", ...STRONG });
    expect(outreachTemplateValues(built)).toEqual({ businessName: "Beit Sitti", demoUrl: "https://x.example/demo", price: "25 JOD" });
  });

  it("only claims strong reviews when the numbers support it", () => {
    expect(hasStrongReviews({ rating: 4.8, reviewCount: 240 })).toBe(true);
    expect(hasStrongReviews({ rating: 4.8, reviewCount: 3 })).toBe(false);
    expect(hasStrongReviews({ rating: 3.9, reviewCount: 500 })).toBe(false);
    expect(hasStrongReviews({ rating: null, reviewCount: null })).toBe(false);
  });

  it("drops the review compliment for a business without strong review data", () => {
    const weak = buildOutreach({ market: CANADA, businessName: "New Cafe", demoUrl: "https://x.example/demo", rating: 4.9, reviewCount: 2 });
    expect(weak.templateName).toBe(OUTREACH_TEMPLATE_NAMES.withoutReviews);
    expect(weak.bodyText).not.toContain("strength of your reviews");
    // The offer itself is unchanged.
    expect(weak.bodyText).toContain("The subscription is 100 CAD per month.");
  });

  it("says the demo is a direction, not a finished website", () => {
    const built = buildOutreach({ market: CANADA, businessName: "Drift Coffee", demoUrl: "https://x.example/demo", ...STRONG });
    expect(built.bodyText).toContain("This is not the finished website or an off-the-shelf template.");
  });

  it("never claims the recipient previously gave permission", () => {
    for (const body of Object.values(OUTREACH_TEMPLATE_BODIES)) {
      expect(body.toLowerCase()).not.toMatch(/you (signed up|opted in|requested|subscribed)/);
      expect(body.toLowerCase()).not.toMatch(/as you requested|per your request/);
    }
  });

  it("refuses a template parameter that Meta would reject", () => {
    expect(() => renderOutreachTemplateBody(OUTREACH_TEMPLATE_NAMES.withReviews, ["Beit Sitti", "https://x.example/demo", ""])).toThrow(/missing parameter/);
    expect(() => renderOutreachTemplateBody(OUTREACH_TEMPLATE_NAMES.withReviews, ["Beit\nSitti", "https://x.example/demo", "25 JOD"])).toThrow(/newline or tab/);
  });

  it("refuses to compose outreach without a real name or an https demo URL", () => {
    expect(() => buildOutreach({ market: JORDAN, businessName: "   ", demoUrl: "https://x.example/demo" })).toThrow(/business name/);
    expect(() => buildOutreach({ market: JORDAN, businessName: "Beit Sitti", demoUrl: "http://x.example/demo" })).toThrow(/https demo URL/);
  });
});

describe("opt-out detection", () => {
  it("treats a bare stop keyword as an opt-out", () => {
    for (const text of ["STOP", "stop", " Stop. ", "unsubscribe", "Remove me", "opt out"]) {
      expect(detectOptOutIntent(text)).toBe("opt_out");
    }
  });

  it("treats a start keyword as an opt-in", () => {
    expect(detectOptOutIntent("START")).toBe("opt_in");
    expect(detectOptOutIntent("subscribe")).toBe("opt_in");
  });

  it("does not mistake ordinary sentences containing the word for an opt-out", () => {
    // Losing a warm lead because they wrote "stop by the shop" would be worse
    // than the keyword check missing an unusual phrasing.
    expect(detectOptOutIntent("stop by the shop tomorrow and we can talk")).toBeNull();
    expect(detectOptOutIntent("Can you stop sending at night? Mornings are better")).toBeNull();
    expect(detectOptOutIntent("")).toBeNull();
  });
});
