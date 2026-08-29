import { type LeadGenMarket } from "./markets";

/**
 * ============================================================================
 * Outreach copy — English for every market
 * ============================================================================
 * The body a prospect reads is defined ONCE, as a positional-parameter
 * template in exactly the form Meta's template editor accepts. The CRM
 * preview, the mailto/wa.me deep links and the real WhatsApp Cloud API
 * send all render the SAME string through `renderOutreachTemplateBody`,
 * so the text a human approves in LYNQ is character-for-character the text
 * Meta delivers. `outreach.test.ts` asserts that equivalence rather than
 * leaving it to convention.
 *
 * Two templates rather than one conditional string: WhatsApp templates are
 * fixed text with fixed parameter counts, so "especially the strength of
 * your reviews" cannot be a runtime `if`. A business without real,
 * strong review data gets the variant that does not mention reviews —
 * praising reviews a business does not have is a fabricated claim, and the
 * demo-quality rules forbid those.
 */

export const OUTREACH_TEMPLATE_NAMES = {
  /** For businesses with genuinely strong, verifiable review data. */
  withReviews: "lynq_demo_direction_reviews_en",
  /** For everyone else — same offer, no claim about reviews. */
  withoutReviews: "lynq_demo_direction_en",
} as const;

export type OutreachTemplateName = (typeof OUTREACH_TEMPLATE_NAMES)[keyof typeof OUTREACH_TEMPLATE_NAMES];

/**
 * Positional parameters, in Meta's own `{{n}}` order:
 *   {{1}} business name
 *   {{2}} demo URL
 *   {{3}} price display, e.g. "25 JOD" or "100 CAD"
 *
 * Paste these bodies verbatim into the WhatsApp Manager template editor.
 * Category: MARKETING. Language: English. No header, no buttons — the
 * opt-out sentence is part of the body so it survives template review.
 */
export const OUTREACH_TEMPLATE_BODIES: Record<OutreachTemplateName, string> = {
  [OUTREACH_TEMPLATE_NAMES.withReviews]: [
    "Hi, this is Mustafa from LYNQ. {{1}} stood out to me, especially the strength of your reviews, so I wanted to show you what your online presence could look like when it truly matches the quality of the business.",
    "",
    "Here is the direction I created for you:",
    "{{2}}",
    "",
    "This is not the finished website or an off-the-shelf template. It is simply a starting point so you can see the direction. If you like it, we would build the full version around your real brand and add the services or menu, booking, orders, WhatsApp and customer follow-up your business needs.",
    "",
    "I would value your reaction: should we keep developing this direction, or would a different style fit you better?",
    "",
    "The subscription is {{3}} per month. If you would rather not hear from us again, reply STOP.",
  ].join("\n"),

  [OUTREACH_TEMPLATE_NAMES.withoutReviews]: [
    "Hi, this is Mustafa from LYNQ. {{1}} stood out to me, so I wanted to show you what your online presence could look like when it truly matches the quality of the business.",
    "",
    "Here is the direction I created for you:",
    "{{2}}",
    "",
    "This is not the finished website or an off-the-shelf template. It is simply a starting point so you can see the direction. If you like it, we would build the full version around your real brand and add the services or menu, booking, orders, WhatsApp and customer follow-up your business needs.",
    "",
    "I would value your reaction: should we keep developing this direction, or would a different style fit you better?",
    "",
    "The subscription is {{3}} per month. If you would rather not hear from us again, reply STOP.",
  ].join("\n"),
};

/** A business may be described as having strong reviews only when the numbers actually support it. */
export const STRONG_REVIEW_MINIMUM_RATING = 4.3;
export const STRONG_REVIEW_MINIMUM_COUNT = 10;

export function hasStrongReviews(input: { rating?: number | null; reviewCount?: number | null }): boolean {
  const rating = typeof input.rating === "number" ? input.rating : null;
  const count = typeof input.reviewCount === "number" ? input.reviewCount : null;
  if (rating === null || count === null) return false;
  return rating >= STRONG_REVIEW_MINIMUM_RATING && count >= STRONG_REVIEW_MINIMUM_COUNT;
}

export interface OutreachParameters {
  businessName: string;
  demoUrl: string;
  priceDisplay: string;
}

/**
 * Substitutes `{{1}}`/`{{2}}`/`{{3}}` and nothing else. Every declared
 * placeholder must be supplied and non-empty, and no parameter may contain
 * a newline or tab — Meta rejects such a parameter outright, and finding
 * that out at send time rather than at draft time would leave a
 * half-approved batch stuck.
 */
export function renderOutreachTemplateBody(templateName: OutreachTemplateName, parameters: readonly string[]): string {
  const body = OUTREACH_TEMPLATE_BODIES[templateName];
  if (!body) throw new Error(`Unknown outreach template "${templateName}"`);

  const declared = new Set(Array.from(body.matchAll(/\{\{(\d+)\}\}/g), (m) => Number(m[1])));
  for (const index of declared) {
    const value = parameters[index - 1];
    if (value === undefined || value.trim() === "") throw new Error(`Outreach template "${templateName}" is missing parameter {{${index}}}`);
    if (/[\n\r\t]/.test(value)) throw new Error(`Outreach template parameter {{${index}}} must not contain a newline or tab`);
  }

  return body.replace(/\{\{(\d+)\}\}/g, (_match, raw: string) => parameters[Number(raw) - 1]);
}

export interface BuiltOutreach {
  templateName: OutreachTemplateName;
  /** Positional, ready for Meta's `components[].parameters`. */
  templateParameters: string[];
  /** The fully rendered text — identical to what Meta will deliver. */
  bodyText: string;
  /** Email only; WhatsApp has no subject. */
  emailSubject: string;
  market: LeadGenMarket;
}

export function buildOutreach(input: {
  market: LeadGenMarket;
  businessName: string;
  demoUrl: string;
  rating?: number | null;
  reviewCount?: number | null;
}): BuiltOutreach {
  const businessName = input.businessName.trim();
  if (!businessName) throw new Error("Outreach needs a real business name");
  const demoUrl = input.demoUrl.trim();
  if (!/^https:\/\/\S+$/.test(demoUrl)) throw new Error("Outreach needs an https demo URL");

  const templateName = hasStrongReviews({ rating: input.rating, reviewCount: input.reviewCount })
    ? OUTREACH_TEMPLATE_NAMES.withReviews
    : OUTREACH_TEMPLATE_NAMES.withoutReviews;

  const templateParameters = [businessName, demoUrl, input.market.priceDisplay];

  return {
    templateName,
    templateParameters,
    bodyText: renderOutreachTemplateBody(templateName, templateParameters),
    emailSubject: `A website direction for ${businessName}`,
    market: input.market,
  };
}

/** Keywords that opt a recipient out on sight, checked before any AI classification ever runs. */
export const OPT_OUT_KEYWORDS = ["stop", "unsubscribe", "cancel", "end", "quit", "stopall", "optout", "opt out", "remove me"] as const;
/** Keywords that opt a previously-opted-out recipient back in. */
export const OPT_IN_KEYWORDS = ["start", "unstop", "subscribe"] as const;

export type OptOutIntent = "opt_out" | "opt_in" | null;

/**
 * A deliberately literal, deterministic check on the whole message body —
 * never a model call. A recipient who replies "STOP" is opted out by this
 * function inside the webhook, before any classifier, queue or human is
 * involved. Only a message that is essentially just the keyword counts:
 * "stop by the shop tomorrow" is not an opt-out, and treating it as one
 * would silently lose a warm lead.
 */
export function detectOptOutIntent(bodyText: string): OptOutIntent {
  const normalized = bodyText
    .trim()
    .toLowerCase()
    .replace(/[.!,;:'"()\[\]]/g, "")
    .replace(/\s+/g, " ");
  if (!normalized) return null;
  if ((OPT_OUT_KEYWORDS as readonly string[]).includes(normalized)) return "opt_out";
  if ((OPT_IN_KEYWORDS as readonly string[]).includes(normalized)) return "opt_in";
  return null;
}

/**
 * ============================================================================
 * Named-variable form, for Communications OS templates
 * ============================================================================
 * Meta templates are positional (`{{1}}`); Communications OS templates are
 * named (`{{businessName}}`) with a declared variable schema. Both must
 * render byte-identical text, so the named form is DERIVED from the
 * positional one rather than written twice.
 */
export const OUTREACH_VARIABLE_BY_POSITION = ["businessName", "demoUrl", "price"] as const;
export type OutreachVariableName = (typeof OUTREACH_VARIABLE_BY_POSITION)[number];

export function namedOutreachTemplateBody(templateName: OutreachTemplateName): string {
  const body = OUTREACH_TEMPLATE_BODIES[templateName];
  if (!body) throw new Error(`Unknown outreach template "${templateName}"`);
  return body.replace(/\{\{(\d+)\}\}/g, (_match, raw: string) => {
    const name = OUTREACH_VARIABLE_BY_POSITION[Number(raw) - 1];
    if (!name) throw new Error(`Outreach template "${templateName}" uses undeclared position {{${raw}}}`);
    return `{{${name}}}`;
  });
}

export function outreachTemplateVariableDeclarations(): Array<{ name: OutreachVariableName; description: string; required: true }> {
  return [
    { name: "businessName", description: "The business's real name, exactly as stored in the CRM.", required: true },
    { name: "demoUrl", description: "The https URL of this business's own reviewed demo.", required: true },
    { name: "price", description: "Market-specific monthly price, e.g. \"25 JOD\" or \"100 CAD\".", required: true },
  ];
}

/** The named values corresponding to a built outreach's positional parameters. */
export function outreachTemplateValues(built: BuiltOutreach): Record<OutreachVariableName, string> {
  return {
    businessName: built.templateParameters[0],
    demoUrl: built.templateParameters[1],
    price: built.templateParameters[2],
  };
}

/** The Communications OS template key for one of the two outreach variants. */
export function outreachTemplateKey(templateName: OutreachTemplateName): string {
  return templateName.replace(/_/g, "-");
}
