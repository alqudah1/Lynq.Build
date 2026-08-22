import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { communicationBulkRecipients, communicationMessages } from "@/db/schema";
import { createBulkBatch, snapshotBulkRecipients, requestBulkApproval, startBulkBatch, resolveBulkBatchById, type BulkRecipientInput } from "@/lib/communications-os/bulk";
import { resolveConnectionById } from "@/lib/communications-os/connections";
import { suppressIdentity } from "@/lib/communications-os/consent";
import { getActiveSuppression, getConsentStatus } from "@/lib/communications-os/consent";
import { createActivity } from "@/lib/crm/activities";
import type { ToolImplementation } from "@/lib/tools/implementation-types";
import { ensureOutreachTemplate } from "../comms-templates";
import { LEAD_GEN_MARKET_CODES } from "../markets";
import { outreachTemplateValues } from "../outreach";
import { loadLeadBundle, resolveActingUserId, LeadGenToolError } from "./shared";

/**
 * ============================================================================
 * Outreach tools
 * ============================================================================
 * The band where automation stops. Claude may DRAFT a message and BUILD a
 * batch on its own; it may not send one. `send_approved_batch` refuses any
 * batch the existing approval workflow has not approved — it does not
 * re-implement approval, it calls `startBulkBatch`, which throws unless the
 * batch is already `approved`.
 *
 * Every recipient added to a batch has passed, at snapshot time: a resolved
 * market (so a price exists), a reviewed and eligible demo, an active
 * suppression check, and a consent check. A lead failing any of them is
 * reported back by name and reason rather than quietly dropped.
 */

const uuid = z.string().uuid();

/* ------------------------------------------------------------------ */
/* draft_outreach                                                      */
/* ------------------------------------------------------------------ */

const draftOutreachInput = z.object({ leadId: uuid }).strict();

/**
 * Pure composition — no write, no message row, no send. Returns exactly
 * what would be delivered, so a human or a model can read the real text
 * before anything is created.
 */
export const draftOutreachTool: ToolImplementation<z.infer<typeof draftOutreachInput>, unknown> = {
  toolKey: "leadgen.draft_outreach",
  version: 1,
  inputSchema: draftOutreachInput,
  execute: async (ctx, input) => {
    const bundle = await loadLeadBundle(ctx.db, ctx.organizationId, input.leadId);
    const context = bundle.outreach;

    if (!context?.market) throw new LeadGenToolError("no_market", "This lead has no resolvable market, so no price can be selected.");
    if (!context.demoUrl) throw new LeadGenToolError("no_demo", "This lead has no generated demo to link to.");
    if (!context.eligibility.eligible) throw new LeadGenToolError("demo_not_eligible", context.eligibility.detail);
    if (!context.outreach) throw new LeadGenToolError("cannot_compose", "Outreach copy could not be composed from this lead's data.");

    return {
      leadId: bundle.lead.id,
      market: context.market.code,
      priceDisplay: context.market.priceDisplay,
      senderPhone: context.market.senderPhoneE164,
      language: context.market.outreachLanguage,
      demoUrl: context.demoUrl,
      whatsappTemplateName: context.outreach.templateName,
      templateParameters: context.outreach.templateParameters,
      bodyText: context.outreach.bodyText,
      emailSubject: context.outreach.emailSubject,
      recipientPhone: bundle.contact?.primaryPhone ?? bundle.company?.phone ?? null,
    };
  },
};

/* ------------------------------------------------------------------ */
/* create_outreach_batch                                               */
/* ------------------------------------------------------------------ */

const createOutreachBatchInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    /**
     * One batch, one market. The market fixes the price AND the sender
     * number, and an organization runs a different WhatsApp Business number
     * per market — so mixing markets in one batch would mean messaging a
     * Canadian business from the Jordanian number.
     */
    market: z.enum(LEAD_GEN_MARKET_CODES),
    /** The verified `whatsapp_cloud_api` connection for that market's sender. */
    integrationConnectionId: uuid,
    leadIds: z.array(uuid).min(1).max(200),
    campaignId: uuid.nullable().default(null),
    /** Require a recorded opt-in, not merely the absence of a suppression. */
    requireExplicitOptIn: z.boolean().default(false),
  })
  .strict();

export const createOutreachBatchTool: ToolImplementation<z.infer<typeof createOutreachBatchInput>, unknown> = {
  toolKey: "leadgen.create_outreach_batch",
  version: 1,
  inputSchema: createOutreachBatchInput,
  execute: async (ctx, input) => {
    const actorUserId = await resolveActingUserId(ctx);

    // The sender is resolved and checked ONCE, before any recipient is
    // snapshotted: a batch built against a disabled or simulated connection
    // is a batch that cannot send, and finding that out at approval time
    // wastes a human's decision.
    const connection = await resolveConnectionById(ctx.db, ctx.organizationId, input.integrationConnectionId);
    if (connection.integrationType !== "whatsapp") {
      throw new LeadGenToolError("wrong_channel", `Connection ${connection.id} is a ${connection.integrationType} connection, not WhatsApp.`);
    }
    if (connection.provider !== "whatsapp_cloud_api") {
      throw new LeadGenToolError(
        "not_a_real_whatsapp_sender",
        `Connection ${connection.id} uses the "${connection.provider}" provider. Only a real whatsapp_cloud_api connection can deliver a message; the development provider records what it would have sent and never delivers anything.`
      );
    }
    if (connection.status !== "connected") {
      throw new LeadGenToolError("connection_not_verified", `Connection ${connection.id} is "${connection.status}", not "connected". Verify it against Meta before building a batch.`);
    }

    const eligible: Array<{ leadId: string; recipient: BulkRecipientInput; templateName: string }> = [];
    const rejected: Array<{ leadId: string; reason: string; detail: string }> = [];

    for (const leadId of input.leadIds) {
      const bundle = await loadLeadBundle(ctx.db, ctx.organizationId, leadId);
      const context = bundle.outreach;
      const phone = bundle.contact?.primaryPhone ?? bundle.company?.phone ?? null;

      if (!bundle.contact) {
        rejected.push({ leadId, reason: "no_contact", detail: "A bulk recipient must be a CRM contact; this lead has none." });
        continue;
      }
      if (!phone) {
        rejected.push({ leadId, reason: "no_phone", detail: "No phone number on the contact or company." });
        continue;
      }
      if (!context?.market) {
        rejected.push({ leadId, reason: "no_market", detail: "No resolvable market, so no price can be selected." });
        continue;
      }
      if (context.market.code !== input.market) {
        rejected.push({ leadId, reason: "wrong_market", detail: `This lead is in ${context.market.code}; this batch sends from the ${input.market} number at ${input.market === "JO" ? "25 JOD" : "100 CAD"}.` });
        continue;
      }
      if (!context.eligibility.eligible) {
        rejected.push({ leadId, reason: `demo_${context.eligibility.reason}`, detail: context.eligibility.detail });
        continue;
      }
      if (!context.outreach) {
        rejected.push({ leadId, reason: "cannot_compose", detail: "Outreach copy could not be composed from this lead's data." });
        continue;
      }

      const suppression = await getActiveSuppression(ctx.db, { organizationId: ctx.organizationId, channel: "whatsapp", rawIdentity: phone });
      if (suppression) {
        rejected.push({ leadId, reason: "suppressed", detail: `Suppressed: ${suppression.suppressionReason}.` });
        continue;
      }
      if (input.requireExplicitOptIn) {
        const consent = await getConsentStatus(ctx.db, { organizationId: ctx.organizationId, channel: "whatsapp", rawIdentity: phone });
        if (!consent || consent.consentStatus !== "opted_in") {
          rejected.push({ leadId, reason: "no_explicit_opt_in", detail: "No recorded opt-in for this number." });
          continue;
        }
      }

      eligible.push({
        leadId,
        templateName: context.outreach.templateName,
        recipient: {
          contactId: bundle.contact.id,
          templateValues: outreachTemplateValues(context.outreach),
          providerTemplate: {
            name: context.outreach.templateName,
            languageCode: context.market.templateLanguageCode,
            bodyParameters: context.outreach.templateParameters,
          },
          integrationConnectionId: connection.id,
          // The same key the WhatsApp adapter derives from an inbound
          // message, so the prospect's reply lands on this conversation.
          externalThreadId: `wa:${phone.replace(/\D/g, "")}`,
        },
      });
    }

    if (eligible.length === 0) {
      throw new LeadGenToolError("no_eligible_recipients", `None of the ${input.leadIds.length} lead(s) can currently be contacted. See the rejection reasons.`);
    }

    // One batch carries one Communications OS template, so a mixed set of
    // outreach variants cannot share a batch. Refusing is better than
    // silently sending some businesses the wrong variant.
    const templateNames = [...new Set(eligible.map((entry) => entry.templateName))];
    if (templateNames.length > 1) {
      throw new LeadGenToolError(
        "mixed_templates",
        `These leads need ${templateNames.length} different outreach templates (${templateNames.join(", ")}). Create one batch per template.`
      );
    }

    const template = await ensureOutreachTemplate(ctx.db, { organizationId: ctx.organizationId, templateName: eligible[0].templateName as never, actorUserId });

    const batch = await createBulkBatch(ctx.db, {
      organizationId: ctx.organizationId,
      name: input.name,
      channel: "whatsapp",
      campaignId: input.campaignId,
      templateId: template.id,
      maxRecipients: Math.max(eligible.length, 1),
      actorUserId,
    });

    const { recipientCount } = await snapshotBulkRecipients(ctx.db, {
      organizationId: ctx.organizationId,
      batchId: batch.id,
      recipients: eligible.map((entry) => entry.recipient),
      actorUserId,
    });

    return {
      batchId: batch.id,
      status: batch.status,
      market: input.market,
      senderConnectionId: connection.id,
      templateName: eligible[0].templateName,
      recipientCount,
      rejected,
      approvalRequired: true,
      nextStep: "leadgen.submit_batch_for_approval",
    };
  },
};

/* ------------------------------------------------------------------ */
/* submit_batch_for_approval                                           */
/* ------------------------------------------------------------------ */

const submitBatchInput = z.object({ batchId: uuid, summary: z.string().trim().min(1).max(2000) }).strict();

export const submitBatchForApprovalTool: ToolImplementation<z.infer<typeof submitBatchInput>, unknown> = {
  toolKey: "leadgen.submit_batch_for_approval",
  version: 1,
  inputSchema: submitBatchInput,
  execute: async (ctx, input) => {
    const actorUserId = await resolveActingUserId(ctx);
    const batch = await requestBulkApproval(ctx.db, { organizationId: ctx.organizationId, batchId: input.batchId, summary: input.summary, actorUserId });
    return {
      batchId: batch.id,
      status: batch.status,
      approvalRequestId: batch.approvalRequestId,
      // The agent that requested approval can never be the one that grants
      // it — decision authority is human-only, enforced inside the Runtime.
      decidedBy: "human",
    };
  },
};

/* ------------------------------------------------------------------ */
/* send_approved_batch                                                 */
/* ------------------------------------------------------------------ */

const sendApprovedBatchInput = z.object({ batchId: uuid, requireExplicitOptIn: z.boolean().default(false) }).strict();

/**
 * Queues an APPROVED batch. It does not send anything itself: each
 * recipient becomes a durable `communication_send` job the Communications
 * OS worker dispatches, which is what keeps sending off the request path
 * and out of the browser entirely. `startBulkBatch` throws unless the
 * batch is already approved, so there is no path from here to an
 * unapproved send.
 */
export const sendApprovedBatchTool: ToolImplementation<z.infer<typeof sendApprovedBatchInput>, unknown> = {
  toolKey: "leadgen.send_approved_batch",
  version: 1,
  inputSchema: sendApprovedBatchInput,
  execute: async (ctx, input) => {
    const actorUserId = await resolveActingUserId(ctx);
    const before = await resolveBulkBatchById(ctx.db, ctx.organizationId, input.batchId);
    if (before.status !== "approved") {
      throw new LeadGenToolError("not_approved", `This batch is "${before.status}", not "approved". It cannot be sent until a human approves it.`);
    }

    const result = await startBulkBatch(ctx.db, {
      organizationId: ctx.organizationId,
      batchId: input.batchId,
      requireExplicitOptIn: input.requireExplicitOptIn,
      actorUserId,
    });

    return {
      batchId: input.batchId,
      queued: result.queued,
      skipped: result.skipped,
      // Nothing has been delivered at this point, and saying otherwise
      // would be the exact false claim this system is built to avoid.
      delivered: 0,
      note: "Recipients are queued for the Communications OS worker. No message has been sent yet; delivery is confirmed only by a provider message ID and Meta's own status webhooks.",
    };
  },
};

/* ------------------------------------------------------------------ */
/* get_delivery_status                                                 */
/* ------------------------------------------------------------------ */

const getDeliveryStatusInput = z.object({ batchId: uuid.optional(), messageIds: z.array(uuid).max(200).optional() }).strict();

export const getDeliveryStatusTool: ToolImplementation<z.infer<typeof getDeliveryStatusInput>, unknown> = {
  toolKey: "leadgen.get_delivery_status",
  version: 1,
  inputSchema: getDeliveryStatusInput,
  execute: async (ctx, input) => {
    if (!input.batchId && !input.messageIds?.length) {
      throw new LeadGenToolError("nothing_requested", "Provide a batchId or a list of messageIds.");
    }

    let messageIds = input.messageIds ?? [];
    if (input.batchId) {
      const recipients = await ctx.db
        .select({ messageId: communicationBulkRecipients.messageId, status: communicationBulkRecipients.status, skipReason: communicationBulkRecipients.skipReason })
        .from(communicationBulkRecipients)
        .where(and(eq(communicationBulkRecipients.organizationId, ctx.organizationId), eq(communicationBulkRecipients.batchId, input.batchId)));
      messageIds = [...messageIds, ...recipients.map((row) => row.messageId).filter((id): id is string => Boolean(id))];
    }

    if (messageIds.length === 0) return { messages: [], counts: {} };

    const rows = await ctx.db
      .select({
        id: communicationMessages.id,
        status: communicationMessages.status,
        provider: communicationMessages.provider,
        providerMessageId: communicationMessages.providerMessageId,
        sentAt: communicationMessages.sentAt,
        deliveredAt: communicationMessages.deliveredAt,
        failedAt: communicationMessages.failedAt,
        failureClass: communicationMessages.failureClass,
        failureCode: communicationMessages.failureCode,
      })
      .from(communicationMessages)
      .where(and(eq(communicationMessages.organizationId, ctx.organizationId), inArray(communicationMessages.id, messageIds)));

    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;

    return {
      counts,
      messages: rows.map((row) => ({
        messageId: row.id,
        status: row.status,
        provider: row.provider,
        providerMessageId: row.providerMessageId,
        // The one honest definition of "sent": a real provider accepted it
        // and gave us its own id back.
        confirmedByProvider: Boolean(row.providerMessageId) && row.provider === "whatsapp_cloud_api",
        sentAt: row.sentAt,
        deliveredAt: row.deliveredAt,
        failedAt: row.failedAt,
        failureClass: row.failureClass,
        failureCode: row.failureCode,
      })),
    };
  },
};

/* ------------------------------------------------------------------ */
/* mark_whatsapp_sent                                                  */
/* ------------------------------------------------------------------ */

const markWhatsappSentInput = z
  .object({
    leadId: uuid,
    sentAt: z.string().datetime(),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();

/**
 * Records that a HUMAN sent a WhatsApp message by hand, outside LYNQ.
 *
 * Deliberately does NOT create a `communication_messages` row, and
 * deliberately cannot set any message to `sent`: LYNQ did not send this and
 * has no provider message ID for it, so representing it as a tracked send
 * would be a lie that then flows into delivery analytics. It is an
 * append-only CRM activity, labelled as manual and unverified.
 */
export const markWhatsappSentTool: ToolImplementation<z.infer<typeof markWhatsappSentInput>, unknown> = {
  toolKey: "leadgen.mark_whatsapp_sent",
  version: 1,
  inputSchema: markWhatsappSentInput,
  execute: async (ctx, input) => {
    const actorUserId = await resolveActingUserId(ctx);
    const bundle = await loadLeadBundle(ctx.db, ctx.organizationId, input.leadId);

    const activity = await createActivity(ctx.db, {
      organizationId: ctx.organizationId,
      leadId: bundle.lead.id,
      contactId: bundle.contact?.id ?? null,
      companyId: bundle.company?.id ?? null,
      activityType: "message",
      direction: "outbound",
      occurredAt: new Date(input.sentAt),
      subject: "Manual WhatsApp message (not sent through LYNQ)",
      summary: `Logged by a human as sent by hand. LYNQ has no provider message ID and cannot confirm delivery.${input.note ? ` ${input.note}` : ""}`,
      agentId: ctx.principal.agentId,
      actorUserId,
    });

    return {
      activityId: activity.id,
      leadId: bundle.lead.id,
      recordedAs: "manual_unverified",
      providerMessageId: null,
      countedInDeliveryAnalytics: false,
    };
  },
};

/* ------------------------------------------------------------------ */
/* suppress_contact                                                    */
/* ------------------------------------------------------------------ */

const suppressContactInput = z
  .object({
    channel: z.enum(["whatsapp", "sms", "email"]),
    identity: z.string().trim().min(3).max(320),
    reason: z.enum(["user_opt_out", "bounced_hard", "complaint", "manual", "compliance_hold"]),
    source: z.string().trim().max(200).optional(),
  })
  .strict();

export const suppressContactTool: ToolImplementation<z.infer<typeof suppressContactInput>, unknown> = {
  toolKey: "leadgen.suppress_contact",
  version: 1,
  inputSchema: suppressContactInput,
  execute: async (ctx, input) => {
    const actorUserId = await resolveActingUserId(ctx);
    const suppression = await suppressIdentity(ctx.db, {
      organizationId: ctx.organizationId,
      channel: input.channel,
      rawIdentity: input.identity,
      suppressionReason: input.reason,
      source: input.source ?? "leadgen_tool",
      actorUserId,
    });
    return { suppressionId: suppression.id, channel: input.channel, reason: suppression.suppressionReason, active: true };
  },
};
