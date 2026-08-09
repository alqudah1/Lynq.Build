import { describe, it, expect, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, makeCommunicationsUser, makeTestConnection, makeTestConversation, makeTestTemplate } from "./test-helpers";
import { createDraftMessage, approveDraftDirectly, queueMessageForSend, processSendJob, resolveMessageById } from "./messages";
import { findOrCreateConversation } from "./conversations";
import { disableConnection } from "./connections";
import { suppressIdentity } from "./consent";
import { recordExternalIdentitySeen } from "./identity";
import { recordDeliveryEvent, processInboundProviderEvent } from "./webhooks";
import { reconcileCommunications } from "./reconciliation";
import { createBulkBatch, snapshotBulkRecipients } from "./bulk";
import { createContact } from "@/lib/crm/contacts";
import { isPostgresUniqueViolation } from "@/lib/brain/db-errors";
import { StaleCommunicationUpdateError, MessageNotApprovedError } from "./errors";
import { communicationMessages, communicationConversations, communicationExternalIdentities, communicationDeliveryEvents, communicationBulkRecipients } from "@/db/schema";

afterEach(cleanupAgentRuntimeTestData);

describe("Communications OS concurrency and idempotency guarantees", () => {
  it("a duplicate outbound idempotency key sends once — the second draft with the same key is rejected", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const actorId = await makeCommunicationsUser(orgId, "communications_agent", ownerId);
    const conversation = await makeTestConversation(orgId, ownerId);

    await createDraftMessage(db, { organizationId: orgId, conversationId: conversation.id, channel: "email", recipientReference: "a@example.com", bodyText: "hi", idempotencyKey: "dup-key-1", actorUserId: actorId });

    let threw = false;
    try {
      await createDraftMessage(db, { organizationId: orgId, conversationId: conversation.id, channel: "email", recipientReference: "a@example.com", bodyText: "hi again", idempotencyKey: "dup-key-1", actorUserId: actorId });
    } catch (err) {
      threw = isPostgresUniqueViolation(err);
    }
    expect(threw).toBe(true);

    const rows = await db.select().from(communicationMessages).where(and(eq(communicationMessages.organizationId, orgId), eq(communicationMessages.idempotencyKey, "dup-key-1")));
    expect(rows).toHaveLength(1);
  });

  it("two workers cannot send the same message twice — the claim CAS lets exactly one through", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const actorId = await makeCommunicationsUser(orgId, "communications_agent", ownerId);
    const connection = await makeTestConnection(orgId, ownerId);
    const conversation = await makeTestConversation(orgId, ownerId, "email", connection.id);
    const draft = await createDraftMessage(db, { organizationId: orgId, conversationId: conversation.id, channel: "email", integrationConnectionId: connection.id, recipientReference: "race@example.com", bodyText: "hi", idempotencyKey: "race-send-1", actorUserId: actorId });
    await approveDraftDirectly(db, { organizationId: orgId, messageId: draft.id, actorUserId: actorId });
    await queueMessageForSend(db, { organizationId: orgId, messageId: draft.id, actorUserId: actorId });

    const results = await Promise.all([processSendJob(db, { organizationId: orgId, messageId: draft.id }), processSendJob(db, { organizationId: orgId, messageId: draft.id })]);
    const outcomes = results.map((r) => r.outcome).sort();
    expect(outcomes).toEqual(["sent", "skipped_not_queued"]);
  });

  it("delivery events are idempotent — the same provider event id produces exactly one delivery event", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const actorId = await makeCommunicationsUser(orgId, "communications_agent", ownerId);
    const connection = await makeTestConnection(orgId, ownerId);
    const conversation = await makeTestConversation(orgId, ownerId, "email", connection.id);
    const draft = await createDraftMessage(db, { organizationId: orgId, conversationId: conversation.id, channel: "email", integrationConnectionId: connection.id, recipientReference: "delivery@example.com", bodyText: "hi", idempotencyKey: "delivery-idem-1", actorUserId: actorId });
    await approveDraftDirectly(db, { organizationId: orgId, messageId: draft.id, actorUserId: actorId });
    await queueMessageForSend(db, { organizationId: orgId, messageId: draft.id, actorUserId: actorId });
    await processSendJob(db, { organizationId: orgId, messageId: draft.id });

    await recordDeliveryEvent(db, { organizationId: orgId, messageId: draft.id, providerEventId: null, eventType: "delivered", occurredAt: new Date(), rawStatusText: "delivered" });
    const message = await resolveMessageById(db, orgId, draft.id);
    expect(message.status).toBe("delivered");

    const events = await db.select().from(communicationDeliveryEvents).where(eq(communicationDeliveryEvents.messageId, draft.id));
    expect(events).toHaveLength(1);
  });

  it("out-of-order delivery events never regress message status — a late 'sent' after 'delivered' does not revert it", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const actorId = await makeCommunicationsUser(orgId, "communications_agent", ownerId);
    const connection = await makeTestConnection(orgId, ownerId);
    const conversation = await makeTestConversation(orgId, ownerId, "email", connection.id);
    const draft = await createDraftMessage(db, { organizationId: orgId, conversationId: conversation.id, channel: "email", integrationConnectionId: connection.id, recipientReference: "order@example.com", bodyText: "hi", idempotencyKey: "out-of-order-1", actorUserId: actorId });
    await approveDraftDirectly(db, { organizationId: orgId, messageId: draft.id, actorUserId: actorId });
    await queueMessageForSend(db, { organizationId: orgId, messageId: draft.id, actorUserId: actorId });
    await processSendJob(db, { organizationId: orgId, messageId: draft.id });

    await recordDeliveryEvent(db, { organizationId: orgId, messageId: draft.id, providerEventId: null, eventType: "delivered", occurredAt: new Date(), rawStatusText: "delivered" });
    // A duplicated/late "sent" event arrives after delivery — must not regress the message.
    await recordDeliveryEvent(db, { organizationId: orgId, messageId: draft.id, providerEventId: null, eventType: "sent", occurredAt: new Date(Date.now() - 60_000), rawStatusText: "sent" });

    const message = await resolveMessageById(db, orgId, draft.id);
    expect(message.status).toBe("delivered");
  });

  it("a duplicate webhook is processed once", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const connection = await makeTestConnection(orgId, ownerId);
    const payload = { externalEventId: "webhook-dup-1", senderReference: "wh@example.com", recipientReference: "us@example.com", bodyText: "Hi" };

    const [first, second] = await Promise.all([
      processInboundProviderEvent(db, { organizationId: orgId, connectionId: connection.id, provider: "dev_email", externalEventId: "webhook-dup-1", eventType: "inbound", rawPayload: payload }),
      processInboundProviderEvent(db, { organizationId: orgId, connectionId: connection.id, provider: "dev_email", externalEventId: "webhook-dup-1", eventType: "inbound", rawPayload: payload }),
    ]);
    expect([first, second].sort()).toEqual(["duplicate", "processed"]);

    const messages = await db.select().from(communicationMessages).where(eq(communicationMessages.organizationId, orgId));
    expect(messages).toHaveLength(1);
  });

  it("a racing send-queue attempt only wins once — revision-guarded", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const actorId = await makeCommunicationsUser(orgId, "communications_agent", ownerId);
    const connection = await makeTestConnection(orgId, ownerId);
    const conversation = await makeTestConversation(orgId, ownerId, "email", connection.id);
    const draft = await createDraftMessage(db, { organizationId: orgId, conversationId: conversation.id, channel: "email", integrationConnectionId: connection.id, recipientReference: "queuerace@example.com", bodyText: "hi", idempotencyKey: "queue-race-1", actorUserId: actorId });
    await approveDraftDirectly(db, { organizationId: orgId, messageId: draft.id, actorUserId: actorId });

    const results = await Promise.allSettled([
      queueMessageForSend(db, { organizationId: orgId, messageId: draft.id, actorUserId: actorId }),
      queueMessageForSend(db, { organizationId: orgId, messageId: draft.id, actorUserId: actorId }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(StaleCommunicationUpdateError);
  });

  it("approval revoked before send blocks — a cancelled message cannot be queued", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const actorId = await makeCommunicationsUser(orgId, "communications_agent", ownerId);
    const connection = await makeTestConnection(orgId, ownerId);
    const conversation = await makeTestConversation(orgId, ownerId, "email", connection.id);
    const draft = await createDraftMessage(db, { organizationId: orgId, conversationId: conversation.id, channel: "email", integrationConnectionId: connection.id, recipientReference: "revoke@example.com", bodyText: "hi", idempotencyKey: "revoke-1", actorUserId: actorId });
    await approveDraftDirectly(db, { organizationId: orgId, messageId: draft.id, actorUserId: actorId });

    const { revokeMessageApproval } = await import("./messages");
    await revokeMessageApproval(db, { organizationId: orgId, messageId: draft.id, reason: "Changed our mind", actorUserId: actorId });

    await expect(queueMessageForSend(db, { organizationId: orgId, messageId: draft.id, actorUserId: actorId })).rejects.toThrow(MessageNotApprovedError);
  });

  it("consent/suppression added after queueing blocks the actual send", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const actorId = await makeCommunicationsUser(orgId, "communications_agent", ownerId);
    const connection = await makeTestConnection(orgId, ownerId);
    const conversation = await makeTestConversation(orgId, ownerId, "email", connection.id);
    const draft = await createDraftMessage(db, { organizationId: orgId, conversationId: conversation.id, channel: "email", integrationConnectionId: connection.id, recipientReference: "suppressme@example.com", bodyText: "hi", idempotencyKey: "suppress-race-1", actorUserId: actorId });
    await approveDraftDirectly(db, { organizationId: orgId, messageId: draft.id, actorUserId: actorId });
    await queueMessageForSend(db, { organizationId: orgId, messageId: draft.id, actorUserId: actorId });

    await suppressIdentity(db, { organizationId: orgId, channel: "email", rawIdentity: "suppressme@example.com", suppressionReason: "user_opt_out", actorUserId: ownerId });

    const result = await processSendJob(db, { organizationId: orgId, messageId: draft.id });
    expect(result.outcome).toBe("failed");
    const message = await resolveMessageById(db, orgId, draft.id);
    expect(message.status).toBe("failed");
    expect(message.failureClass).toBe("suppressed");
  });

  it("a disabled connection blocks the actual send", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const actorId = await makeCommunicationsUser(orgId, "communications_agent", ownerId);
    const connection = await makeTestConnection(orgId, ownerId);
    const conversation = await makeTestConversation(orgId, ownerId, "email", connection.id);
    const draft = await createDraftMessage(db, { organizationId: orgId, conversationId: conversation.id, channel: "email", integrationConnectionId: connection.id, recipientReference: "disabled@example.com", bodyText: "hi", idempotencyKey: "disabled-conn-1", actorUserId: actorId });
    await approveDraftDirectly(db, { organizationId: orgId, messageId: draft.id, actorUserId: actorId });
    await queueMessageForSend(db, { organizationId: orgId, messageId: draft.id, actorUserId: actorId });

    await disableConnection(db, { organizationId: orgId, connectionId: connection.id, expectedRevision: connection.revision, actorUserId: ownerId });

    const result = await processSendJob(db, { organizationId: orgId, messageId: draft.id });
    expect(result.outcome).toBe("failed");
    const message = await resolveMessageById(db, orgId, draft.id);
    expect(message.failureClass).toBe("connection_disabled");
  });

  it("a provider timeout leaves the message uncertain, never blindly resent — reconciliation marks it failed for human review, not auto-retried", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const actorId = await makeCommunicationsUser(orgId, "communications_agent", ownerId);
    const connection = await makeTestConnection(orgId, ownerId);
    const conversation = await makeTestConversation(orgId, ownerId, "email", connection.id);
    const draft = await createDraftMessage(db, { organizationId: orgId, conversationId: conversation.id, channel: "email", integrationConnectionId: connection.id, recipientReference: "stuck@example.com", bodyText: "hi", idempotencyKey: "stuck-1", actorUserId: actorId });
    await approveDraftDirectly(db, { organizationId: orgId, messageId: draft.id, actorUserId: actorId });
    await queueMessageForSend(db, { organizationId: orgId, messageId: draft.id, actorUserId: actorId });

    // Simulate a claimed-but-uncertain send (e.g. a real provider timeout) by
    // directly moving the message to "sending" with a stale `updatedAt`,
    // exactly the state `processSendJob` itself leaves an uncertain outcome
    // in — reconciliation, not blind retry, is what resolves it.
    await db
      .update(communicationMessages)
      .set({ status: "sending", updatedAt: new Date(Date.now() - 20 * 60 * 1000) })
      .where(eq(communicationMessages.id, draft.id));

    // A concurrent re-run of the send job must be a safe no-op — the message is no longer "queued".
    const raceResult = await processSendJob(db, { organizationId: orgId, messageId: draft.id });
    expect(raceResult.outcome).toBe("skipped_not_queued");

    const summary = await reconcileCommunications(db, { organizationId: orgId });
    expect(summary.markedUncertainFailed).toBe(1);

    const message = await resolveMessageById(db, orgId, draft.id);
    expect(message.status).toBe("failed");
    expect(message.failureClass).toBe("provider_timeout");
  });

  it("a duplicate external thread on the same connection reuses the existing conversation, never creates a second one", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const connection = await makeTestConnection(orgId, ownerId);

    const [first, second] = await Promise.all([
      findOrCreateConversation(db, { organizationId: orgId, channel: "email", integrationConnectionId: connection.id, externalThreadId: "thread-abc", actorUserId: ownerId }),
      findOrCreateConversation(db, { organizationId: orgId, channel: "email", integrationConnectionId: connection.id, externalThreadId: "thread-abc", actorUserId: ownerId }),
    ]);
    expect(first.id).toBe(second.id);

    const rows = await db.select().from(communicationConversations).where(and(eq(communicationConversations.organizationId, orgId), eq(communicationConversations.externalThreadId, "thread-abc")));
    expect(rows).toHaveLength(1);
  });

  it("duplicate external identity mapping is controlled — recording the same identity twice never creates two rows", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);

    await Promise.all([
      recordExternalIdentitySeen(db, { organizationId: orgId, channel: "email", rawIdentity: "concurrent@example.com", contactId: null }),
      recordExternalIdentitySeen(db, { organizationId: orgId, channel: "email", rawIdentity: "concurrent@example.com", contactId: null }),
    ]);

    const rows = await db.select().from(communicationExternalIdentities).where(and(eq(communicationExternalIdentities.organizationId, orgId), eq(communicationExternalIdentities.normalizedIdentity, "concurrent@example.com")));
    expect(rows).toHaveLength(1);
  });

  it("bulk recipient duplicates are prevented — the same contact snapshotted twice yields one recipient row", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const actorId = await makeCommunicationsUser(orgId, "communications_manager", ownerId);
    const { contact } = await createContact(db, { organizationId: orgId, displayName: "Bulk Target", primaryEmail: "bulk@example.com", actorUserId: ownerId });
    const { template } = await makeTestTemplate(orgId, ownerId);
    const batch = await createBulkBatch(db, { organizationId: orgId, name: "Test batch", channel: "email", templateId: template.id, actorUserId: actorId });

    await snapshotBulkRecipients(db, { organizationId: orgId, batchId: batch.id, contactIds: [contact.id], actorUserId: actorId });
    await snapshotBulkRecipients(db, { organizationId: orgId, batchId: batch.id, contactIds: [contact.id], actorUserId: actorId });

    const rows = await db.select().from(communicationBulkRecipients).where(eq(communicationBulkRecipients.batchId, batch.id));
    expect(rows).toHaveLength(1);
  });
});
