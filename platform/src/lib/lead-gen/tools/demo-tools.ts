import { z } from "zod";
import { updateCompany } from "@/lib/crm/companies";
import type { ToolImplementation } from "@/lib/tools/implementation-types";
import { DEMO_STYLE_KEYS, assertNoFabricatedClaims, demoContentSchema, hashBusinessFacts, type DemoContent } from "../demo-content";
import { demoRenderChecksSchema, evaluateDemoContentQuality, evaluateDemoEligibility, usesArabicContent, type DemoReviewRecord } from "../demo-quality";
import { getLeadGenModel } from "../models";
import { loadLeadBundle, resolveActingUserId, LeadGenToolError } from "./shared";

/**
 * ============================================================================
 * Demo tools
 * ============================================================================
 * Generating, reviewing and regenerating a prospect's demo. Generation and
 * review are both in the "Claude may do this automatically" band — but the
 * REVIEW is what unlocks outreach, and it cannot pass on content quality
 * alone: an automated render check must have actually observed the page
 * (`demoRenderChecksSchema`). A review submitted without one records
 * honestly as not eligible rather than quietly passing.
 */

const uuid = z.string().uuid();

/* ------------------------------------------------------------------ */
/* generate_demo                                                       */
/* ------------------------------------------------------------------ */

const generateDemoInput = z
  .object({
    leadId: uuid,
    expectedCompanyRevision: z.number().int().min(1),
    styleKey: z.enum(DEMO_STYLE_KEYS),
    eyebrow: z.string().trim().min(1).max(40),
    headline: z.string().trim().min(1).max(160),
    intro: z.string().trim().min(1).max(320),
    imageLine: z.string().trim().min(1).max(240),
    experienceLabel: z.string().trim().min(1).max(40),
    experienceTitle: z.string().trim().min(1).max(120),
    closing: z.string().trim().min(1).max(80),
    experiences: z.array(z.object({ title: z.string().trim().min(1).max(60), description: z.string().trim().min(1).max(200) })).length(3),
  })
  .strict();

export const generateDemoTool: ToolImplementation<z.infer<typeof generateDemoInput>, unknown> = {
  toolKey: "leadgen.generate_demo",
  version: 1,
  inputSchema: generateDemoInput,
  execute: async (ctx, input) => {
    const actorUserId = await resolveActingUserId(ctx);
    const bundle = await loadLeadBundle(ctx.db, ctx.organizationId, input.leadId);
    if (!bundle.company) throw new LeadGenToolError("no_company", "This lead has no company, so there is nothing to build a demo from.");
    if (!bundle.outreach?.demoSlug) {
      throw new LeadGenToolError("not_a_prospect_company", "This company was not imported through prospect import, so it has no demo URL.");
    }

    const facts = bundle.outreach.facts;

    const content: DemoContent = demoContentSchema.parse({
      version: 1,
      styleKey: input.styleKey,
      // The page's direction follows the business's own content, so the
      // copy has to be written in the same language the page will render in.
      language: usesArabicContent(facts) ? "ar" : "en",
      eyebrow: input.eyebrow,
      headline: input.headline,
      intro: input.intro,
      imageLine: input.imageLine,
      experienceLabel: input.experienceLabel,
      experienceTitle: input.experienceTitle,
      closing: input.closing,
      experiences: input.experiences,
      factsHash: hashBusinessFacts(facts),
      generatedAt: new Date().toISOString(),
      generatedBy: { kind: "agent", id: ctx.principal.agentId },
      model: getLeadGenModel("content"),
    });

    // Refused, not sanitized: a fabricated claim is a generation failure the
    // caller must see and redo, not something to quietly strip and ship.
    assertNoFabricatedClaims(content, facts);

    const address = { ...((bundle.company.address as Record<string, unknown> | null) ?? {}), demoContent: content };

    const company = await updateCompany(ctx.db, {
      organizationId: ctx.organizationId,
      companyId: bundle.company.id,
      expectedRevision: input.expectedCompanyRevision,
      actorUserId,
      address,
      // New copy means the previous review no longer describes this page.
      demoReview: null,
    });

    return {
      companyId: company.id,
      revision: company.revision,
      demoUrl: bundle.outreach.demoUrl,
      language: content.language,
      styleKey: content.styleKey,
      reviewRequiredBeforeOutreach: true,
    };
  },
};

/* ------------------------------------------------------------------ */
/* review_demo                                                         */
/* ------------------------------------------------------------------ */

const reviewDemoInput = z
  .object({
    leadId: uuid,
    expectedCompanyRevision: z.number().int().min(1),
    /**
     * What an automated check actually observed by loading the page. Omit
     * only if no check was run — in which case the review is recorded but
     * the demo stays ineligible, which is the honest outcome.
     */
    renderChecks: demoRenderChecksSchema.nullable().default(null),
    reviewerNote: z.string().trim().max(4000).nullable().default(null),
  })
  .strict();

export const reviewDemoTool: ToolImplementation<z.infer<typeof reviewDemoInput>, unknown> = {
  toolKey: "leadgen.review_demo",
  version: 1,
  inputSchema: reviewDemoInput,
  execute: async (ctx, input) => {
    const actorUserId = await resolveActingUserId(ctx);
    const bundle = await loadLeadBundle(ctx.db, ctx.organizationId, input.leadId);
    if (!bundle.company || !bundle.outreach?.demoSlug) {
      throw new LeadGenToolError("no_demo", "This lead has no generated demo to review.");
    }

    // The content score is computed here, from the data, rather than taken
    // from the caller — a reviewer cannot talk a demo past the gate.
    const { score, checks, blockingFailures } = evaluateDemoContentQuality(bundle.outreach.facts);

    const review: DemoReviewRecord = {
      version: 1,
      score,
      // `passed` is derived, never asserted by the caller.
      passed: false,
      contentChecks: checks,
      blockingFailures,
      renderChecks: input.renderChecks,
      reviewerNote: input.reviewerNote,
      reviewedAt: new Date().toISOString(),
      reviewedBy: { kind: "agent", id: ctx.principal.agentId },
      demoSlug: bundle.outreach.demoSlug,
    };
    const eligibility = evaluateDemoEligibility({ review, demoSlug: bundle.outreach.demoSlug });
    review.passed = eligibility.eligible;

    const company = await updateCompany(ctx.db, {
      organizationId: ctx.organizationId,
      companyId: bundle.company.id,
      expectedRevision: input.expectedCompanyRevision,
      actorUserId,
      demoReview: review,
    });

    return {
      companyId: company.id,
      revision: company.revision,
      demoUrl: bundle.outreach.demoUrl,
      score,
      passed: review.passed,
      eligibleForOutreach: eligibility.eligible,
      reason: eligibility.reason,
      detail: eligibility.detail,
      failedChecks: checks.filter((check) => !check.passed).map((check) => ({ id: check.id, severity: check.severity, detail: check.detail })),
    };
  },
};

/* ------------------------------------------------------------------ */
/* regenerate_demo                                                     */
/* ------------------------------------------------------------------ */

const regenerateDemoInput = z
  .object({
    leadId: uuid,
    expectedCompanyRevision: z.number().int().min(1),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();

/**
 * Clears the generated copy and the review so the next `generate_demo`
 * starts clean. Deliberately a separate, explicit step rather than an
 * implicit overwrite: it is the operation that makes an already-approved
 * demo ineligible again, and that should be visible in the audit trail.
 */
export const regenerateDemoTool: ToolImplementation<z.infer<typeof regenerateDemoInput>, unknown> = {
  toolKey: "leadgen.regenerate_demo",
  version: 1,
  inputSchema: regenerateDemoInput,
  execute: async (ctx, input) => {
    const actorUserId = await resolveActingUserId(ctx);
    const bundle = await loadLeadBundle(ctx.db, ctx.organizationId, input.leadId);
    if (!bundle.company) throw new LeadGenToolError("no_company", "This lead has no company.");

    const address = { ...((bundle.company.address as Record<string, unknown> | null) ?? {}) };
    delete address.demoContent;

    const company = await updateCompany(ctx.db, {
      organizationId: ctx.organizationId,
      companyId: bundle.company.id,
      expectedRevision: input.expectedCompanyRevision,
      actorUserId,
      address,
      demoReview: null,
    });

    return { companyId: company.id, revision: company.revision, cleared: true, reason: input.reason, eligibleForOutreach: false };
  },
};
