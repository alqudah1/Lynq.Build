/**
 * ============================================================================
 * Lead-gen market configuration — the single source of truth
 * ============================================================================
 * Price, currency, sender number and outreach language for every market
 * LYNQ prospects in. Previously these lived inline in
 * `components/dashboard/crm/ContactActions.tsx`, which meant the WhatsApp
 * Cloud API sender, the CRM UI and any future agent-drafted message could
 * each drift to a different price. Everything that needs a price, a
 * sender or a language now reads it from here.
 *
 * Deliberately NOT env-configurable: a wrong price is a commercial
 * mistake, not a deployment variable, and it must be reviewable in a diff.
 * This module is import-safe on the client (no `server-only`) because the
 * CRM lead table renders the same copy the worker sends.
 */

export const LEAD_GEN_MARKET_CODES = ["JO", "CA"] as const;
export type LeadGenMarketCode = (typeof LEAD_GEN_MARKET_CODES)[number];

export interface LeadGenMarket {
  code: LeadGenMarketCode;
  countryName: string;
  /** ISO 4217. */
  currency: "JOD" | "CAD";
  /** Monthly subscription, in whole currency units. */
  monthlyPrice: number;
  /** Exactly how the price is written inside outreach — "25 JOD", "100 CAD". */
  priceDisplay: string;
  /**
   * The LYNQ WhatsApp sender for this market, E.164. This is the number
   * a real `whatsapp_cloud_api` connection for this market must resolve
   * to; `assertConnectionMatchesMarket` below is what actually enforces
   * that, so a Canadian lead can never be messaged from the Jordanian
   * number by a mis-selected connection.
   */
  senderPhoneE164: string;
  /** Human-facing rendering of the same number. */
  senderPhoneDisplay: string;
  /**
   * English for both markets. Jordanian outreach was previously Levantine
   * Arabic; it is English now by explicit instruction. Arabic content is
   * only ever produced when a business's own content is genuinely Arabic
   * (see `demo-quality.ts` on RTL).
   */
  outreachLanguage: "en";
  /** BCP-47 tag Meta expects in a template's `language.code`. */
  templateLanguageCode: "en";
}

const MARKETS: Record<LeadGenMarketCode, LeadGenMarket> = {
  JO: {
    code: "JO",
    countryName: "Jordan",
    currency: "JOD",
    monthlyPrice: 25,
    priceDisplay: "25 JOD",
    senderPhoneE164: "+962796940024",
    senderPhoneDisplay: "+962 79 694 0024",
    outreachLanguage: "en",
    templateLanguageCode: "en",
  },
  CA: {
    code: "CA",
    countryName: "Canada",
    currency: "CAD",
    monthlyPrice: 100,
    priceDisplay: "100 CAD",
    senderPhoneE164: "+16478927346",
    senderPhoneDisplay: "+1 647-892-7346",
    outreachLanguage: "en",
    templateLanguageCode: "en",
  },
};

export function isLeadGenMarketCode(value: unknown): value is LeadGenMarketCode {
  return typeof value === "string" && (LEAD_GEN_MARKET_CODES as readonly string[]).includes(value);
}

/** Throws rather than defaulting — an unknown market has no price, and guessing one is how a Jordanian business gets quoted 100 CAD. */
export function resolveMarket(code: LeadGenMarketCode): LeadGenMarket {
  return MARKETS[code];
}

export function tryResolveMarket(code: unknown): LeadGenMarket | null {
  return isLeadGenMarketCode(code) ? MARKETS[code] : null;
}

export function listMarkets(): LeadGenMarket[] {
  return LEAD_GEN_MARKET_CODES.map((code) => MARKETS[code]);
}

/**
 * Best-effort market inference for a lead whose company row carries no
 * explicit `countryCode`. Returns null rather than a guess — every caller
 * that needs a price treats null as "not eligible for outreach yet",
 * never as "use the default market". The previous CRM implementation fell
 * through to the Canadian branch on a null country, which would have
 * quoted 100 CAD to an unclassified Jordanian lead.
 */
export function inferMarketFromPhone(phone: string | null | undefined): LeadGenMarketCode | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("962")) return "JO";
  if (digits.startsWith("1") && digits.length === 11) return "CA";
  return null;
}

export function resolveMarketForLead(input: { countryCode?: string | null; phone?: string | null }): LeadGenMarket | null {
  const explicit = tryResolveMarket(input.countryCode);
  if (explicit) return explicit;
  const inferred = inferMarketFromPhone(input.phone);
  return inferred ? MARKETS[inferred] : null;
}
