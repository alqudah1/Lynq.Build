import { z } from "zod";
import { designDirectionSchema, type DesignDirection } from "./design";
import { SERVICE_CAPABILITIES, type SiteEvidence } from "./evidence";

/**
 * The site specification is the whole website as data. Two properties make
 * it worth the indirection:
 *
 *  - Facts carry an `evidenceKey`. The validator resolves every one against
 *    the ledger and compares values, so a page cannot state something the
 *    approved research does not.
 *  - Navigation is assembled from the sections and pages that actually
 *    exist, so a dead link is a bug in the assembler rather than a thing a
 *    model can hallucinate — and the validator re-derives the same graph
 *    independently to prove it.
 *
 * The model contributes voice and emphasis (`websiteContentSchema`). The
 * assembler contributes facts, routes and wiring.
 */

const slug = z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,60}$/);

export const siteFactSchema = z.object({
  label: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(400),
  evidenceKey: z.string().trim().min(1).max(120),
});
export type SiteFact = z.infer<typeof siteFactSchema>;

export const CTA_KINDS = ["anchor", "page", "tel", "mailto", "external", "form"] as const;

export const ctaSchema = z.object({
  label: z.string().trim().min(2).max(60),
  href: z.string().trim().min(1).max(2000),
  kind: z.enum(CTA_KINDS),
  /** The service this action implies. Non-null only when the ledger proves the service exists. */
  capability: z.enum(SERVICE_CAPABILITIES).nullable(),
  evidenceKey: z.string().trim().max(120).nullable(),
});
export type SiteCta = z.infer<typeof ctaSchema>;

export const navItemSchema = z.object({
  label: z.string().trim().min(1).max(40),
  href: z.string().trim().min(1).max(300),
  /** "anchor" resolves inside the current page; "page" resolves to another emitted route. */
  kind: z.enum(["anchor", "page"]),
});
export type SiteNavItem = z.infer<typeof navItemSchema>;

const baseSection = { id: slug, heading: z.string().trim().min(2).max(160) };

export const sectionSchema = z.discriminatedUnion("kind", [
  z.object({
    ...baseSection,
    kind: z.literal("hero"),
    eyebrow: z.string().trim().min(2).max(80),
    subhead: z.string().trim().min(20).max(400),
    assetId: slug.nullable(),
    primaryCta: ctaSchema.nullable(),
    secondaryCta: ctaSchema.nullable(),
    facts: z.array(siteFactSchema).max(4),
  }),
  z.object({
    ...baseSection,
    kind: z.literal("story"),
    eyebrow: z.string().trim().min(2).max(80),
    paragraphs: z.array(z.string().trim().min(40).max(900)).min(1).max(4),
    assetId: slug.nullable(),
  }),
  z.object({
    ...baseSection,
    kind: z.literal("highlights"),
    intro: z.string().trim().max(400).nullable(),
    items: z.array(z.object({ title: z.string().trim().min(2).max(90), body: z.string().trim().min(20).max(400) })).min(2).max(6),
  }),
  z.object({
    ...baseSection,
    kind: z.literal("menu"),
    intro: z.string().trim().max(400).nullable(),
    categories: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(120),
          description: z.string().trim().max(400).nullable(),
          evidenceKey: z.string().trim().min(1).max(120),
          sourceUrl: z.string().url().max(2000),
          items: z.array(
            z.object({
              name: z.string().trim().min(1).max(120),
              description: z.string().trim().max(400).nullable(),
              price: z.string().trim().max(40).nullable(),
            }),
          ).min(1).max(24),
        }),
      )
      .min(1)
      .max(10),
  }),
  z.object({
    ...baseSection,
    kind: z.literal("services"),
    intro: z.string().trim().max(400).nullable(),
    items: z.array(
      z.object({
        capability: z.enum(SERVICE_CAPABILITIES),
        label: z.string().trim().min(2).max(80),
        detail: z.string().trim().max(300).nullable(),
        evidenceKey: z.string().trim().min(1).max(120),
        sourceUrl: z.string().url().max(2000),
      }),
    ).min(1).max(10),
  }),
  z.object({
    ...baseSection,
    kind: z.literal("gallery"),
    intro: z.string().trim().max(400).nullable(),
    assetIds: z.array(slug).min(1).max(8),
  }),
  z.object({
    ...baseSection,
    kind: z.literal("proof"),
    intro: z.string().trim().max(400).nullable(),
    facts: z.array(siteFactSchema).min(1).max(4),
    sourceUrl: z.string().url().max(2000).nullable(),
  }),
  z.object({
    ...baseSection,
    kind: z.literal("visit"),
    intro: z.string().trim().max(400).nullable(),
    facts: z.array(siteFactSchema).min(1).max(6),
    hours: z.array(z.object({ day: z.string().trim().min(1).max(40), hours: z.string().trim().min(1).max(80), evidenceKey: z.string().trim().min(1).max(120) })).max(14),
    mapUrl: z.string().url().max(2000).nullable(),
    actions: z.array(ctaSchema).max(4),
  }),
  z.object({
    ...baseSection,
    kind: z.literal("contact"),
    intro: z.string().trim().max(600).nullable(),
    channels: z.array(ctaSchema).max(4),
    form: z
      .object({
        introduction: z.string().trim().min(10).max(400),
        submitLabel: z.string().trim().min(2).max(60),
        /** Rendered next to the form. A demo form that cannot send must say so. */
        demoNotice: z.string().trim().min(10).max(300),
        fields: z.array(
          z.object({
            name: slug,
            label: z.string().trim().min(2).max(80),
            type: z.enum(["text", "email", "tel", "date", "number", "textarea", "select"]),
            required: z.boolean(),
            autoComplete: z.string().trim().max(40).nullable(),
            options: z.array(z.string().trim().min(1).max(80)).max(12).nullable(),
            help: z.string().trim().max(200).nullable(),
          }),
        ).min(2).max(8),
      })
      .nullable(),
  }),
  z.object({
    ...baseSection,
    kind: z.literal("closing"),
    body: z.string().trim().min(20).max(600),
    cta: ctaSchema.nullable(),
  }),
]);
export type SiteSection = z.infer<typeof sectionSchema>;

export const sitePageSchema = z.object({
  /** "" is the site root, i.e. the direct preview route itself. */
  path: z.union([z.literal(""), slug]),
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(40).max(300),
  sections: z.array(sectionSchema).min(2).max(10),
});
export type SitePage = z.infer<typeof sitePageSchema>;

export const siteSpecSchema = z.object({
  projectKey: z.string().trim().min(1).max(80),
  route: z.string().trim().regex(/^\/demos\/[a-z0-9][a-z0-9-]*$/),
  businessName: z.string().trim().min(1).max(200),
  locale: z.enum(["en", "ar"]),
  direction: z.enum(["ltr", "rtl"]),
  design: designDirectionSchema,
  nav: z.array(navItemSchema).min(2).max(7),
  navCta: ctaSchema.nullable(),
  pages: z.array(sitePageSchema).min(1).max(4),
  assets: z.array(z.object({ id: slug, url: z.string().url().max(2000), alt: z.string().trim().min(4).max(300), credit: z.string().trim().max(200).nullable() })).max(12),
  footerNote: z.string().trim().min(10).max(400),
  /** Shown on every page. A prospect demo must never be mistaken for the live business site. */
  demoDisclosure: z.string().trim().min(20).max(300),
});
export type SiteSpec = z.infer<typeof siteSpecSchema>;

/* ------------------------------------------------------------------ */
/* The model's contribution                                            */
/* ------------------------------------------------------------------ */

export const websiteContentSchema = z.object({
  siteTitle: z.string().trim().min(3).max(90),
  metaDescription: z.string().trim().min(40).max(200),
  hero: z.object({
    eyebrow: z.string().trim().min(2).max(60),
    headline: z.string().trim().min(8).max(120),
    subhead: z.string().trim().min(30).max(320),
    primaryCtaLabel: z.string().trim().min(2).max(40),
    secondaryCtaLabel: z.string().trim().min(2).max(40),
  }),
  story: z.object({
    eyebrow: z.string().trim().min(2).max(60),
    heading: z.string().trim().min(8).max(140),
    paragraphs: z.array(z.string().trim().min(60).max(700)).min(2).max(3),
  }),
  highlights: z.object({
    heading: z.string().trim().min(4).max(140),
    intro: z.string().trim().max(300),
    items: z.array(z.object({ title: z.string().trim().min(2).max(80), body: z.string().trim().min(30).max(320) })).min(3).max(4),
  }),
  menuHeading: z.string().trim().min(3).max(120),
  menuIntro: z.string().trim().max(300),
  servicesHeading: z.string().trim().min(3).max(120),
  galleryHeading: z.string().trim().min(3).max(120),
  proofHeading: z.string().trim().min(3).max(120),
  visitHeading: z.string().trim().min(3).max(120),
  visitIntro: z.string().trim().max(300),
  contactHeading: z.string().trim().min(3).max(120),
  contactIntro: z.string().trim().min(20).max(400),
  formIntroduction: z.string().trim().min(20).max(320),
  formSubmitLabel: z.string().trim().min(2).max(40),
  closing: z.object({ heading: z.string().trim().min(4).max(140), body: z.string().trim().min(20).max(400) }),
  navLabels: z.object({
    story: z.string().trim().min(1).max(30),
    highlights: z.string().trim().min(1).max(30),
    menu: z.string().trim().min(1).max(30),
    visit: z.string().trim().min(1).max(30),
    contact: z.string().trim().min(1).max(30),
  }),
  footerNote: z.string().trim().min(10).max(300),
});
export type WebsiteContent = z.infer<typeof websiteContentSchema>;

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

type SiteCopy = {
  disclosure: string;
  demoNotice: string;
  formFallbackNotice: string;
  skip: string;
  call: string;
  email: string;
  directions: string;
  officialSite: string;
  hours: string;
  hoursUnknown: string;
  address: string;
  rating: string;
  reviews: string;
  menuLink: string;
  visitLink: string;
  name: string;
  emailField: string;
  phoneField: string;
  partySize: string;
  preferredDate: string;
  message: string;
  noMenu: string;
};

const COPY: Record<"en" | "ar", SiteCopy> = {
  en: {
    disclosure: "Concept website prepared by LYNQ for review. It is not the business's official site and no message sent here reaches the business.",
    demoNotice: "This enquiry form is part of a concept and does not send anything. Use the phone number or email above to reach the business directly.",
    formFallbackNotice: "This enquiry form is part of a concept and does not send anything. It is here to show how a real booking request would be captured.",
    skip: "Skip to main content",
    call: "Call",
    email: "Email",
    directions: "Get directions",
    officialSite: "Current website",
    hours: "Opening hours",
    hoursUnknown: "Opening hours are not published on a source we could verify.",
    address: "Address",
    rating: "Public rating",
    reviews: "Public reviews",
    menuLink: "Menu",
    visitLink: "Visit",
    name: "Name",
    emailField: "Email",
    phoneField: "Phone",
    partySize: "Party size",
    preferredDate: "Preferred date",
    message: "What can we help with?",
    noMenu: "Menu details are not published on a source we could verify, so nothing is shown here yet.",
  },
  ar: {
    disclosure: "موقع تجريبي أعدّته LYNQ للمراجعة. ليس الموقع الرسمي للنشاط، ولا تصل أي رسالة تُرسل من هنا إلى النشاط.",
    demoNotice: "نموذج الاستفسار هذا جزء من تصور تجريبي ولا يرسل أي رسالة. استخدم رقم الهاتف أو البريد أعلاه للتواصل المباشر.",
    formFallbackNotice: "نموذج الاستفسار هذا جزء من تصور تجريبي ولا يرسل أي رسالة. وُضع ليوضح كيف يمكن استقبال طلب الحجز.",
    skip: "تخطَّ إلى المحتوى",
    call: "اتصال",
    email: "بريد إلكتروني",
    directions: "الاتجاهات",
    officialSite: "الموقع الحالي",
    hours: "ساعات العمل",
    hoursUnknown: "ساعات العمل غير منشورة في مصدر تمكنّا من التحقق منه.",
    address: "العنوان",
    rating: "التقييم العام",
    reviews: "عدد التقييمات",
    menuLink: "المنيو",
    visitLink: "الزيارة",
    name: "الاسم",
    emailField: "البريد الإلكتروني",
    phoneField: "الهاتف",
    partySize: "عدد الأشخاص",
    preferredDate: "التاريخ المفضل",
    message: "كيف يمكننا المساعدة؟",
    noMenu: "تفاصيل المنيو غير منشورة في مصدر تمكنّا من التحقق منه، لذلك لا تُعرض هنا.",
  },
};

function fact(evidence: SiteEvidence, key: string, label?: string): SiteFact | null {
  const found = evidence.facts.get(key);
  return found ? { label: label ?? found.label, value: found.value, evidenceKey: key } : null;
}

function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  return `tel:${digits.startsWith("+") ? `+${digits.slice(1).replace(/\D/g, "")}` : digits.replace(/\D/g, "")}`;
}

/**
 * A single reservation-shaped action is only offered when the ledger proves
 * the business takes reservations; otherwise the primary action is the
 * plainest verified channel it has. This is where "does not falsely claim
 * unavailable services" is *made* true; validation then proves it again.
 */
function primaryAction(evidence: SiteEvidence, label: string, copy: SiteCopy): SiteCta | null {
  const phone = evidence.facts.get("business.phone");
  const email = evidence.facts.get("business.email");
  const reservation = evidence.capabilities.has("reservation") ? "reservation" : null;
  if (phone) {
    return { label, href: telHref(phone.value), kind: "tel", capability: reservation, evidenceKey: "business.phone" };
  }
  if (email) {
    return { label: label || copy.email, href: `mailto:${email.value}`, kind: "mailto", capability: reservation, evidenceKey: "business.email" };
  }
  return null;
}

export function assembleSiteSpec(input: {
  projectKey: string;
  route: string;
  evidence: SiteEvidence;
  design: DesignDirection;
  content: WebsiteContent;
}): SiteSpec {
  const { evidence, content, design, route } = input;
  const copy = COPY[evidence.locale];
  const heroAsset = evidence.assets.find((asset) => asset.kind === "photo") ?? evidence.assets[0] ?? null;
  const galleryAssets = evidence.assets.filter((asset) => asset.id !== heroAsset?.id && asset.kind !== "logo");
  const address = fact(evidence, "business.address", copy.address);
  const rating = fact(evidence, "business.rating", copy.rating);
  const reviews = fact(evidence, "business.reviews", copy.reviews);
  const phone = evidence.facts.get("business.phone");
  const email = evidence.facts.get("business.email");
  const website = evidence.facts.get("business.website");
  const hasMenu = evidence.menu.length > 0;

  const contactChannels: SiteCta[] = [];
  if (phone) contactChannels.push({ label: `${copy.call} ${phone.value}`, href: telHref(phone.value), kind: "tel", capability: null, evidenceKey: "business.phone" });
  if (email) contactChannels.push({ label: email.value, href: `mailto:${email.value}`, kind: "mailto", capability: null, evidenceKey: "business.email" });
  if (website) contactChannels.push({ label: copy.officialSite, href: website.value, kind: "external", capability: null, evidenceKey: "business.website" });

  const mapUrl = address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.value)}` : null;
  const visitActions: SiteCta[] = [];
  if (mapUrl) visitActions.push({ label: copy.directions, href: mapUrl, kind: "external", capability: null, evidenceKey: "business.address" });
  if (phone) visitActions.push({ label: copy.call, href: telHref(phone.value), kind: "tel", capability: null, evidenceKey: "business.phone" });

  const homeSections: SiteSection[] = [
    {
      kind: "hero",
      id: "top",
      heading: content.hero.headline,
      eyebrow: content.hero.eyebrow,
      subhead: content.hero.subhead,
      assetId: heroAsset?.id ?? null,
      primaryCta: primaryAction(evidence, content.hero.primaryCtaLabel, copy),
      secondaryCta: { label: content.hero.secondaryCtaLabel, href: "#visit", kind: "anchor", capability: null, evidenceKey: null },
      facts: [address, rating].filter((item): item is SiteFact => Boolean(item)).slice(0, 4),
    },
    {
      kind: "story",
      id: "story",
      heading: content.story.heading,
      eyebrow: content.story.eyebrow,
      paragraphs: content.story.paragraphs,
      assetId: galleryAssets[0]?.id ?? null,
    },
    {
      kind: "highlights",
      id: "highlights",
      heading: content.highlights.heading,
      intro: content.highlights.intro || null,
      items: content.highlights.items,
    },
  ];

  if (evidence.services.length > 0) {
    homeSections.push({
      kind: "services",
      id: "services",
      heading: content.servicesHeading,
      intro: null,
      items: evidence.services.map((service) => ({
        capability: service.capability,
        label: service.label,
        detail: service.detail,
        evidenceKey: `service.${service.capability}`,
        sourceUrl: service.sourceUrl,
      })),
    });
  }

  if (galleryAssets.length >= 2) {
    homeSections.push({
      kind: "gallery",
      id: "gallery",
      heading: content.galleryHeading,
      intro: null,
      assetIds: galleryAssets.slice(0, 6).map((asset) => asset.id),
    });
  }

  if (rating || reviews) {
    homeSections.push({
      kind: "proof",
      id: "reputation",
      heading: content.proofHeading,
      intro: null,
      facts: [rating, reviews].filter((item): item is SiteFact => Boolean(item)),
      sourceUrl: evidence.sources[0]?.url ?? null,
    });
  }

  homeSections.push({
    kind: "visit",
    id: "visit",
    heading: content.visitHeading,
    intro: content.visitIntro || null,
    facts: [address, phone ? { label: copy.call, value: phone.value, evidenceKey: "business.phone" } : null].filter((item): item is SiteFact => Boolean(item)),
    hours: evidence.hours.map((row, index) => ({ day: row.day, hours: row.hours, evidenceKey: `hours.${index}` })),
    mapUrl,
    actions: visitActions,
  });

  homeSections.push({
    kind: "closing",
    id: "closing",
    heading: content.closing.heading,
    body: content.closing.body,
    cta: primaryAction(evidence, content.hero.primaryCtaLabel, copy),
  });

  const contactSection: SiteSection = {
    kind: "contact",
    id: "contact",
    heading: content.contactHeading,
    intro: content.contactIntro,
    channels: contactChannels,
    form: {
      introduction: content.formIntroduction,
      submitLabel: content.formSubmitLabel,
      demoNotice: contactChannels.length > 0 ? copy.demoNotice : copy.formFallbackNotice,
      fields: [
        { name: "name", label: copy.name, type: "text", required: true, autoComplete: "name", options: null, help: null },
        { name: "email", label: copy.emailField, type: "email", required: true, autoComplete: "email", options: null, help: null },
        { name: "phone", label: copy.phoneField, type: "tel", required: false, autoComplete: "tel", options: null, help: null },
        ...(evidence.capabilities.has("reservation")
          ? ([
              { name: "date", label: copy.preferredDate, type: "date" as const, required: false, autoComplete: null, options: null, help: null },
              { name: "party", label: copy.partySize, type: "number" as const, required: false, autoComplete: null, options: null, help: null },
            ])
          : []),
        { name: "message", label: copy.message, type: "textarea", required: true, autoComplete: null, options: null, help: null },
      ],
    },
  };

  // Page descriptions have a floor because a two-word meta description is
  // worse than no bespoke one; fall back to the site description rather
  // than shipping a page that fails its own schema.
  const description = (value: string) => (value.trim().length >= 40 ? value.trim().slice(0, 300) : content.metaDescription);

  const pages: SitePage[] = [
    { path: "", title: content.siteTitle, description: content.metaDescription, sections: homeSections },
  ];

  if (hasMenu) {
    pages.push({
      path: "menu",
      title: `${content.menuHeading} — ${evidence.businessName}`.slice(0, 120),
      description: description(content.menuIntro),
      sections: [
        {
          kind: "menu",
          id: "menu",
          heading: content.menuHeading,
          intro: content.menuIntro || null,
          categories: evidence.menu.map((category, index) => ({
            name: category.name,
            description: category.description,
            evidenceKey: `menu.${index}`,
            sourceUrl: category.sourceUrl,
            items: category.items,
          })),
        },
        { ...contactSection, id: "menu-contact" },
      ],
    });
  }

  pages.push({
    path: "visit",
    title: `${content.contactHeading} — ${evidence.businessName}`.slice(0, 120),
    description: description(content.contactIntro),
    sections: [
      { ...(homeSections.find((section) => section.kind === "visit") as SiteSection), id: "visit" },
      contactSection,
    ],
  });

  const nav: SiteNavItem[] = [
    { label: content.navLabels.story, href: `${route}#story`, kind: "page" },
    { label: content.navLabels.highlights, href: `${route}#highlights`, kind: "page" },
    ...(hasMenu ? [{ label: content.navLabels.menu, href: `${route}/menu`, kind: "page" as const }] : []),
    { label: content.navLabels.visit, href: `${route}/visit`, kind: "page" as const },
  ];

  return {
    projectKey: input.projectKey,
    route,
    businessName: evidence.businessName,
    locale: evidence.locale,
    direction: evidence.locale === "ar" ? "rtl" : "ltr",
    design,
    nav,
    navCta: primaryAction(evidence, content.hero.primaryCtaLabel, copy),
    pages,
    assets: evidence.assets.map((asset) => ({ id: asset.id, url: asset.url, alt: asset.alt, credit: asset.credit })),
    footerNote: content.footerNote,
    demoDisclosure: copy.disclosure,
  };
}

export function siteCopy(locale: "en" | "ar") {
  return COPY[locale];
}
