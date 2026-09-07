// Arcubed Label — currency formatting utility.
//
// Store-wide facts (currency, production lead time, shipping rates) now live
// in the database (public.store_settings, public.shipping_rules) rather than
// as hardcoded constants here — see repository.ts's getStoreSettings() and
// getShippingRules(). Server Components fetch those directly; client
// components that need the resolved text (Customizer, the cart page) receive
// it as a prop from their nearest Server Component ancestor, the same way
// they already receive `bag`.
//
// Not server-only on purpose: currency formatting is needed in client
// components too (PriceDisplay, cart, etc.), and this file has no business
// values left to protect — just a pure formatting helper.

// Confirmed (Rand, 2026-09-02): Arcubed prices in JOD. Used as formatMoney's
// default so client components that haven't been threaded a live
// StoreSettings value yet still format correctly — keep this in sync with
// the store_settings.currency_code seed in
// supabase/migrations/20260902120200_seed_real_arcubed_catalog.sql.
export const DEFAULT_CURRENCY_CODE = "JOD";

/**
 * Currency-aware price formatting. JOD conventionally shows 2-3 decimal
 * places (fils); Jordan retail pricing is commonly quoted to the nearest
 * whole JOD, which is what every real Arcubed price in this catalog already
 * is (55, 50, 65...) — kept at 0 decimals so a "55 JOD" price never renders
 * as "55.000 JOD".
 */
export function formatMoney(amount: number, currencyCode: string = DEFAULT_CURRENCY_CODE): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}


/**
 * Arcubed's customer-facing copy uses no dashes as separators or ranges.
 *
 * Store settings are business data edited in the database, so a value like
 * "3\u20135 business days" is normalised at RENDER time rather than by
 * rewriting the row: the label stays whatever Rand set, and the storefront
 * still reads the way the brand does. Hyphens inside real compound words
 * ("hand-crocheted") are grammar and are left alone.
 */
export function plainText(value: string): string {
  return value
    .replace(/(\d)\s*[\u2013\u2014]\s*(\d)/g, "$1 to $2")
    .replace(/\s+[\u2013\u2014]\s+/g, ". ")
    .replace(/[\u2013\u2014]/g, " ");
}
