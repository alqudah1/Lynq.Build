import {
  normalizeBrandPack,
  type BrandPack,
  type CollectedBrandPack,
} from "@/lib/office/website/brand-pack";
import type { WebsiteContent } from "@/lib/office/website/spec";
import type { DesignProposal } from "@/lib/office/website/design";

/**
 * A founder-approved restaurant prospect, the evidence a collector gathered
 * for it, and the copy a well-behaved model would return.
 *
 * The copy deliberately contains no digits, no superlatives and no service
 * words the brand pack does not support, so a test that fails on those
 * rules is reporting a real regression rather than a sloppy fixture. The
 * evidence is run through the real normaliser at a fixed clock, so the
 * pack — and therefore its fingerprint — is identical on every run.
 */

export const COLLECTED_AT = new Date("2026-08-20T00:00:00.000Z");
const RETRIEVED = "2026-08-18";

export const candidate = {
  name: "Sumac & Stone",
  address: "412 Dundas Street West, Toronto, ON",
  city: "Toronto",
  countryCode: "CA" as const,
  website: "https://sumacandstone.example.ca",
  email: "hello@sumacandstone.example.ca",
  phone: "+1 416 555 0142",
  rating: 4.6,
  reviews: 318,
  websiteScore: 34,
  opportunityScore: 82,
  whySelected: "A well-reviewed neighbourhood kitchen whose public site hides its menu behind an image and offers no way to get in touch from a phone.",
  websiteProblems: ["The menu is a flat image that phones cannot read", "No visible way to contact the kitchen from a phone"],
  demoOpportunities: ["A readable menu page", "A direct contact route from the header"],
  sources: [
    { title: "Official site", url: "https://sumacandstone.example.ca", supports: "Business name, address and contact details" },
    { title: "City listing", url: "https://listings.example.ca/sumac-and-stone", supports: "Rating, review count and opening hours" },
  ],
};

export const restaurantIdentity = {
  name: candidate.name,
  address: candidate.address,
  city: candidate.city,
  countryCode: candidate.countryCode,
};

function official(note: string | null = null) {
  return { sourceUrl: "https://sumacandstone.example.ca", sourceType: "official_website" as const, retrievedAt: RETRIEVED, confidence: "verified" as const, note };
}

function listing(note: string | null = null) {
  return { sourceUrl: "https://listings.example.ca/sumac-and-stone", sourceType: "public_listing" as const, retrievedAt: RETRIEVED, confidence: "verified" as const, note };
}

export const collectedBrandPack: CollectedBrandPack = {
  facts: [
    { key: "contact.phone", label: "Phone", value: "+1 416 555 0142", provenance: official("Printed in the site footer") },
    { key: "contact.email", label: "Email", value: "hello@sumacandstone.example.ca", provenance: official(null) },
  ],
  images: [
    {
      id: "dining-room",
      url: "https://cdn.example.ca/sumac/dining-room.jpg",
      alt: "The dining room at Sumac and Stone, with timber tables under warm pendant lights",
      kind: "photo",
      credit: "Photograph published on the restaurant's own site",
      provenance: official("Hero image on the home page"),
    },
    {
      id: "grill",
      url: "https://cdn.example.ca/sumac/grill.jpg",
      alt: "A cook turning skewers over the charcoal grill",
      kind: "photo",
      credit: null,
      provenance: official(null),
    },
    {
      id: "counter",
      url: "https://cdn.example.ca/sumac/counter.jpg",
      alt: "The front counter with a display of mezze",
      kind: "photo",
      credit: null,
      provenance: official(null),
    },
  ],
  menu: [
    {
      name: "Mezze",
      description: "Small plates shared across the table.",
      items: [
        { name: "Muhammara", description: "Roasted pepper and walnut", price: null },
        { name: "Labneh", description: null, price: null },
      ],
      provenance: official("Menu page"),
    },
    {
      name: "From the grill",
      description: null,
      items: [{ name: "Lamb skewers", description: null, price: null }],
      provenance: official("Menu page"),
    },
  ],
  services: [
    { capability: "dine-in", label: "Dining room", detail: "Open to walk-in guests.", provenance: official(null) },
    { capability: "reservation", label: "Table reservations", detail: "Tables can be held by phone.", provenance: listing("Listing states reservations are taken by phone") },
  ],
  hours: [
    { day: "Tuesday to Thursday", hours: "Evening service", provenance: official(null) },
    { day: "Friday and Saturday", hours: "Lunch and evening service", provenance: official(null) },
  ],
  socials: [
    { platform: "Instagram", url: "https://instagram.com/sumacandstone", provenance: official("Linked from the site header") },
  ],
  brandSignals: [
    { phrase: "a neighbourhood kitchen", provenance: official(null) },
    { phrase: "charcoal grill", provenance: official(null) },
    { phrase: "family recipes", provenance: official(null) },
  ],
  uncertain: [],
};

export function packFrom(collected: CollectedBrandPack, now: Date = COLLECTED_AT): BrandPack {
  return normalizeBrandPack({
    collected,
    restaurant: restaurantIdentity,
    officialWebsite: candidate.website,
    researchSources: candidate.sources.map((source) => source.url),
    now,
  });
}

export const brandPack: BrandPack = packFrom(collectedBrandPack);

export const designProposal: DesignProposal = {
  name: "Charcoal counter",
  rationale:
    "The kitchen leads with fire and shared plates, so the direction leans on a dark ground, a warm accent and a counter-forward hero that puts the contact action beside the name.",
  layout: "counter-forward",
  typeSystem: "transitional",
  motif: "hairline",
  density: "balanced",
  scheme: "dark",
  accentHue: 24,
  neutralHue: 30,
  neutralTint: 12,
  radius: 4,
};

export const content: WebsiteContent = {
  siteTitle: "Sumac & Stone — a neighbourhood kitchen in Toronto",
  metaDescription: "A neighbourhood kitchen on Dundas Street West, cooking mezze and charcoal-grilled plates for the tables around it.",
  hero: {
    eyebrow: "Dundas Street West",
    headline: "Charcoal, mezze and a room that fills up early",
    subhead: "A neighbourhood kitchen cooking family recipes over a charcoal grill, a short walk from the corner it has always been on.",
    primaryCtaLabel: "Call the kitchen",
    secondaryCtaLabel: "Plan a visit",
  },
  story: {
    eyebrow: "The kitchen",
    heading: "Family recipes, cooked over fire, served the way they are at home",
    paragraphs: [
      "The room is small and the grill is the loudest thing in it. Plates arrive as they are ready, which is why tables tend to order in waves and stay longer than they planned.",
      "Everything on the counter is prepared in the same kitchen the guests can see, and the menu moves with what the cooks can get their hands on that week.",
    ],
  },
  highlights: {
    heading: "What the room is built around",
    intro: "Three things the kitchen never compromises on, whatever else changes.",
    items: [
      { title: "The charcoal grill", body: "Skewers and vegetables go straight over live fire, which is why the room smells the way it does." },
      { title: "Shared plates", body: "Mezze is meant to be reached across a table rather than eaten from a single plate." },
      { title: "A room, not a lobby", body: "Timber tables, warm light and enough noise that a conversation feels private." },
    ],
  },
  menuHeading: "The menu",
  menuIntro: "Mezze to share and plates from the charcoal grill, listed as they appear on the kitchen's own published menu.",
  servicesHeading: "How to eat here",
  galleryHeading: "The room",
  proofHeading: "What guests say publicly",
  visitHeading: "Find the room",
  visitIntro: "The kitchen sits on Dundas Street West, and the quickest way to hold a table is to call.",
  contactHeading: "Get in touch",
  contactIntro: "Reach the kitchen directly by phone or email, or leave a note here and see how an enquiry would arrive.",
  formIntroduction: "Tell the kitchen who is coming and when, and this concept shows how the request would be captured.",
  formSubmitLabel: "Send the request",
  closing: {
    heading: "The grill is already lit",
    body: "Come for mezze, stay because the room is warm and the plates keep arriving.",
  },
  navLabels: {
    story: "Kitchen",
    highlights: "The room",
    menu: "Menu",
    visit: "Visit",
    contact: "Contact",
  },
  footerNote: "Sumac & Stone, Dundas Street West, Toronto.",
};
