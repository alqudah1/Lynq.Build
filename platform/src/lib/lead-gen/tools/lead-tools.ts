import { z } from "zod";
import { listLeadsForUser, updateLead, qualifyLead, disqualifyLead, convertLead } from "@/lib/crm/leads";
import { updateCompany } from "@/lib/crm/companies";
import { createActivity } from "@/lib/crm/activities";
import type { ToolImplementation } from "@/lib/tools/implementation-types";
import { scoreLead } from "../scoring";
import { LEAD_GEN_MARKET_CODES } from "../markets";
import { loadLeadBundle, resolveActingUserId, summarizeLead, LeadGenToolError } from "./shared";

/**
 * ============================================================================
 * Lead tools
 * ============================================================================
 * Reading, enriching, scoring and classifying leads. Everything here is in
 * the "Claude may do this automatically" band — no outbound message can be
 * produced by any of it. The two operations that genuinely change a lead's
 * commercial meaning (qualify, disqualify) still route through CRM Core's
 * own dedicated, separately-audited transitions with their own authority
 * checks; they are not free-form status writes.
 */

const uuid = z.string().uuid();

/* ------------------------------------------------------------------ */
/* find_qualified_leads                                                */
/* ------------------------------------------------------------------ */

const findQualifiedLeadsInput = z
  .object({
    market: z.enum(LEAD_GEN_MARKET_CODES).optional(),
    status: z.enum(["new", "contacted", "engaged", "qualified", "disqualified", "converted"]).optional(),
    minimumScore: z.number().int().min(0).max(100).optional(),
    /** Only leads whose demo has passed review and may actually be contacted. */
    onlyOutreachEligible: z.boolean().default(false),
    limit: z.number().int().min(1).max(200).default(50),
  })
  .strict();

export const findQualifiedLeadsTool: ToolImplementation<z.infer<typeof findQualifiedLeadsInput>, unknown> = {
  toolKey: "leadgen.find_qualified_leads",
  version: 1,
  inputSchema: findQualifiedLeadsInput,
  execute: async (ctx, input) => {
    const actorUserId = await resolveActingUserId(ctx);
    const leads = await listLeadsForUser(ctx.db, { organizationId: ctx.organizationId, actorUserId, status: input.status, limit: input.limit });

    const bundles = [];
    for (const lead of leads) {
      const bundle = await loadLeadBundle(ctx.db, ctx.organizationId, lead.id);
      if (input.market && bundle.outreach?.market?.code !== input.market) continue;
      if (input.minimumScore !== undefined && (lead.score ?? 0) < input.minimumScore) continue;
      if (input.onlyOutreachEligible && !bundle.outreach?.eligibility.eligible) continue;
      bundles.push(summarizeLead(bundle));
    }

    // Best prospects first: highest score, then the ones already cleared for outreach.
    bundles.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || Number(b.demo.eligibleForOutreach) - Number(a.demo.eligibleForOutreach));
    return { count: bundles.length, leads: bundles };
  },
};

/* ------------------------------------------------------------------ */
/* get_lead                                                            */
/* ------------------------------------------------------------------ */

const getLeadInput = z.object({ leadId: uuid }).strict();

export const getLeadTool: ToolImplementation<z.infer<typeof getLeadInput>, unknown> = {
  toolKey: "leadgen.get_lead",
  version: 1,
  inputSchema: getLeadInput,
  execute: async (ctx, input) => {
    // Authority is re-derived by the CRM read itself; loading the bundle
    // after a view check keeps the tool's own logic free of authz.
    const actorUserId = await resolveActingUserId(ctx);
    await listLeadsForUser(ctx.db, { organizationId: ctx.organizationId, actorUserId, limit: 1 });
    const bundle = await loadLeadBundle(ctx.db, ctx.organizationId, input.leadId);
    return summarizeLead(bundle);
  },
};

/* ------------------------------------------------------------------ */
/* enrich_lead                                                         */
/* ------------------------------------------------------------------ */

/**
 * Only the descriptive business facts a demo is built from. Deliberately
 * cannot touch owner, lifecycle stage, pipeline or any commercial field —
 * enrichment is research, not a reassignment.
 */
const enrichLeadInput = z
  .object({
    leadId: uuid,
    expectedCompanyRevision: z.number().int().min(1),
    category: z.string().trim().min(2).max(120).optional(),
    city: z.string().trim().min(1).max(120).optional(),
    countryCode: z.enum(LEAD_GEN_MARKET_CODES).optional(),
    description: z.string().trim().min(1).max(2000).optional(),
    photoUrl: z.string().url().startsWith("https://").max(2000).optional(),
    website: z.string().url().max(2000).nullable().optional(),
    rating: z.number().min(0).max(5).optional(),
    reviewCount: z.number().int().min(0).max(1_000_000).optional(),
    formattedAddress: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const enrichLeadTool: ToolImplementation<z.infer<typeof enrichLeadInput>, unknown> = {
  toolKey: "leadgen.enrich_lead",
  version: 1,
  inputSchema: enrichLeadInput,
  execute: async (ctx, input) => {
    const actorUserId = await resolveActingUserId(ctx);
    const bundle = await loadLeadBundle(ctx.db, ctx.organizationId, input.leadId);
    if (!bundle.company) throw new LeadGenToolError("no_company", "This lead has no company to enrich.");

    const address = { ...((bundle.company.address as Record<string, unknown> | null) ?? {}) };
    if (input.category !== undefined) address.category = input.category;
    if (input.city !== undefined) address.city = input.city;
    if (input.countryCode !== undefined) address.countryCode = input.countryCode;
    if (input.description !== undefined) address.description = input.description;
    if (input.photoUrl !== undefined) address.photo = input.photoUrl;
    if (input.rating !== undefined) address.rating = input.rating;
    if (input.reviewCount !== undefined) address.reviews = input.reviewCount;
    if (input.formattedAddress !== undefined) address.formatted = input.formattedAddress;

    const company = await updateCompany(ctx.db, {
      organizationId: ctx.organizationId,
      companyId: bundle.company.id,
      expectedRevision: input.expectedCompanyRevision,
      actorUserId,
      address,
      ...(input.website !== undefined ? { website: input.website } : {}),
      // Enrichment changes the facts the demo is built from, so any review
      // recorded against the old facts no longer describes what a prospect
      // would see. Clearing it makes the demo ineligible until re-reviewed
      // rather than letting stale approval carry over.
      demoReview: null,
    });

    return { companyId: company.id, revision: company.revision, demoReviewCleared: true };
  },
};

/* ------------------------------------------------------------------ */
/* score_lead                                                          */
/* ------------------------------------------------------------------ */

const scoreLeadInput = z
  .object({
    leadId: uuid,
    expectedLeadRevision: z.number().int().min(1),
    /** 0-100 assessment of an existing website, when one was actually fetched and analysed. */
    websiteScore: z.number().int().min(0).max(100).nullable().optional(),
  })
  .strict();

export const scoreLeadTool: ToolImplementation<z.infer<typeof scoreLeadInput>, unknown> = {
  toolKey: "leadgen.score_lead",
  version: 1,
  inputSchema: scoreLeadInput,
  execute: async (ctx, input) => {
    const actorUserId = await resolveActingUserId(ctx);
    const bundle = await loadLeadBundle(ctx.db, ctx.organizationId, input.leadId);
    const facts = bundle.outreach?.facts;

    const breakdown = scoreLead({
      rating: facts?.rating ?? null,
      reviewCount: facts?.reviewCount ?? null,
      website: bundle.company?.website ?? null,
      phone: bundle.contact?.primaryPhone ?? bundle.company?.phone ?? null,
      email: bundle.contact?.primaryEmail ?? null,
      websiteScore: input.websiteScore ?? null,
    });

    const lead = await updateLead(ctx.db, {
      organizationId: ctx.organizationId,
      leadId: input.leadId,
      expectedRevision: input.expectedLeadRevision,
      actorUserId,
      score: breakdown.score,
    });

    return { leadId: lead.id, revision: lead.revision, ...breakdown };
  },
};

/* ------------------------------------------------------------------ */
/* update_crm                                                          */
/* ------------------------------------------------------------------ */

/**
 * The bounded "non-sensitive classification" write the approval rules
 * allow an agent to make on its own. Status is limited to the two soft
 * in-progress transitions CRM Core itself treats as soft; qualification
 * and disqualification have their own tools with their own audit events.
 */
const updateCrmInput = z
  .object({
    leadId: uuid,
    expectedLeadRevision: z.number().int().min(1),
    status: z.enum(["contacted", "engaged"]).optional(),
    qualificationNotes: z.string().trim().max(4000).nullable().optional(),
    nextAction: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export const updateCrmTool: ToolImplementation<z.infer<typeof updateCrmInput>, unknown> = {
  toolKey: "leadgen.update_crm",
  version: 1,
  inputSchema: updateCrmInput,
  execute: async (ctx, input) => {
    const actorUserId = await resolveActingUserId(ctx);
    const lead = await updateLead(ctx.db, {
      organizationId: ctx.organizationId,
      leadId: input.leadId,
      expectedRevision: input.expectedLeadRevision,
      actorUserId,
      status: input.status,
      qualificationNotes: input.qualificationNotes,
      nextAction: input.nextAction,
    });
    return { leadId: lead.id, status: lead.status, revision: lead.revision };
  },
};

/* ------------------------------------------------------------------ */
/* mark_call_later                                                     */
/* ------------------------------------------------------------------ */

const markCallLaterInput = z
  .object({
    leadId: uuid,
    expectedLeadRevision: z.number().int().min(1),
    reason: z.enum(["whatsapp_unavailable", "no_answer", "requested_callback", "wrong_number"]),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

/**
 * Step 20 of the workflow: a number WhatsApp cannot reach is not a dead
 * lead, it is a phone call. This records that decision as a real next
 * action plus an append-only CRM activity — it does NOT invent a call
 * that has not happened.
 */
export const markCallLaterTool: ToolImplementation<z.infer<typeof markCallLaterInput>, unknown> = {
  toolKey: "leadgen.mark_call_later",
  version: 1,
  inputSchema: markCallLaterInput,
  execute: async (ctx, input) => {
    const actorUserId = await resolveActingUserId(ctx);
    const bundle = await loadLeadBundle(ctx.db, ctx.organizationId, input.leadId);

    const lead = await updateLead(ctx.db, {
      organizationId: ctx.organizationId,
      leadId: input.leadId,
      expectedRevision: input.expectedLeadRevision,
      actorUserId,
      nextAction: `Call later — ${input.reason}${input.note ? `: ${input.note}` : ""}`,
    });

    await createActivity(ctx.db, {
      organizationId: ctx.organizationId,
      leadId: lead.id,
      contactId: bundle.contact?.id ?? null,
      companyId: bundle.company?.id ?? null,
      activityType: "note",
      subject: "Moved to Call Later",
      summary: `Reason: ${input.reason}${input.note ? `. ${input.note}` : ""}`,
      agentId: ctx.principal.agentId,
      actorUserId,
    });

    return { leadId: lead.id, revision: lead.revision, nextAction: lead.nextAction };
  },
};

/* ------------------------------------------------------------------ */
/* mark_interested / mark_not_interested                               */
/* ------------------------------------------------------------------ */

const markInterestedInput = z
  .object({
    leadId: uuid,
    expectedLeadRevision: z.number().int().min(1),
    evidence: z.string().trim().min(1).max(2000),
    /** Supply both to move the lead into the sales pipeline in the same step. */
    pipelineId: uuid.optional(),
    stageId: uuid.optional(),
  })
  .strict();

export const markInterestedTool: ToolImplementation<z.infer<typeof markInterestedInput>, unknown> = {
  toolKey: "leadgen.mark_interested",
  version: 1,
  inputSchema: markInterestedInput,
  execute: async (ctx, input) => {
    const actorUserId = await resolveActingUserId(ctx);
    const bundle = await loadLeadBundle(ctx.db, ctx.organizationId, input.leadId);

    await createActivity(ctx.db, {
      organizationId: ctx.organizationId,
      leadId: input.leadId,
      contactId: bundle.contact?.id ?? null,
      companyId: bundle.company?.id ?? null,
      activityType: "note",
      subject: "Positive response recorded",
      summary: input.evidence,
      agentId: ctx.principal.agentId,
      actorUserId,
    });

    const qualified = await qualifyLead(ctx.db, { organizationId: ctx.organizationId, leadId: input.leadId, expectedRevision: input.expectedLeadRevision, actorUserId });

    if (input.pipelineId && input.stageId) {
      const { opportunity, lead } = await convertLead(ctx.db, {
        organizationId: ctx.organizationId,
        leadId: input.leadId,
        expectedRevision: qualified.revision,
        pipelineId: input.pipelineId,
        stageId: input.stageId,
        opportunityName: bundle.company?.name ? `${bundle.company.name} — LYNQ subscription` : undefined,
        amount: bundle.outreach?.market?.monthlyPrice ?? null,
        currency: bundle.outreach?.market?.currency ?? null,
        actorUserId,
      });
      return { leadId: lead.id, status: lead.status, revision: lead.revision, opportunityId: opportunity.id };
    }

    return { leadId: qualified.id, status: qualified.status, revision: qualified.revision, opportunityId: null };
  },
};

const markNotInterestedInput = z
  .object({
    leadId: uuid,
    expectedLeadRevision: z.number().int().min(1),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();

export const markNotInterestedTool: ToolImplementation<z.infer<typeof markNotInterestedInput>, unknown> = {
  toolKey: "leadgen.mark_not_interested",
  version: 1,
  inputSchema: markNotInterestedInput,
  execute: async (ctx, input) => {
    const actorUserId = await resolveActingUserId(ctx);
    // "Not interested" is a commercial judgement, NOT consent withdrawal.
    // Suppression is a separate, explicit tool, because conflating the two
    // would either under-honour a real STOP or over-suppress a soft no.
    const lead = await disqualifyLead(ctx.db, { organizationId: ctx.organizationId, leadId: input.leadId, expectedRevision: input.expectedLeadRevision, reason: input.reason, actorUserId });
    return { leadId: lead.id, status: lead.status, revision: lead.revision, suppressed: false };
  },
};
