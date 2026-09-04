import { contrastRatio } from "./design";
import { SERVICE_CAPABILITIES, type ServiceCapability, type SiteEvidence } from "./evidence";
import { renderSpecPage } from "./render";
import { siteSpecSchema, type SiteCta, type SiteSpec } from "./spec";

/**
 * Deterministic proof that a generated prospect website is fit to show a
 * founder. Nothing here asks a model for an opinion: every check is a
 * computation over the specification, the emitted files, and the actual
 * server-rendered HTML of every page.
 *
 * What it proves:
 *  - the preview route exists as a real file and every page renders;
 *  - no navigation target is dead — anchors resolve to ids that exist in
 *    the rendered page, cross-page links resolve to emitted routes, and
 *    every external, tel: and mailto: link traces to verified evidence;
 *  - no placeholder copy survives anywhere a visitor can read;
 *  - no service is claimed that the evidence ledger does not prove, and no
 *    number, award or superlative appears in prose without a source;
 *  - the accessibility and responsiveness invariants the components are
 *    supposed to guarantee actually held for this spec.
 */

export type ViolationSeverity = "error" | "warning";

export type WebsiteViolation = {
  code: string;
  severity: ViolationSeverity;
  where: string;
  message: string;
};

export type EmittedFile = { path: string; content: string };

export type ValidationReport = {
  ok: boolean;
  violations: WebsiteViolation[];
  /** Rendered HTML per page path, kept so callers can attach evidence to the founder report. */
  renderedBytes: Record<string, number>;
  checkedPages: string[];
};

const PLACEHOLDER_PATTERNS: Array<[RegExp, string]> = [
  [/lorem\s+ipsum/i, "lorem ipsum"],
  [/\bTODO\b/, "TODO"],
  [/\bTBD\b/, "TBD"],
  [/\bFIXME\b/, "FIXME"],
  [/placeholder/i, "placeholder"],
  [/coming soon/i, "coming soon"],
  [/your\s+(text|content|name|business|logo|tagline|headline)\s+here/i, "your … here"],
  [/\{\{/, "{{ template token"],
  [/\[(insert|add|your)\b/i, "[insert …]"],
  [/\bx{3,}\b/i, "xxx"],
  [/example\.(com|org)/i, "example.com"],
  [/\bsample (text|copy|content)\b/i, "sample text"],
  [/\breplace (this|with)\b/i, "replace this"],
  [/\b(business|restaurant|company) name\b/i, "generic business name"],
  [/\bn\/a\b/i, "n/a"],
  [/لوريم/, "lorem (ar)"],
  [/نص\s+تجريبي/, "sample text (ar)"],
  [/اسم\s+النشاط\b/, "generic business name (ar)"],
];

const CAPABILITY_CLAIMS: Record<ServiceCapability, RegExp[]> = {
  "dine-in": [/\bdine[-\s]?in\b/i, /تناول\s+الطعام\s+في\s+المطعم/],
  takeaway: [/\btake[-\s]?away\b/i, /\btake[-\s]?out\b/i, /\bto[-\s]go\b/i, /سفري/],
  delivery: [/\bdeliver(?:y|ies|ed|s)?\b/i, /توصيل/],
  reservation: [/\breserv(?:e|ed|ation|ations)\b/i, /\bbook(?:ing)?\s+a?\s*table\b/i, /حجز\s*(?:طاولة|طاولات)?/],
  "online-order": [/\border\s+online\b/i, /\bonline\s+order(?:ing|s)?\b/i, /الطلب\s+عبر\s+الإنترنت/],
  catering: [/\bcatering\b/i, /\bcater\s+(?:for|your)\b/i, /خدمات\s+الضيافة/, /تموين/],
  events: [/\bprivate\s+(?:events?|dining|hire)\b/i, /\bevent\s+space\b/i, /مناسبات\s+خاصة/],
  "gift-cards": [/\bgift\s+(?:card|voucher)s?\b/i, /بطاقات\s+هدايا/],
};

const UNVERIFIABLE_CLAIMS: Array<[RegExp, string]> = [
  [/award[-\s]?winning/i, "award claim"],
  [/\bmichelin\b/i, "Michelin claim"],
  [/\bbest\s+(?:restaurant|cafe|coffee|food|in\s+town|in\s+the)\b/i, "superlative ranking"],
  [/\bnumber\s+one\b|#1\b/i, "ranking claim"],
  [/\bvoted\b/i, "voted claim"],
  [/\bcertified\b/i, "certification claim"],
  [/\bmost\s+popular\b/i, "popularity claim"],
  [/\bfamous\s+for\b/i, "reputation claim"],
  [/\bguarantee(?:d|s)?\b/i, "guarantee"],
  [/\bfree\s+(?:delivery|parking|wifi)\b/i, "free-service claim"],
  [/جائزة/, "award claim (ar)"],
  [/الأفضل\s+في/, "superlative ranking (ar)"],
  [/الأشهر\b/, "popularity claim (ar)"],
];

const NUMERIC_TOKEN = /[0-9٠-٩]+(?:[.,:/%+-][0-9٠-٩]+)*/g;

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function violation(code: string, where: string, message: string, severity: ViolationSeverity = "error"): WebsiteViolation {
  return { code, where, message, severity };
}

/* ------------------------------------------------------------------ */
/* HTML inspection                                                     */
/* ------------------------------------------------------------------ */

function attributeValues(html: string, pattern: RegExp): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(pattern)) {
    if (match[1] !== undefined) found.push(decodeEntities(match[1]));
  }
  return found;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function visibleText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ");
}

/**
 * A screen reader's outline is the heading sequence. A page that jumps
 * from h1 straight to h3 has a hole in it, which is why this is checked
 * arithmetically here rather than left to a component to remember.
 */
export function headingOutlineProblem(html: string): string | null {
  const levels = [...html.matchAll(/<h([1-6])\b/gi)].map((match) => Number(match[1]));
  if (levels.length === 0) return "The page has no headings at all";
  if (levels[0] !== 1) return `The first heading is a level ${levels[0]} rather than a level 1`;
  for (let index = 1; index < levels.length; index += 1) {
    const previous = levels[index - 1]!;
    const current = levels[index]!;
    if (current > previous + 1) return `A level ${current} heading follows a level ${previous} heading, skipping a level`;
  }
  return null;
}

function linkTexts(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((match) => visibleText(match[1] ?? "").trim());
}

/* ------------------------------------------------------------------ */
/* Evidence helpers                                                    */
/* ------------------------------------------------------------------ */

function evidenceValues(evidence: SiteEvidence): string[] {
  const values = [...evidence.facts.values()].map((item) => item.value);
  for (const category of evidence.menu) {
    values.push(category.name, category.description ?? "");
    for (const item of category.items) values.push(item.name, item.description ?? "", item.price ?? "");
  }
  for (const service of evidence.services) values.push(service.label, service.detail ?? "");
  for (const row of evidence.hours) values.push(row.day, row.hours);
  values.push(...evidence.brandSignals, evidence.businessName, evidence.city);
  return values.filter(Boolean);
}

function allowedExternalUrls(evidence: SiteEvidence): Set<string> {
  const urls = new Set<string>();
  for (const source of evidence.sources) urls.add(source.url);
  for (const asset of evidence.assets) {
    urls.add(asset.url);
    urls.add(asset.sourceUrl);
  }
  for (const category of evidence.menu) urls.add(category.sourceUrl);
  for (const service of evidence.services) urls.add(service.sourceUrl);
  const website = evidence.facts.get("business.website");
  if (website) urls.add(website.value);
  const address = evidence.facts.get("business.address");
  if (address) urls.add(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.value)}`);
  return urls;
}

function telDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/* ------------------------------------------------------------------ */
/* Prose collection                                                    */
/* ------------------------------------------------------------------ */

/**
 * Everything a model wrote, as opposed to everything the ledger supplied.
 * Prose is held to the strictest rules — no numbers, no superlatives, no
 * service words the evidence does not support — because it is the only
 * surface where invention is even possible.
 */
export function collectProse(spec: SiteSpec): Array<{ where: string; text: string }> {
  const prose: Array<{ where: string; text: string }> = [];
  const push = (where: string, text: string | null | undefined) => {
    if (text && text.trim()) prose.push({ where, text });
  };
  push("footerNote", spec.footerNote);
  for (const item of spec.nav) push(`nav[${item.href}]`, item.label);
  if (spec.navCta) push("navCta", spec.navCta.label);
  for (const page of spec.pages) {
    const base = `page:${page.path || "/"}`;
    push(`${base}.title`, page.title);
    push(`${base}.description`, page.description);
    for (const section of page.sections) {
      const at = `${base}#${section.id}`;
      push(`${at}.heading`, section.heading);
      switch (section.kind) {
        case "hero":
          push(`${at}.eyebrow`, section.eyebrow);
          push(`${at}.subhead`, section.subhead);
          if (section.primaryCta) push(`${at}.primaryCta`, section.primaryCta.label);
          if (section.secondaryCta) push(`${at}.secondaryCta`, section.secondaryCta.label);
          break;
        case "story":
          push(`${at}.eyebrow`, section.eyebrow);
          section.paragraphs.forEach((paragraph, index) => push(`${at}.paragraph[${index}]`, paragraph));
          break;
        case "highlights":
          push(`${at}.intro`, section.intro);
          section.items.forEach((item, index) => {
            push(`${at}.item[${index}].title`, item.title);
            push(`${at}.item[${index}].body`, item.body);
          });
          break;
        case "menu":
        case "services":
        case "gallery":
        case "proof":
          push(`${at}.intro`, "intro" in section ? section.intro : null);
          break;
        case "visit":
          push(`${at}.intro`, section.intro);
          break;
        case "contact":
          push(`${at}.intro`, section.intro);
          if (section.form) {
            push(`${at}.form.introduction`, section.form.introduction);
            push(`${at}.form.submitLabel`, section.form.submitLabel);
            for (const field of section.form.fields) push(`${at}.form.${field.name}.label`, field.label);
          }
          break;
        case "closing":
          push(`${at}.body`, section.body);
          if (section.cta) push(`${at}.cta`, section.cta.label);
          break;
      }
    }
  }
  return prose;
}

function ctasOf(spec: SiteSpec): Array<{ where: string; cta: SiteCta }> {
  const items: Array<{ where: string; cta: SiteCta }> = [];
  if (spec.navCta) items.push({ where: "navCta", cta: spec.navCta });
  for (const page of spec.pages) {
    for (const section of page.sections) {
      const at = `page:${page.path || "/"}#${section.id}`;
      if (section.kind === "hero") {
        if (section.primaryCta) items.push({ where: `${at}.primaryCta`, cta: section.primaryCta });
        if (section.secondaryCta) items.push({ where: `${at}.secondaryCta`, cta: section.secondaryCta });
      }
      if (section.kind === "visit") section.actions.forEach((cta, index) => items.push({ where: `${at}.action[${index}]`, cta }));
      if (section.kind === "contact") section.channels.forEach((cta, index) => items.push({ where: `${at}.channel[${index}]`, cta }));
      if (section.kind === "closing" && section.cta) items.push({ where: `${at}.cta`, cta: section.cta });
    }
  }
  return items;
}

/* ------------------------------------------------------------------ */
/* The validator                                                       */
/* ------------------------------------------------------------------ */

export function validateGeneratedSite(input: {
  spec: SiteSpec;
  evidence: SiteEvidence;
  files: EmittedFile[];
  /** The repository-relative directory the route was emitted into, e.g. "platform/src/app/demos/acme". */
  routeSourceDir: string;
  /**
   * How a page becomes HTML. The real renderer by default; a test supplies
   * its own so a rule that only the component can break — the referrer
   * suppression below, for one — can still be proved to bite.
   */
  renderPage?: (spec: SiteSpec, path: string) => string;
}): ValidationReport {
  const violations: WebsiteViolation[] = [];
  const { spec, evidence, files } = input;
  const renderedBytes: Record<string, number> = {};

  const parsed = siteSpecSchema.safeParse(spec);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      violations.push(violation("spec_schema", issue.path.join(".") || "spec", issue.message));
    }
    // A spec that does not satisfy its own schema cannot be rendered
    // meaningfully; further checks would report noise instead of causes.
    return { ok: false, violations, renderedBytes, checkedPages: [] };
  }

  /* --- the preview route exists as real source ------------------- */

  const byPath = new Map(files.map((file) => [file.path, file.content]));
  const requiredRoot = `${input.routeSourceDir}/page.tsx`;
  if (!byPath.has(requiredRoot)) {
    violations.push(violation("route_missing", requiredRoot, `The preview route ${spec.route} has no page source`));
  }
  if (!byPath.has(`${input.routeSourceDir}/layout.tsx`)) {
    violations.push(violation("layout_missing", `${input.routeSourceDir}/layout.tsx`, "The demo route has no layout, so it cannot own its metadata"));
  }
  for (const page of spec.pages) {
    const file = page.path ? `${input.routeSourceDir}/${page.path}/page.tsx` : requiredRoot;
    const content = byPath.get(file);
    if (content === undefined) {
      violations.push(violation("page_source_missing", file, `Page "${page.path || "/"}" is in the specification but was not emitted`));
      continue;
    }
    if (!/export\s+default\s+function\s/.test(content)) {
      violations.push(violation("page_not_a_route", file, "An App Router page must export a default component"));
    }
    if (!/export\s+const\s+metadata\b/.test(content)) {
      violations.push(violation("metadata_missing", file, "The page does not export metadata, so it would ship without a title or description"));
    }
    if (!content.includes(JSON.stringify(page.title))) {
      violations.push(violation("metadata_title_mismatch", file, "The emitted metadata title does not match the specification"));
    }
  }
  for (const file of files) {
    if (!file.path.startsWith(`${input.routeSourceDir}/`)) {
      violations.push(violation("out_of_scope_file", file.path, "A generated demo may only write inside its own route directory"));
    }
  }

  /* --- every page renders ---------------------------------------- */

  const pageRoutes = new Map<string, string>();
  for (const page of spec.pages) pageRoutes.set(page.path ? `${spec.route}/${page.path}` : spec.route, page.path);
  const renderedIds = new Map<string, Set<string>>();
  const renderedHtml = new Map<string, string>();

  for (const page of spec.pages) {
    let html = "";
    try {
      html = (input.renderPage ?? renderSpecPage)(spec, page.path);
    } catch (error) {
      violations.push(violation("render_failed", `page:${page.path || "/"}`, `The page threw while rendering: ${(error as Error).message}`));
      continue;
    }
    // Chrome (navigation, disclosure, footer) renders even for an empty
    // page, so emptiness is measured on the main landmark alone.
    const main = /<main\b[^>]*>([\s\S]*)<\/main>/i.exec(html)?.[1] ?? "";
    if (visibleText(main).trim().length < 400) {
      violations.push(violation("render_empty", `page:${page.path || "/"}`, "The page's main content rendered almost nothing, so the route would look broken"));
    }
    renderedHtml.set(page.path, html);
    renderedBytes[page.path || "/"] = Buffer.byteLength(html, "utf8");
    const ids = attributeValues(html, /\sid="([^"]*)"/g);
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) {
        violations.push(violation("duplicate_id", `page:${page.path || "/"}`, `More than one element renders with id "${id}", so labels and anchors resolve ambiguously`));
      }
      seen.add(id);
    }
    renderedIds.set(page.path, seen);
  }

  /* --- navigation resolves --------------------------------------- */

  const externalAllowed = allowedExternalUrls(evidence);
  const phone = evidence.facts.get("business.phone");
  const email = evidence.facts.get("business.email");

  const checkHref = (where: string, href: string, pagePath: string) => {
    const ids = renderedIds.get(pagePath) ?? new Set<string>();
    if (href.startsWith("#")) {
      const target = href.slice(1);
      if (!ids.has(target)) violations.push(violation("dead_anchor", where, `"${href}" does not resolve to anything on this page`));
      return;
    }
    if (href.startsWith("/")) {
      const [routePart, fragment] = href.split("#");
      const targetPath = pageRoutes.get(routePart ?? "");
      if (targetPath === undefined) {
        violations.push(violation("dead_link", where, `"${href}" points at a route this demo does not emit`));
        return;
      }
      if (fragment && !(renderedIds.get(targetPath) ?? new Set()).has(fragment)) {
        violations.push(violation("dead_anchor", where, `"${href}" points at a section that does not exist on that page`));
      }
      return;
    }
    if (href.startsWith("tel:")) {
      if (!phone || telDigits(href) !== telDigits(phone.value)) {
        violations.push(violation("unverified_contact", where, `"${href}" is not the phone number in the approved research`));
      }
      return;
    }
    if (href.startsWith("mailto:")) {
      if (!email || href.slice("mailto:".length).toLowerCase() !== email.value.toLowerCase()) {
        violations.push(violation("unverified_contact", where, `"${href}" is not the email address in the approved research`));
      }
      return;
    }
    if (href.startsWith("https://")) {
      if (!externalAllowed.has(href)) {
        violations.push(violation("unverified_link", where, `"${href}" is not one of the approved sources or assets`));
      }
      return;
    }
    violations.push(violation("unsupported_link", where, `"${href}" is not a link this demo is allowed to render`));
  };

  for (const [pagePath, html] of renderedHtml) {
    const where = `page:${pagePath || "/"}`;
    for (const href of attributeValues(html, /<a\b[^>]*\shref="([^"]*)"/g)) {
      checkHref(`${where} link`, href, pagePath);
    }
    for (const text of linkTexts(html)) {
      if (!text) violations.push(violation("unlabelled_link", where, "A link renders with no accessible text"));
    }
    if (spec.nav.length < 2) violations.push(violation("nav_too_small", where, "A site needs real navigation, not a single link"));
  }

  /* --- placeholder copy ------------------------------------------ */

  const prose = collectProse(spec);
  for (const { where, text } of prose) {
    for (const [pattern, label] of PLACEHOLDER_PATTERNS) {
      if (pattern.test(text)) violations.push(violation("placeholder_copy", where, `Placeholder copy (${label}) would ship to the founder`));
    }
  }
  for (const [pagePath, html] of renderedHtml) {
    const text = visibleText(html);
    for (const [pattern, label] of PLACEHOLDER_PATTERNS) {
      if (pattern.test(text)) violations.push(violation("placeholder_copy", `page:${pagePath || "/"}`, `Placeholder copy (${label}) is visible on the rendered page`));
    }
  }

  /* --- claims the evidence does not support ---------------------- */

  const values = evidenceValues(evidence).map((value) => value.toLowerCase());
  const containsInEvidence = (token: string) => values.some((value) => value.includes(token.toLowerCase()));

  for (const { where, text } of prose) {
    for (const [pattern, label] of UNVERIFIABLE_CLAIMS) {
      if (pattern.test(text)) violations.push(violation("unverifiable_claim", where, `Copy makes an unverifiable ${label}`));
    }
    for (const capability of SERVICE_CAPABILITIES) {
      if (evidence.capabilities.has(capability)) continue;
      if (CAPABILITY_CLAIMS[capability].some((pattern) => pattern.test(text))) {
        violations.push(violation("unsupported_service_claim", where, `Copy implies "${capability}", which the approved evidence does not establish`));
      }
    }
    for (const token of text.match(NUMERIC_TOKEN) ?? []) {
      if (!containsInEvidence(token)) {
        violations.push(violation("unverified_number", where, `"${token}" is a number with no source in the approved evidence`));
      }
    }
  }

  for (const { where, cta } of ctasOf(spec)) {
    if (cta.capability && !evidence.capabilities.has(cta.capability)) {
      violations.push(violation("unsupported_service_claim", where, `This action offers "${cta.capability}", which the approved evidence does not establish`));
    }
    if (cta.evidenceKey && !evidence.facts.has(cta.evidenceKey)) {
      violations.push(violation("missing_evidence", where, `Action cites "${cta.evidenceKey}", which is not in the evidence ledger`));
    }
  }

  /* --- facts trace to the ledger --------------------------------- */

  const checkFact = (where: string, evidenceKey: string, value: string) => {
    const entry = evidence.facts.get(evidenceKey);
    if (!entry) {
      violations.push(violation("missing_evidence", where, `Fact cites "${evidenceKey}", which is not in the evidence ledger`));
      return;
    }
    if (normalize(value) !== normalize(entry.value)) {
      violations.push(violation("fact_mismatch", where, `"${value}" does not match the approved value "${entry.value}"`));
    }
  };

  for (const page of spec.pages) {
    for (const section of page.sections) {
      const at = `page:${page.path || "/"}#${section.id}`;
      if (section.kind === "hero" || section.kind === "proof" || section.kind === "visit") {
        section.facts.forEach((item, index) => checkFact(`${at}.fact[${index}]`, item.evidenceKey, item.value));
      }
      if (section.kind === "visit") {
        section.hours.forEach((row, index) => checkFact(`${at}.hours[${index}]`, row.evidenceKey, `${row.day}: ${row.hours}`));
      }
      if (section.kind === "services") {
        section.items.forEach((item, index) => {
          if (!evidence.capabilities.has(item.capability)) {
            violations.push(violation("unsupported_service_claim", `${at}.service[${index}]`, `"${item.capability}" is presented as a service without approved evidence`));
          }
          checkFact(`${at}.service[${index}]`, item.evidenceKey, item.label);
        });
      }
      if (section.kind === "menu") {
        section.categories.forEach((category, index) => {
          checkFact(`${at}.menu[${index}]`, category.evidenceKey, category.name);
          const approved = evidence.menu.find((entry) => entry.name === category.name);
          if (!approved) {
            violations.push(violation("unapproved_menu", `${at}.menu[${index}]`, `Menu category "${category.name}" is not in the approved brand pack`));
            return;
          }
          for (const item of category.items) {
            if (!approved.items.some((entry) => entry.name === item.name && (entry.price ?? null) === (item.price ?? null))) {
              violations.push(violation("unapproved_menu", `${at}.menu[${index}]`, `Menu item "${item.name}" or its price is not in the approved brand pack`));
            }
          }
        });
      }
      if (section.kind === "contact" && section.form) {
        // The notice has to survive rendering, not merely exist in the
        // specification: a component regression that drops it would leave
        // a prospect's customer believing the message was sent.
        const html = renderedHtml.get(page.path) ?? "";
        if (!visibleText(html).includes(section.form.demoNotice)) {
          violations.push(violation("dishonest_form", at, "The rendered page does not tell the visitor that this form cannot send anything"));
        }
      }
    }
  }

  /* --- assets ----------------------------------------------------- */

  const approvedAssets = new Map(evidence.assets.map((asset) => [asset.id, asset]));
  for (const asset of spec.assets) {
    const approved = approvedAssets.get(asset.id);
    if (!approved) {
      violations.push(violation("unapproved_asset", `asset:${asset.id}`, "The site references an image that is not in the approved asset list"));
      continue;
    }
    if (approved.url !== asset.url) violations.push(violation("unapproved_asset", `asset:${asset.id}`, "The image URL does not match the approved asset"));
    if (approved.alt !== asset.alt) violations.push(violation("unapproved_asset", `asset:${asset.id}`, "The alternative text does not match the approved asset"));
    if (!asset.url.startsWith("https://")) violations.push(violation("insecure_asset", `asset:${asset.id}`, "Assets must be served over https"));
  }
  const referenced = new Set<string>();
  for (const page of spec.pages) {
    for (const section of page.sections) {
      if ((section.kind === "hero" || section.kind === "story") && section.assetId) referenced.add(section.assetId);
      if (section.kind === "gallery") section.assetIds.forEach((id) => referenced.add(id));
    }
  }
  for (const id of referenced) {
    if (!spec.assets.some((asset) => asset.id === id)) {
      violations.push(violation("dead_asset_reference", `asset:${id}`, "A section references an image the site does not carry"));
    }
  }
  if (evidence.assets.length === 0) {
    for (const [pagePath, html] of renderedHtml) {
      if (/<img\b/i.test(html)) {
        violations.push(violation("unapproved_asset", `page:${pagePath || "/"}`, "The page renders an image although no asset was approved"));
      }
    }
  }

  /* --- accessibility and responsiveness --------------------------- */

  for (const [pagePath, html] of renderedHtml) {
    const where = `page:${pagePath || "/"}`;
    const h1Count = (html.match(/<h1\b/gi) ?? []).length;
    if (h1Count !== 1) violations.push(violation("heading_structure", where, `A page needs exactly one level-one heading; this one has ${h1Count}`));
    const outline = headingOutlineProblem(html);
    if (outline) violations.push(violation("heading_structure", where, outline));
    if ((html.match(/<main\b/gi) ?? []).length !== 1) violations.push(violation("landmark_missing", where, "A page needs exactly one main landmark"));
    if (!/<nav\b[^>]*aria-label="/i.test(html)) violations.push(violation("landmark_missing", where, "The navigation landmark needs an accessible name"));
    if (!/href="#demo-main"/.test(html)) violations.push(violation("skip_link_missing", where, "The page has no skip link to its main content"));
    if (!(renderedIds.get(pagePath) ?? new Set()).has("demo-main")) {
      violations.push(violation("skip_link_broken", where, "The skip link does not resolve to the main landmark"));
    }
    for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
      const alt = /\salt="([^"]*)"/.exec(tag);
      if (!alt || !alt[1]?.trim()) violations.push(violation("image_alt_missing", where, "An image renders without alternative text"));
      // Every photograph here is hotlinked from the business's own host, so
      // each one is a request their server logs. Sending no referrer keeps
      // this preview's address out of those logs until the founder has
      // decided to make contact — and gets past the referrer-based hotlink
      // protection that would otherwise leave a hole in the page.
      if (!/\sreferrerpolicy="no-referrer"/i.test(tag)) {
        violations.push(violation("referrer_leak", where, "An image is loaded from the business's own host without suppressing the referrer"));
      }
    }
    const labelled = new Set(attributeValues(html, /<label\b[^>]*\sfor="([^"]*)"/g));
    for (const tag of html.match(/<(?:input|textarea|select)\b[^>]*>/gi) ?? []) {
      if (/\stype="(?:hidden|submit|button)"/i.test(tag)) continue;
      const id = /\sid="([^"]*)"/.exec(tag)?.[1];
      if (!id || !labelled.has(id)) violations.push(violation("form_label_missing", where, "A form control renders without an associated label"));
    }
    if (!/\sdir="(?:ltr|rtl)"/.test(html) || !/\slang="/.test(html)) {
      violations.push(violation("locale_missing", where, "The page does not declare its language and text direction"));
    }
    if (!/(?:\s|")(?:sm|md|lg):/.test(html)) {
      violations.push(violation("not_responsive", where, "The page carries no responsive layout rules"));
    }
    if (/style="[^"]*width:\s*\d+px/i.test(html)) {
      violations.push(violation("not_responsive", where, "A fixed pixel width would break the page on a phone"));
    }
  }

  const { background, ink, muted, accent, accentInk } = spec.design.palette;
  const contrastChecks: Array<[string, string, string, number]> = [
    ["body text", ink, background, 4.5],
    ["secondary text", muted, background, 4.5],
    ["accent on ground", accent, background, 4.5],
    ["text on accent", accentInk, accent, 4.5],
  ];
  for (const [label, foreground, ground, target] of contrastChecks) {
    const ratio = contrastRatio(foreground, ground);
    if (ratio < target) {
      violations.push(violation("contrast", `design.${label}`, `${label} contrast is ${ratio.toFixed(2)}:1, below the ${target}:1 minimum`));
    }
  }

  /* --- disclosure -------------------------------------------------- */

  for (const [pagePath, html] of renderedHtml) {
    if (!visibleText(html).includes(spec.demoDisclosure.slice(0, 40))) {
      violations.push(violation("disclosure_missing", `page:${pagePath || "/"}`, "Every page must disclose that it is a concept, not the business's own site"));
    }
  }

  return {
    ok: violations.every((item) => item.severity !== "error"),
    violations,
    renderedBytes,
    checkedPages: spec.pages.map((page) => page.path || "/"),
  };
}

export function renderViolations(violations: WebsiteViolation[]): string {
  if (violations.length === 0) return "No violations.";
  return violations.map((item) => `- [${item.severity}] ${item.code} at ${item.where}: ${item.message}`).join("\n");
}
