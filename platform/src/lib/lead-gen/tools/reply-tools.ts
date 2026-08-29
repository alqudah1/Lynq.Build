import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { communicationMessages } from "@/db/schema";
import { resolveConversationById, updateConversationStatus } from "@/lib/communications-os/conversations";
import { createDraftMessage } from "@/lib/communications-os/messages";
import { suppressIdentity, upsertConsent } from "@/lib/communications-os/consent";
import { createActivity } from "@/lib/crm/activities";
import type { ToolImplementation } from "@/lib/tools/implementation-types";
import { detectOptOutIntent } from "../outreach";
import { getLeadGenModel } from "../models";
import { resolveActingUserId, LeadGenToolError } from "./shared";

/**
 * ============================================================================
 * Reply tools
 * ============================================================================
 * Claude classifies a reply; this records the classification and its
 * consequences. Two guardrails matter here:
 *
 *   1. An explicit STOP has already been honoured, synchronously, inside the
 *      webhook (`applyOptOutIntent`). This tool re-checks the literal text
 *      and will suppress regardless of what the model concluded — a model
 *      that classifies "STOP" as "question" cannot keep a channel open.
 *   2. A follow-up is a DRAFT. Nothing here can send.
 */

const uuid = z.string().uuid();

export const REPLY_CLASSIFICATIONS = ["interested", "not_interested", "question", "wrong_number", "unavailable", "opt_out", "other"] as const;

const processInboundReplyInput = z
  .object({
    conversationId: uuid,
    classification: z.enum(REPLY_CLASSIFICATIONS),
    confidence: z.number().min(0).max(1),
    rationale: z.string().trim().min(1).max(2000),
  })
  .strict();

export const processInboundReplyTool: ToolImplementation<z.infer<typeof processInboundReplyInput>, unknown> = {
  toolKey: "leadgen.process_inbound_reply",
  version: 1,
  inputSchema: processInboundReplyInput,
  execute: async (ctx, input) => {
    const actorUserId = await resolveActingUserId(ctx);
    const conversation = await resolveConversationById(ctx.db, ctx.organizationId, input.conversationId);

    const [latestInbound] = await ctx.db
      .select()
      .from(communicationMessages)
      .where(and(eq(communicationMessages.organizationId, ctx.organizationId), eq(communicationMessages.conversationId, conversation.id), eq(communicationMessages.direction, "inbound")))
      .orderBy(desc(communicationMessages.receivedAt))
      .limit(1);

    if (!latestInbound) throw new LeadGenToolError("no_inbound_message", "This conversation has no inbound message to classify.");

    // The deterministic check overrides the model, never the other way round.
    const literalIntent = detectOptOutIntent(latestInbound.bodyText ?? "");
    const effectiveClassification = literalIntent === "opt_out" ? "opt_out" : input.classification;

    let suppressed = false;
    if (effectiveClassification === "opt_out" && latestInbound.senderReference) {
      await suppressIdentity(ctx.db, {
        organizationId: ctx.organizationId,
        channel: conversation.channel,
        rawIdentity: latestInbound.senderReference,
        suppressionReason: "user_opt_out",
        source: "reply_classification",
        actorUserId,
      });
      await upsertConsent(ctx.db, {
        organizationId: ctx.organizationId,
        channel: conversation.channel,
        rawIdentity: latestInbound.senderReference,
        contactId: conversation.contactId,
        consentStatus: "opted_out",
        consentSource: "reply_stop",
        actorUserId,
      }).catch(() => undefined);
      suppressed = true;
    }

    await createActivity(ctx.db, {
      organizationId: ctx.organizationId,
      contactId: conversation.contactId,
      companyId: conversation.companyId,
      leadId: conversation.leadId,
      opportunityId: conversation.opportunityId,
      activityType: "note",
      direction: "inbound",
      subject: `Reply classified: ${effectiveClassification}`,
      summary: `${input.rationale} (confidence ${input.confidence.toFixed(2)}, model ${getLeadGenModel("classification")}${literalIntent === "opt_out" && input.classification !== "opt_out" ? "; overridden to opt_out by literal STOP keyword" : ""})`,
      agentId: ctx.principal.agentId,
      actorUserId,
    });

    // An opt-out ends the conversation; anything a human needs to act on
    // stays open rather than being auto-resolved by a classifier.
    const nextStatus = effectiveClassification === "opt_out" ? "resolved" : conversation.status === "resolved" ? "open" : conversation.status;
    if (nextStatus !== conversation.status) {
      await updateConversationStatus(ctx.db, {
        organizationId: ctx.organizationId,
        conversationId: conversation.id,
        status: nextStatus,
        expectedRevision: conversation.revision,
        actorUserId,
      });
    }

    return {
      conversationId: conversation.id,
      messageId: latestInbound.id,
      classification: effectiveClassification,
      overriddenByKeyword: literalIntent === "opt_out" && input.classification !== "opt_out",
      suppressed,
      leadId: conversation.leadId,
      conversationStatus: nextStatus,
    };
  },
};

/* ------------------------------------------------------------------ */
/* draft_follow_up                                                     */
/* ------------------------------------------------------------------ */

const draftFollowUpInput = z
  .object({
    conversationId: uuid,
    bodyText: z.string().trim().min(1).max(4000),
    idempotencyKey: z.string().trim().min(1).max(200),
    /**
     * Required when the 24-hour customer service window has closed — Meta
     * will not deliver free text to a contact who has not messaged recently.
     * Omit for a reply inside an open window.
     */
    providerTemplate: z
      .object({
        name: z.string().trim().min(1).max(512),
        languageCode: z.string().trim().min(2).max(15),
        bodyParameters: z.array(z.string().min(1).max(1024)).max(30),
      })
      .nullable()
      .default(null),
  })
  .strict();

/**
 * Creates a DRAFT only. It cannot approve, queue or send — a follow-up
 * reaches a person only after the same approval path any other outbound
 * message takes.
 */
export const draftFollowUpTool: ToolImplementation<z.infer<typeof draftFollowUpInput>, unknown> = {
  toolKey: "leadgen.draft_follow_up",
  version: 1,
  inputSchema: draftFollowUpInput,
  execute: async (ctx, input) => {
    const actorUserId = await resolveActingUserId(ctx);
    const conversation = await resolveConversationById(ctx.db, ctx.organizationId, input.conversationId);

    const [lastOutbound] = await ctx.db
      .select({ recipientReference: communicationMessages.recipientReference })
      .from(communicationMessages)
      .where(and(eq(communicationMessages.organizationId, ctx.organizationId), eq(communicationMessages.conversationId, conversation.id), eq(communicationMessages.direction, "outbound")))
      .orderBy(desc(communicationMessages.createdAt))
      .limit(1);

    const [lastInbound] = await ctx.db
      .select({ senderReference: communicationMessages.senderReference })
      .from(communicationMessages)
      .where(and(eq(communicationMessages.organizationId, ctx.organizationId), eq(communicationMessages.conversationId, conversation.id), eq(communicationMessages.direction, "inbound")))
      .orderBy(desc(communicationMessages.receivedAt))
      .limit(1);

    const recipient = lastOutbound?.recipientReference ?? lastInbound?.senderReference;
    if (!recipient) throw new LeadGenToolError("no_recipient", "This conversation has no resolvable recipient address.");

    const draft = await createDraftMessage(ctx.db, {
      organizationId: ctx.organizationId,
      conversationId: conversation.id,
      channel: conversation.channel,
      integrationConnectionId: conversation.integrationConnectionId,
      recipientReference: recipient,
      bodyText: input.bodyText,
      providerTemplate: input.providerTemplate,
      idempotencyKey: input.idempotencyKey,
      createdByAgentId: ctx.principal.agentId,
      actorUserId,
    });

    return {
      messageId: draft.id,
      status: draft.status,
      requiresApproval: true,
      note: "This is a draft. It will not be sent until a human approves it through the existing approval workflow.",
    };
  },
};
