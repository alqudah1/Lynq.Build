import type { BrandPack } from "@/lib/office/website/evidence";
import type { WebsiteContent } from "@/lib/office/website/spec";
import type { DesignProposal } from "@/lib/office/website/design";

/**
 * A founder-approved restaurant prospect and the copy a well-behaved model
 * would return for it. The copy deliberately contains no digits, no
 * superlatives and no service words the brand pack does not support, so a
 * test that fails on those rules is reporting a real regression rather
 * than a sloppy fixture.
 */

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

export const brandPack: BrandPack = {
  brandSignals: ["a neighbourhood kitchen", "charcoal grill", "family recipes"],
  assets: [
    {
      id: "dining-room",
      url: "https://cdn.example.ca/sumac/dining-room.jpg",
      alt: "The dining room at Sumac and Stone, with timber tables under warm pendant lights",
      kind: "photo",
      credit: "Photograph published on the restaurant's own site",
      sourceUrl: "https://sumacandstone.example.ca",
    },
    {
      id: "grill",
      url: "https://cdn.example.ca/sumac/grill.jpg",
      alt: "A cook turning skewers over the charcoal grill",
      kind: "photo",
      credit: null,
      sourceUrl: "https://sumacandstone.example.ca",
    },
    {
      id: "counter",
      url: "https://cdn.example.ca/sumac/counter.jpg",
      alt: "The front counter with a display of mezze",
      kind: "photo",
      credit: null,
      sourceUrl: "https://sumacandstone.example.ca",
    },
  ],
  menu: [
    {
      name: "Mezze",
      description: "Small plates shared across the table.",
      sourceUrl: "https://sumacandstone.example.ca",
      items: [
        { name: "Muhammara", description: "Roasted pepper and walnut", price: null },
        { name: "Labneh", description: null, price: null },
      ],
    },
    {
      name: "From the grill",
      description: null,
      sourceUrl: "https://sumacandstone.example.ca",
      items: [{ name: "Lamb skewers", description: null, price: null }],
    },
  ],
  services: [
    { capability: "dine-in", label: "Dining room", detail: "Open to walk-in guests.", sourceUrl: "https://sumacandstone.example.ca" },
    { capability: "reservation", label: "Table reservations", detail: "Tables can be held by phone.", sourceUrl: "https://listings.example.ca/sumac-and-stone" },
  ],
  hours: [
    { day: "Tuesday to Thursday", hours: "Evening service" },
    { day: "Friday and Saturday", hours: "Lunch and evening service" },
  ],
  sourceUrl: "https://sumacandstone.example.ca",
};

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
