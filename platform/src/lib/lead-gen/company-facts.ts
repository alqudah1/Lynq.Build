import "server-only";
import { type CrmCompany } from "@/lib/crm/companies";
import { resolveMarketForLead, type LeadGenMarket } from "./markets";
import { buildOutreach, type BuiltOutreach } from "./outreach";
import { evaluateDemoEligibility, parseDemoReview, usesArabicContent, type DemoBusinessFacts, type DemoEligibility, type DemoReviewRecord } from "./demo-quality";

/**
 * ============================================================================
 * One derivation of "everything outreach needs to know about a company"
 * ============================================================================
 * The demo slug, the market, the business facts and the demo verdict were
 * each being re-derived inline in the leads table, the lead detail page and
 * (soon) the agent tools — three copies of the same country-code fallback,
 * three chances to disagree about which price a lead gets. They derive from
 * here now.
 */

export const PROSPECT_COMPANY_KEY_PREFIX = "lynq-prospect-company:";

/**
 * The public origin demos are served from. Env-driven so a preview
 * deployment links to itself rather than to production; falls back to the
 * production domain, which is what the CRM previously hard-coded.
 */
export function demoBaseUrl(): string {
  const configured = process.env.LYNQ_PUBLIC_APP_ORIGIN?.trim();
  if (configured && /^https:\/\/[^\s/]+$/.test(configured)) return configured;
  const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelUrl) return `https://${vercelUrl}`;
  return "https://app.lynq.build";
}

export function demoSlugForCompany(company: Pick<CrmCompany, "idempotencyKey"> | null | undefined): string | null {
  const key = company?.idempotencyKey;
  if (!key || !key.startsWith(PROSPECT_COMPANY_KEY_PREFIX)) return null;
  const slug = key.slice(PROSPECT_COMPANY_KEY_PREFIX.length);
  return /^[a-f0-9]{40}$/.test(slug) ? slug : null;
}

export function demoUrlForCompany(company: Pick<CrmCompany, "idempotencyKey"> | null | undefined): string | null {
  const slug = demoSlugForCompany(company);
  return slug ? `${demoBaseUrl()}/demo/${slug}` : null;
}

function readString(address: Record<string, unknown> | null, key: string): string | null {
  const value = address?.[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function readNumber(address: Record<string, unknown> | null, key: string): number | null {
  const value = address?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function countHours(address: Record<string, unknown> | null): number {
  const value = address?.hours;
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  return Object.values(value as Record<string, unknown>).filter((entry) => Array.isArray(entry) && entry.length > 0).length;
}

export function businessFactsForCompany(company: CrmCompany, contact?: { primaryEmail?: string | null; primaryPhone?: string | null } | null): DemoBusinessFacts {
  const address = company.address ?? null;
  return {
    name: company.name,
    category: readString(address, "category") ?? company.industry,
    city: readString(address, "city"),
    countryCode: readString(address, "countryCode"),
    rating: readNumber(address, "rating"),
    reviewCount: readNumber(address, "reviews"),
    phone: contact?.primaryPhone ?? company.phone,
    email: contact?.primaryEmail ?? null,
    website: company.website,
    photoUrl: readString(address, "photo"),
    description: readString(address, "description"),
    hoursCount: countHours(address),
  };
}

export interface CompanyOutreachContext {
  facts: DemoBusinessFacts;
  market: LeadGenMarket | null;
  demoSlug: string | null;
  demoUrl: string | null;
  review: DemoReviewRecord | null;
  eligibility: DemoEligibility;
  arabicContent: boolean;
  /** Null when there is no market or no demo — i.e. when outreach cannot be composed at all. */
  outreach: BuiltOutreach | null;
}

/**
 * Everything a caller needs to decide whether — and how — to contact this
 * business. Never throws: an unreachable or ineligible lead is a normal
 * state that the UI renders and the tools report, not an exception.
 */
export function resolveCompanyOutreachContext(company: CrmCompany, contact?: { primaryEmail?: string | null; primaryPhone?: string | null } | null): CompanyOutreachContext {
  const facts = businessFactsForCompany(company, contact);
  const market = resolveMarketForLead({ countryCode: facts.countryCode, phone: facts.phone });
  const demoSlug = demoSlugForCompany(company);
  const demoUrl = demoSlug ? `${demoBaseUrl()}/demo/${demoSlug}` : null;
  const review = parseDemoReview(company.demoReview);
  const eligibility = demoSlug
    ? evaluateDemoEligibility({ review, demoSlug })
    : { eligible: false as const, reason: "never_reviewed" as const, detail: "This company has no generated demo yet.", score: null };

  let outreach: BuiltOutreach | null = null;
  if (market && demoUrl) {
    try {
      outreach = buildOutreach({ market, businessName: company.name, demoUrl, rating: facts.rating, reviewCount: facts.reviewCount });
    } catch {
      // A name or URL the copy builder refuses is a data problem, surfaced
      // as "no outreach available" rather than a 500 on the leads table.
      outreach = null;
    }
  }

  return { facts, market, demoSlug, demoUrl, review, eligibility, arabicContent: usesArabicContent(facts), outreach };
}
