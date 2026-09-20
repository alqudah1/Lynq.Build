// Arcubed Label — MOCK/DEV FALLBACK product data. NOT the real Arcubed
// catalog. Used only by the repository layer (src/lib/repository.ts) when no
// Supabase connection is configured, so local development still works
// without a live database. Ported 1:1 from the approved prototype
// (prototype/js/data.js) — mirrors supabase/seed.sql, which seeds the same
// mock catalog into a real Supabase project for development.

import type { Bag, Colour, StoreSettings, ShippingRule, ReturnPolicy } from "./types";

export const MOCK_COLOURS: Colour[] = [
  { id: "terracotta", name: "Terracotta", hex: "#C97B5A", isTwoTone: false, materialRef: null },
  { id: "sage", name: "Sage", hex: "#8FA187", isTwoTone: false, materialRef: null },
  { id: "blush", name: "Blush", hex: "#E8B4B8", isTwoTone: false, materialRef: null },
  { id: "cream", name: "Cream", hex: "#EFE3D3", isTwoTone: false, materialRef: null },
  { id: "charcoal", name: "Charcoal", hex: "#3B3630", isTwoTone: false, materialRef: null },
  { id: "mustard", name: "Mustard", hex: "#D9A441", isTwoTone: false, materialRef: null },
];

// Dev-only fallback for getStoreSettings()/getShippingRules() when Supabase
// isn't configured locally. Mirrors the real values seeded in
// supabase/migrations/20260902120200_seed_real_arcubed_catalog.sql — not
// invented, just a local copy so `npm run dev` works without a live DB.
// Production time follows the later
// 20260919210000_production_time_five_to_seven.sql (client request).
export const MOCK_STORE_SETTINGS: StoreSettings = {
  currencyCode: "JOD",
  productionTimeLabel: "5 to 7 days",
  productionTimeMinDays: 5,
  productionTimeMaxDays: 7,
  readyForDeliveryFulfillmentLabel: "Next day",
};

export const MOCK_SHIPPING_RULES: ShippingRule[] = [
  { zoneKey: "amman", label: "Inside Amman", amount: 3, currencyCode: "JOD", isQuoteRequired: false },
  { zoneKey: "rest_of_jordan", label: "Outside Amman", amount: 5, currencyCode: "JOD", isQuoteRequired: false },
  { zoneKey: "international", label: "Worldwide", amount: null, currencyCode: "JOD", isQuoteRequired: true },
];

export const MOCK_RETURN_POLICIES: ReturnPolicy[] = [
  {
    orderType: "custom",
    isReturnable: false,
    returnWindowDays: null,
    policySummary:
      "Custom, made-to-order bags are final sale. We don't offer change-of-mind returns or exchanges once an order is placed.",
    exceptionsSummary:
      "This doesn't apply to a defective item, a damaged item, an incorrect item, or any rights you have under applicable consumer law — those are always honoured regardless of order type.",
  },
  {
    orderType: "ready_for_delivery",
    isReturnable: null,
    returnWindowDays: null,
    policySummary: "Return/exchange terms for Ready for Delivery items are still being finalized. Check back soon, or contact us directly.",
    exceptionsSummary:
      "This doesn't apply to a defective item, a damaged item, an incorrect item, or any rights you have under applicable consumer law — those are always honoured regardless of order type.",
  },
];

function colours(...ids: string[]): Colour[] {
  return ids.map((id) => MOCK_COLOURS.find((c) => c.id === id)!);
}

export const MOCK_BAGS: Bag[] = [
  {
    id: "rosa-tote",
    slug: "rosa-tote",
    images: [],
    name: "Rosa Tote",
    tagline: "Structured, roomy, everyday.",
    basePrice: 120,
    colours: colours("terracotta", "sage", "blush", "cream", "charcoal", "mustard"),
    sizes: [
      { id: "sm", label: "Small", note: "Fits an iPad + essentials", priceDelta: 0 },
      { id: "md", label: "Medium", note: 'Fits a 13" laptop', priceDelta: 15 },
      { id: "lg", label: "Large", note: "Everyday carry-all", priceDelta: 30 },
    ],
    straps: [
      { id: "woven", label: "Woven Strap", priceDelta: 0, art: "woven" },
      { id: "braided", label: "Braided Strap", priceDelta: 12, art: "braided" },
      { id: "chain", label: "Chain Strap", priceDelta: 18, art: "chain" },
    ],
    addons: [
      { id: "charm", label: "Gold Charm", priceDelta: 8, art: "charm" },
      { id: "tassel", label: "Tassel", priceDelta: 6, art: "tassel" },
      { id: "pouch", label: "Zip Pouch", priceDelta: 15, art: "pouch" },
      { id: "monogram", label: "Monogram", priceDelta: 10, art: "monogram" },
    ],
  },
  {
    id: "luna-crossbody",
    slug: "luna-crossbody",
    images: [],
    name: "Luna Crossbody",
    tagline: "Small, sculpted, hands-free.",
    basePrice: 95,
    colours: colours("terracotta", "blush", "cream", "charcoal", "mustard"),
    sizes: [
      { id: "sm", label: "Small", note: "Phone, cards, keys", priceDelta: 0 },
      { id: "md", label: "Medium", note: "Adds room for sunglasses", priceDelta: 10 },
    ],
    straps: [
      { id: "woven", label: "Woven Strap", priceDelta: 0, art: "woven" },
      { id: "chain", label: "Chain Strap", priceDelta: 18, art: "chain" },
    ],
    addons: [
      { id: "charm", label: "Gold Charm", priceDelta: 8, art: "charm" },
      { id: "tassel", label: "Tassel", priceDelta: 6, art: "tassel" },
      { id: "monogram", label: "Monogram", priceDelta: 10, art: "monogram" },
    ],
  },
  {
    id: "mira-mini",
    slug: "mira-mini",
    images: [],
    name: "Mira Mini Bag",
    tagline: "A little colour, everywhere you go.",
    basePrice: 68,
    colours: colours("blush", "sage", "mustard", "terracotta"),
    sizes: [
      { id: "xs", label: "Extra Small", note: "Just the essentials", priceDelta: 0 },
      { id: "sm", label: "Small", note: "A little extra room", priceDelta: 8 },
    ],
    addons: [
      { id: "charm", label: "Gold Charm", priceDelta: 8, art: "charm" },
      { id: "tassel", label: "Tassel", priceDelta: 6, art: "tassel" },
    ],
  },
  {
    id: "coco-market",
    slug: "coco-market",
    images: [],
    name: "Coco Market Bag",
    tagline: "Oversized, breezy, market-ready.",
    basePrice: 140,
    colours: colours("cream", "sage", "terracotta", "charcoal"),
    sizes: [
      { id: "md", label: "Medium", note: "A day at the market", priceDelta: 0 },
      { id: "lg", label: "Large", note: "Beach + travel days", priceDelta: 20 },
    ],
    handles: [
      { id: "short", label: "Short Handle", priceDelta: 0, art: "handleShort" },
      { id: "long", label: "Long Handle", priceDelta: 10, art: "handleLong" },
    ],
    addons: [
      { id: "pouch", label: "Zip Pouch", priceDelta: 15, art: "pouch" },
      { id: "monogram", label: "Monogram", priceDelta: 10, art: "monogram" },
    ],
  },
];

export function getMockBag(idOrSlug: string | null | undefined): Bag | null {
  return MOCK_BAGS.find((b) => b.id === idOrSlug || b.slug === idOrSlug) ?? null;
}
