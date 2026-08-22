import { describe, it, expect } from "vitest";
import { LEAD_GEN_MARKET_CODES, inferMarketFromPhone, listMarkets, resolveMarket, resolveMarketForLead, tryResolveMarket } from "./markets";

describe("lead-gen markets", () => {
  it("prices Jordan at 25 JOD per month", () => {
    const jordan = resolveMarket("JO");
    expect(jordan.currency).toBe("JOD");
    expect(jordan.monthlyPrice).toBe(25);
    expect(jordan.priceDisplay).toBe("25 JOD");
  });

  it("prices Canada at 100 CAD per month", () => {
    const canada = resolveMarket("CA");
    expect(canada.currency).toBe("CAD");
    expect(canada.monthlyPrice).toBe(100);
    expect(canada.priceDisplay).toBe("100 CAD");
  });

  it("uses the configured sender number for each market", () => {
    expect(resolveMarket("JO").senderPhoneE164).toBe("+962796940024");
    expect(resolveMarket("JO").senderPhoneDisplay).toBe("+962 79 694 0024");
    expect(resolveMarket("CA").senderPhoneE164).toBe("+16478927346");
    expect(resolveMarket("CA").senderPhoneDisplay).toBe("+1 647-892-7346");
  });

  it("uses English outreach in every market", () => {
    for (const market of listMarkets()) {
      expect(market.outreachLanguage).toBe("en");
      expect(market.templateLanguageCode).toBe("en");
    }
  });

  it("covers exactly the two live markets", () => {
    expect([...LEAD_GEN_MARKET_CODES]).toEqual(["JO", "CA"]);
  });

  it("infers the market from an unambiguous phone number", () => {
    expect(inferMarketFromPhone("+962 79 694 0024")).toBe("JO");
    expect(inferMarketFromPhone("+1 647-892-7346")).toBe("CA");
  });

  it("refuses to guess a market it cannot determine", () => {
    // The regression this guards: the previous CRM code fell through to the
    // Canadian branch on an unknown country, quoting 100 CAD to a lead whose
    // market was simply not known.
    expect(inferMarketFromPhone("+44 20 7946 0000")).toBeNull();
    expect(inferMarketFromPhone(null)).toBeNull();
    expect(inferMarketFromPhone("")).toBeNull();
    expect(tryResolveMarket("GB")).toBeNull();
    expect(tryResolveMarket(undefined)).toBeNull();
    expect(resolveMarketForLead({ countryCode: null, phone: "+44 20 7946 0000" })).toBeNull();
  });

  it("prefers an explicit country code over the phone prefix", () => {
    expect(resolveMarketForLead({ countryCode: "JO", phone: "+1 647-892-7346" })?.code).toBe("JO");
  });

  it("falls back to the phone prefix only when no country code is stored", () => {
    expect(resolveMarketForLead({ countryCode: null, phone: "+962796940024" })?.code).toBe("JO");
  });
});
