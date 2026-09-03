import "server-only";

import { generateObject } from "ai";
import { z } from "zod";
import { getOfficeGenerationConfig } from "../models";
import {
  deriveDesignProposal,
  designProposalSchema,
  resolveDesignDirection,
  type DesignDirection,
  type DesignProposal,
} from "./design";
import { buildSiteEvidence, MissingResearchError, renderEvidenceTable, type BrandPack, type SiteEvidence } from "./evidence";
import { emitSiteFiles, routeSourceDir } from "./emit";
import { assembleSiteSpec, websiteContentSchema, type SiteSpec, type WebsiteContent } from "./spec";
import { renderViolations, validateGeneratedSite, type EmittedFile, type ValidationReport, type WebsiteViolation } from "./validation";

/**
 * The website factory. It turns a founder-approved restaurant prospect
 * into a real, multi-page, accessible website, and it refuses to return
 * anything it cannot prove.
 *
 * The division of labour is deliberate. A model is good at voice, emphasis
 * and design judgement, and is not trustworthy with facts — so it writes
 * prose and proposes a direction, while every fact, link, route and asset
 * comes from the evidence ledger. Whatever comes back is then put through
 * `validateGeneratedSite`; failures are fed back as concrete violations
 * and the generation is retried a bounded number of times. If the last
 * attempt still fails, the factory raises rather than shipping a site the
 * founder would have to fact-check by hand.
 */

export class WebsiteGenerationError extends Error {
  readonly violations: WebsiteViolation[];
  readonly attempts: number;
  constructor(message: string, violations: WebsiteViolation[], attempts: number) {
    super(message);
    this.name = "WebsiteGenerationError";
    this.violations = violations;
    this.attempts = attempts;
  }
}

export class WebsiteProviderError extends Error {
  readonly attempts: number;
  readonly cause?: unknown;
  constructor(message: string, attempts: number, cause?: unknown) {
    super(message);
    this.name = "WebsiteProviderError";
    this.attempts = attempts;
    this.cause = cause;
  }
}

export { MissingResearchError };

const generationSchema = z.object({
  design: designProposalSchema,
  content: websiteContentSchema,
});

export type WebsiteDraft = z.infer<typeof generationSchema>;

export type WebsiteDraftRequest = {
  attempt: number;
  identity: string;
  locale: "en" | "ar";
  /** Every fact the copy is allowed to lean on, as plain text. */
  evidenceBrief: string;
  /** Violations from the previous attempt, empty on the first. */
  corrections: WebsiteViolation[];
};

export type WebsiteDraftGenerator = (request: WebsiteDraftRequest) => Promise<WebsiteDraft>;

export type GeneratedWebsite = {
  spec: SiteSpec;
  files: EmittedFile[];
  design: DesignDirection;
  report: ValidationReport;
  routeSourceDir: string;
  /** Founder-facing explanation of why this design suits this business. */
  designRationale: string;
  evidenceTable: string;
  uncertainties: string[];
  attempts: number;
};

const MAX_ATTEMPTS = 3;

const INSTRUCTIONS = `You are LYNQ's principal web designer and copywriter producing a concept website for one specific restaurant.

Rules that are enforced automatically — breaking them fails the build:
- Write only what the supplied evidence supports. Never state a number, price, rating, year, opening time, award, ranking or customer claim that is not already in the evidence.
- Never imply a service the evidence does not list. If the evidence does not establish delivery, reservations, online ordering, catering, events or gift cards, do not mention them in any form.
- No placeholder text of any kind. Every sentence must be finished, specific and about this business.
- Do not write headings such as "Our Story" that could belong to any business; write copy this restaurant could not swap with a competitor.

Design direction: choose a layout archetype, type system, motif, density and palette hue that suit this specific business and location. Vary your choices between businesses — an unremarkable default is a failure.

Voice: confident, concrete, warm, free of marketing filler. Match the requested language exactly.`;

function evidenceBrief(evidence: SiteEvidence, objective: string): string {
  const facts = [...evidence.facts.values()].map((item) => `- ${item.label}: ${item.value}`);
  const problems = evidence.sources.map((source) => `- ${source.title}: ${source.supports}`);
  return [
    `Business: ${evidence.businessName}`,
    `Location: ${evidence.city} (${evidence.countryCode})`,
    `Language: ${evidence.locale === "ar" ? "Arabic" : "English"}`,
    `Founder objective: ${objective}`,
    evidence.brandSignals.length ? `Words the business already uses about itself:\n${evidence.brandSignals.map((signal) => `- ${signal}`).join("\n")}` : "The business publishes no brand language we could verify.",
    `Verified facts you may reference:\n${facts.join("\n") || "- none"}`,
    evidence.services.length
      ? `Services proven by evidence (only these may be mentioned):\n${evidence.services.map((service) => `- ${service.capability}: ${service.label}`).join("\n")}`
      : "No services are proven by evidence. Do not mention delivery, reservations, online ordering, catering, events or gift cards at all.",
    evidence.menu.length
      ? `Approved menu categories:\n${evidence.menu.map((category) => `- ${category.name} (${category.items.length} items)`).join("\n")}`
      : "No menu information is approved. Do not describe dishes.",
    evidence.hours.length ? `Approved opening hours:\n${evidence.hours.map((row) => `- ${row.day}: ${row.hours}`).join("\n")}` : "Opening hours are not verified. Do not state any.",
    evidence.assets.length ? `Approved images:\n${evidence.assets.map((asset) => `- ${asset.id}: ${asset.alt}`).join("\n")}` : "No images are approved. The design must work on type and layout alone.",
    `Evidence sources:\n${problems.join("\n")}`,
  ].join("\n\n");
}

function defaultGenerator(request: WebsiteDraftRequest): Promise<WebsiteDraft> {
  return generateObject({
    ...getOfficeGenerationConfig("planning"),
    schema: generationSchema,
    system: INSTRUCTIONS,
    prompt: JSON.stringify({
      attempt: request.attempt,
      language: request.locale === "ar" ? "Arabic" : "English",
      businessIdentity: request.identity,
      evidence: request.evidenceBrief,
      corrections: request.corrections.map((item) => `${item.code} at ${item.where}: ${item.message}`),
    }),
  }).then((result) => result.object as WebsiteDraft);
}

function isProviderFailure(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  return !(error instanceof z.ZodError) && name !== "TypeValidationError" && name !== "NoObjectGeneratedError";
}

function safeDesign(proposal: unknown, identity: string): DesignProposal {
  const parsed = designProposalSchema.safeParse(proposal);
  // A design that does not parse is recoverable — the identity-seeded
  // direction is always usable. Copy is never recovered this way, because
  // inventing copy is exactly what this module exists to prevent.
  return parsed.success ? parsed.data : deriveDesignProposal(identity);
}

export async function generateRestaurantWebsite(input: {
  projectKey: string;
  route: string;
  /** The founder-approved research recommendation. */
  candidate: unknown;
  brandPack?: BrandPack | null;
  objective: string;
  researchUncertainty?: string[];
  attempts?: number;
  generator?: WebsiteDraftGenerator;
}): Promise<GeneratedWebsite> {
  const evidence = buildSiteEvidence({ candidate: input.candidate, brandPack: input.brandPack ?? null });
  const generate = input.generator ?? defaultGenerator;
  const maxAttempts = Math.max(1, Math.min(input.attempts ?? MAX_ATTEMPTS, 5));
  const brief = evidenceBrief(evidence, input.objective);

  let corrections: WebsiteViolation[] = [];
  let lastReport: ValidationReport | null = null;
  let providerFailure: unknown = null;
  let attemptsUsed = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attemptsUsed = attempt;
    let draft: WebsiteDraft;
    try {
      draft = await generate({ attempt, identity: evidence.identity, locale: evidence.locale, evidenceBrief: brief, corrections });
      providerFailure = null;
    } catch (error) {
      if (isProviderFailure(error)) {
        providerFailure = error;
        corrections = [];
        continue;
      }
      corrections = [{ code: "invalid_output", severity: "error", where: "model", message: (error as Error).message.slice(0, 400) }];
      lastReport = null;
      continue;
    }

    const content = websiteContentSchema.safeParse(draft?.content);
    if (!content.success) {
      corrections = content.error.issues.map((issue) => ({
        code: "invalid_output",
        severity: "error" as const,
        where: issue.path.join(".") || "content",
        message: issue.message,
      }));
      lastReport = null;
      continue;
    }

    const design = resolveDesignDirection(safeDesign(draft?.design, evidence.identity));
    const spec = assembleSiteSpec({
      projectKey: input.projectKey,
      route: input.route,
      evidence,
      design,
      content: content.data as WebsiteContent,
    });
    const files = emitSiteFiles(spec);
    const report = validateGeneratedSite({ spec, evidence, files, routeSourceDir: routeSourceDir(spec) });
    lastReport = report;

    if (report.ok) {
      return {
        spec,
        files,
        design,
        report,
        routeSourceDir: routeSourceDir(spec),
        designRationale: renderDesignRationale(design, evidence),
        evidenceTable: renderEvidenceTable(evidence),
        uncertainties: collectUncertainties(evidence, input.researchUncertainty ?? [], report),
        attempts: attempt,
      };
    }
    corrections = report.violations.filter((item) => item.severity === "error").slice(0, 24);
  }

  if (providerFailure) {
    throw new WebsiteProviderError(
      `The website generation provider failed after ${attemptsUsed} attempt(s): ${(providerFailure as Error).message ?? "unknown error"}`,
      attemptsUsed,
      providerFailure,
    );
  }
  throw new WebsiteGenerationError(
    `The generated website did not pass validation after ${attemptsUsed} attempt(s):\n${renderViolations(corrections)}`,
    lastReport?.violations ?? corrections,
    attemptsUsed,
  );
}

export function renderDesignRationale(design: DesignDirection, evidence: SiteEvidence): string {
  return [
    `## Design direction — ${design.name}`,
    design.rationale,
    "",
    "| Decision | Value |",
    "| --- | --- |",
    `| Layout archetype | ${design.layout} |`,
    `| Type system | ${design.typeSystem} |`,
    `| Motif | ${design.motif} |`,
    `| Density | ${design.density} |`,
    `| Corner radius | ${design.radius}px |`,
    `| Scheme | ${design.palette.scheme} |`,
    `| Ground / ink | \`${design.palette.background}\` / \`${design.palette.ink}\` |`,
    `| Accent | \`${design.palette.accent}\` on \`${design.palette.accentInk}\` |`,
    "",
    `The palette is repaired to WCAG AA before it can render, so body text, secondary text and every accent surface clear 4.5:1 for ${evidence.businessName}.`,
  ].join("\n");
}

function collectUncertainties(evidence: SiteEvidence, researchUncertainty: string[], report: ValidationReport): string[] {
  const items = [...researchUncertainty];
  if (evidence.assets.length === 0) items.push("No approved photography was available, so the design carries the business on type and layout alone.");
  if (evidence.menu.length === 0) items.push("No menu was verified, so the site shows no dishes and no menu page was generated.");
  if (evidence.hours.length === 0) items.push("Opening hours were not verified, so the visit section says so rather than guessing.");
  if (evidence.services.length === 0) items.push("No bookable or orderable service was verified, so the site offers only the contact channels that were verified.");
  if (!evidence.facts.has("business.phone")) items.push("No public phone number was verified, so no call action is offered.");
  if (!evidence.facts.has("business.email")) items.push("No public email was verified, so no email action is offered.");
  for (const warning of report.violations.filter((item) => item.severity === "warning")) {
    items.push(`${warning.message} (${warning.where})`);
  }
  return items;
}
