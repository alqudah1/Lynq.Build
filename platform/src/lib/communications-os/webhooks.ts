import "server-only";
import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { communicationProviderEvents, communicationMessages, communicationDeliveryEvents } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { resolveConnectionById } from "./connections";
import { resolveProviderAdapter } from "./providers/registry";
import { findOrCreateConversationUnauthorized } from "./conversations";
import { ingestInboundMessage } from "./messages";
import { resolveContactByIdentity, recordExternalIdentitySeen } from "./identity";
import { suppressIdentity, upsertConsent, getActiveSuppression, liftSuppression } from "./consent";
import { detectOptOutIntent } from "@/lib/lead-gen/outreach";
import type { CommunicationChannel, CommunicationDeliveryEventType, IntegrationProvider } from "./validation";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export type ProcessOutcome = "processed" | "duplicate" | "ignored" | "failed";

/**
 * ============================================================================
 * Provider event ingestion — Module 16
 * ============================================================================
 * `authenticateWebhook` (each route calls its own provider-specific
 * signature check before this is ever reached — see the API route) →
 * `deduplicateEvent` (this function's own first move) → normalize →
 * resolve connection → resolve conversation → resolve contact where safe
 * → persist message/delivery event → CRM activity. Deduplicated on
 * exactly `(provider, connectionId, externalEventId)`, the DB's own
 * unique index — a second identical webhook delivery (every real provider
 * retries at-least-once) is a guaranteed no-op, never a duplicate message
 * or duplicate CRM activity.
 */
export async function processInboundProviderEvent(db: Db, input: { organizationId: string; connectionId: string; provider: IntegrationProvider; externalEventId: string; eventType: string; rawPayload: unknown }): Promise<ProcessOutcome> {
  let eventRow;
  try {
    [eventRow] = await db
      .insert(communicationProviderEvents)
      .values({ organizationId: input.organizationId, connectionId: input.connectionId, provider: input.provider, externalEventId: input.externalEventId, eventType: input.eventType })
      .returning();
  } catch (err) {
    if (isPostgresUniqueViolation(err)) {
      await recordAuditEvent(db, { eventType: "communication_provider_event_deduplicated", organizationId: input.organizationId, targetType: "integration_connection", targetId: input.connectionId, metadata: { provider: input.provider, eventType: input.eventType } });
      return "duplicate";
    }
    throw err;
  }

  await recordAuditEvent(db, { eventType: "communication_provider_event_received", organizationId: input.organizationId, targetType: "integration_connection", targetId: input.connectionId, metadata: { provider: input.provider, eventType: input.eventType } });

  const adapter = resolveProviderAdapter(input.provider);

  const inbound = adapter.normalizeInboundEvent(input.rawPayload);
  if (inbound) {
    const outcome = await handleNormalizedInbound(db, { organizationId: input.organizationId, connectionId: input.connectionId, provider: input.provider, providerEventId: eventRow.id, inbound });
    await markProviderEventProcessed(db, eventRow.id, outcome.processingStatus, outcome.normalizedEntityType, outcome.normalizedEntityId);
    return outcome.processingStatus === "processed" ? "processed" : "failed";
  }

  const delivery = adapter.normalizeDeliveryEvent(input.rawPayload);
  if (delivery) {
    const outcome = await applyDeliveryEvent(db, { organizationId: input.organizationId, provider: input.provider, providerEventId: eventRow.id, delivery });
    await markProviderEventProcessed(db, eventRow.id, outcome.processingStatus, outcome.normalizedEntityType, outcome.normalizedEntityId);
    return outcome.processingStatus === "processed" ? "processed" : "failed";
  }

  await markProviderEventProcessed(db, eventRow.id, "ignored", null, null);
  return "ignored";
}

async function markProviderEventProcessed(db: Db, eventId: string, status: "processed" | "failed" | "ignored", normalizedEntityType: string | null, normalizedEntityId: string | null): Promise<void> {
  await db.update(communicationProviderEvents).set({ processingStatus: status, normalizedEntityType, normalizedEntityId }).where(eq(communicationProviderEvents.id, eventId));
}

async function handleNormalizedInbound(db: Db, input: { organizationId: string; connectionId: string; provider: IntegrationProvider; providerEventId: string; inbound: ReturnType<NonNullable<ReturnType<typeof resolveProviderAdapter>["normalizeInboundEvent"]>> }): Promise<{ processingStatus: "processed" | "failed"; normalizedEntityType: string | null; normalizedEntityId: string | null }> {
  const event = input.inbound;
  if (!event) return { processingStatus: "failed", normalizedEntityType: null, normalizedEntityId: null };

  const connection = await resolveConnectionById(db, input.organizationId, input.connectionId);

  const { contactId } = await resolveContactByIdentity(db, { organizationId: input.organizationId, channel: connection.integrationType, rawIdentity: event.senderReference });
  await recordExternalIdentitySeen(db, { organizationId: input.organizationId, channel: connection.integrationType, rawIdentity: event.senderReference, contactId });

  const conversation = await findOrCreateConversationUnauthorized(db, {
    organizationId: input.organizationId,
    channel: connection.integrationType,
    integrationConnectionId: connection.id,
    contactId,
    externalThreadId: event.externalThreadId,
  });

  const message = await ingestInboundMessage(db, {
    organizationId: input.organizationId,
    connectionId: connection.id,
    conversationId: conversation.id,
    senderReference: event.senderReference,
    recipientReference: event.recipientReference,
    subject: event.subject,
    bodyText: event.bodyText,
    channel: connection.integrationType,
    receivedAt: event.receivedAt,
  });

  await applyOptOutIntent(db, {
    organizationId: input.organizationId,
    channel: connection.integrationType,
    rawIdentity: event.senderReference,
    contactId,
    bodyText: event.bodyText,
  });

  return { processingStatus: "processed", normalizedEntityType: "communication_message", normalizedEntityId: message.id };
}

/**
 * ============================================================================
 * STOP / START — applied inside the webhook, before anything else
 * ============================================================================
 * Opt-out is a compliance obligation, not a classification task. A
 * recipient who replies "STOP" is suppressed here, synchronously, by a
 * deterministic keyword check — never by a model, never by a queued job,
 * and never contingent on a human or an agent getting to the reply. The
 * suppression insert deliberately runs with a `null` actor and no
 * authority check: there is no user on a provider callback, and an
 * opt-out must take effect even if every other step fails.
 *
 * The consent RECORD is best-effort on top of that. It needs an actor
 * holding `communications_manage_consent`, so it runs as the org owner
 * (the same bootstrap-authority actor the CRM-activity path already
 * uses) and is swallowed on failure — losing the audit-friendly consent
 * row is regrettable, losing the suppression would be a violation.
 */
export async function applyOptOutIntent(
  db: Db,
  input: { organizationId: string; channel: CommunicationChannel; rawIdentity: string; contactId: string | null; bodyText: string }
): Promise<"opted_out" | "opted_in" | "no_intent"> {
  // Only channels a person can actually reply "STOP" on.
  if (input.channel !== "whatsapp" && input.channel !== "sms") return "no_intent";

  const intent = detectOptOutIntent(input.bodyText);
  if (!intent) return "no_intent";

  const { resolveOrganizationOwnerUserId } = await import("./crm-integration");
  const systemActor = await resolveOrganizationOwnerUserId(db, input.organizationId);

  if (intent === "opt_out") {
    await suppressIdentity(db, {
      organizationId: input.organizationId,
      channel: input.channel,
      rawIdentity: input.rawIdentity,
      suppressionReason: "user_opt_out",
      source: "reply_stop",
      actorUserId: null,
    });
    if (systemActor) {
      await upsertConsent(db, {
        organizationId: input.organizationId,
        channel: input.channel,
        rawIdentity: input.rawIdentity,
        contactId: input.contactId,
        consentStatus: "opted_out",
        consentSource: "reply_stop",
        actorUserId: systemActor,
      }).catch(() => undefined);
    }
    await recordAuditEvent(db, { eventType: "communication_consent_updated", organizationId: input.organizationId, targetType: "communication_consent_record", targetId: null, metadata: { channel: input.channel, source: "reply_stop", consentStatus: "opted_out" } });
    return "opted_out";
  }

  // "START" only lifts a suppression that this same opt-out mechanism
  // created. A hard bounce, a complaint or a compliance hold is never
  // undone by an inbound keyword.
  const active = await getActiveSuppression(db, { organizationId: input.organizationId, channel: input.channel, rawIdentity: input.rawIdentity });
  if (active && active.suppressionReason === "user_opt_out" && systemActor) {
    await liftSuppression(db, { organizationId: input.organizationId, suppressionId: active.id, actorUserId: systemActor }).catch(() => undefined);
  }
  if (systemActor) {
    await upsertConsent(db, {
      organizationId: input.organizationId,
      channel: input.channel,
      rawIdentity: input.rawIdentity,
      contactId: input.contactId,
      consentStatus: "opted_in",
      consentSource: "reply_start",
      actorUserId: systemActor,
    }).catch(() => undefined);
  }
  return "opted_in";
}

async function applyDeliveryEvent(db: Db, input: { organizationId: string; provider: IntegrationProvider; providerEventId: string; delivery: ReturnType<NonNullable<ReturnType<typeof resolveProviderAdapter>["normalizeDeliveryEvent"]>> }): Promise<{ processingStatus: "processed" | "failed"; normalizedEntityType: string | null; normalizedEntityId: string | null }> {
  const event = input.delivery;
  if (!event) return { processingStatus: "failed", normalizedEntityType: null, normalizedEntityId: null };

  const [message] = await db
    .select()
    .from(communicationMessages)
    .where(and(eq(communicationMessages.organizationId, input.organizationId), eq(communicationMessages.provider, input.provider), eq(communicationMessages.providerMessageId, event.providerMessageId)));
  if (!message) return { processingStatus: "failed", normalizedEntityType: null, normalizedEntityId: null };

  await recordDeliveryEvent(db, { organizationId: input.organizationId, messageId: message.id, providerEventId: input.providerEventId, eventType: event.eventType, occurredAt: event.occurredAt, rawStatusText: event.rawStatusText });
  return { processingStatus: "processed", normalizedEntityType: "communication_message", normalizedEntityId: message.id };
}

/** Precedence order — out-of-order provider events never regress a message's canonical status. A "delivered" arriving after a "bounced" (a real possibility with retried/duplicated provider webhooks) does not un-fail a failed message. */
const STATUS_PRECEDENCE: Record<CommunicationDeliveryEventType, number> = {
  accepted: 1,
  sent: 2,
  delivered: 3,
  read: 4,
  bounced: 3,
  rejected: 3,
  failed: 3,
};

const EVENT_TO_MESSAGE_STATUS: Partial<Record<CommunicationDeliveryEventType, "sent" | "delivered" | "failed">> = {
  sent: "sent",
  delivered: "delivered",
  bounced: "failed",
  rejected: "failed",
  failed: "failed",
};

export async function recordDeliveryEvent(db: Db, input: { organizationId: string; messageId: string; providerEventId: string | null; eventType: CommunicationDeliveryEventType; occurredAt: Date; rawStatusText: string | null }): Promise<void> {
  try {
    await db.insert(communicationDeliveryEvents).values({ organizationId: input.organizationId, messageId: input.messageId, providerEventId: input.providerEventId, eventType: input.eventType, occurredAt: input.occurredAt, rawStatusText: input.rawStatusText });
  } catch (err) {
    if (isPostgresUniqueViolation(err)) return; // Same provider event already recorded a delivery event — idempotent no-op.
    throw err;
  }

  const [message] = await db.select().from(communicationMessages).where(and(eq(communicationMessages.id, input.messageId), eq(communicationMessages.organizationId, input.organizationId)));
  if (!message) return;

  const newTargetStatus = EVENT_TO_MESSAGE_STATUS[input.eventType];
  if (!newTargetStatus) return; // "accepted"/"read" have no distinct message-status consequence beyond the delivery-event record itself.

  const currentRank = message.status === "delivered" ? 3 : message.status === "failed" ? 3 : message.status === "sent" ? 2 : 0;
  const newRank = STATUS_PRECEDENCE[input.eventType];
  if (newRank < currentRank) return; // Out-of-order — never regress.
  if (message.status !== "sent" && message.status !== "sending") return; // Only a message actually in flight can be moved by a delivery event.

  await db
    .update(communicationMessages)
    .set({
      status: newTargetStatus,
      deliveredAt: newTargetStatus === "delivered" ? input.occurredAt : message.deliveredAt,
      failedAt: newTargetStatus === "failed" ? input.occurredAt : message.failedAt,
      failureClass: newTargetStatus === "failed" ? "provider_rejected" : message.failureClass,
      revision: message.revision + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(communicationMessages.id, input.messageId), eq(communicationMessages.organizationId, input.organizationId), eq(communicationMessages.revision, message.revision)));

  const eventType = newTargetStatus === "delivered" ? "communication_message_delivered" : newTargetStatus === "failed" ? "communication_message_failed" : null;
  if (eventType) {
    await recordAuditEvent(db, { eventType, organizationId: input.organizationId, targetType: "communication_message", targetId: input.messageId, metadata: { deliveryEventType: input.eventType } });
  }
}
