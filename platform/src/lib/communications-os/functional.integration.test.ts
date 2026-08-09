import { describe, it, expect, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, makeUser, makeOrgWithOwner, cleanupAgentRuntimeTestData, makeCommunicationsUser, makeTestConnection, makeTestConversation } from "./test-helpers";
import { createConnection } from "./connections";
import { findOrCreateConversation } from "./conversations";
import { createDraftMessage, submitMessageForApproval, approveDraftDirectly, applyMessageApprovalDecision, queueMessageForSend, processSendJob } from "./messages";
import { processInboundProviderEvent } from "./webhooks";
import { storeConnectionCredential } from "./connections";
import { resolveContactByIdentity, recordExternalIdentitySeen } from "./identity";
import { createContact } from "@/lib/crm/contacts";
import { grantSalesRole } from "@/lib/sales-os/roles";
import { grantMarketingRole } from "@/lib/marketing-os/roles";
import { seedCommunicationsAgent, createDraftReplyTask } from "./agents";
import { InsufficientRoleError } from "@/lib/authz/errors";
import { AgentCannotApproveOwnMessageError, MessageNotApprovedError } from "./errors";
import { crmActivities, communicationMessages, communicationProviderEvents, auditLogs } from "@/db/schema";

afterEach(cleanupAgentRuntimeTestData);

describe("Communications OS functional guarantees", () => {
  it("Communications capability is independent from Sales OS roles — a Sales rep with no Communications role cannot draft", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const salesUserId = await makeUser();
    const { addOrgMember } = await import("@/lib/crm/test-helpers");
    await addOrgMember(orgId, salesUserId, "member");
    await grantSalesRole(db, { organizationId: orgId, userId: salesUserId, role: "sales_rep", actorUserId: ownerId });

    const conversation = await makeTestConversation(orgId, ownerId);
    await expect(
      createDraftMessage(db, { organizationId: orgId, conversationId: conversation.id, channel: "email", recipientReference: "lead@example.com", bodyText: "hi", idempotencyKey: "k1", actorUserId: salesUserId })
    ).rejects.toThrow(InsufficientRoleError);
  });

  it("Communications capability is independent from Marketing OS roles — a Marketing admin with no Communications role cannot draft", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const marketingUserId = await makeUser();
    const { addOrgMember } = await import("@/lib/crm/test-helpers");
    await addOrgMember(orgId, marketingUserId, "member");
    await grantMarketingRole(db, { organizationId: orgId, userId: marketingUserId, role: "marketing_admin", actorUserId: ownerId });

    const conversation = await makeTestConversation(orgId, ownerId);
    await expect(
      createDraftMessage(db, { organizationId: orgId, conversationId: conversation.id, channel: "email", recipientReference: "lead@example.com", bodyText: "hi", idempotencyKey: "k2", actorUserId: marketingUserId })
    ).rejects.toThrow(InsufficientRoleError);
  });

  it("a Communications role holder can draft and send through the full lifecycle", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const actorId = await makeCommunicationsUser(orgId, "communications_agent", ownerId);
    const connection = await makeTestConnection(orgId, ownerId);
    const conversation = await makeTestConversation(orgId, ownerId, "email", connection.id);

    const draft = await createDraftMessage(db, { organizationId: orgId, conversationId: conversation.id, channel: "email", integrationConnectionId: connection.id, recipientReference: "customer@example.com", bodyText: "Hello", idempotencyKey: "lifecycle-1", actorUserId: actorId });
    expect(draft.status).toBe("draft");

    const approved = await approveDraftDirectly(db, { organizationId: orgId, messageId: draft.id, actorUserId: actorId });
    expect(approved.status).toBe("approved");

    const queued = await queueMessageForSend(db, { organizationId: orgId, messageId: draft.id, actorUserId: actorId });
    expect(queued.status).toBe("queued");

    const result = await processSendJob(db, { organizationId: orgId, messageId: draft.id });
    expect(result.outcome).toBe("sent");
  });

  it("agent-authored drafts require formal approval — approveDraftDirectly rejects an agent-created draft", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await seedCommunicationsAgent(db, { organizationId: orgId, humanOwnerUserId: ownerId, actorUserId: ownerId });
    const connection = await makeTestConnection(orgId, ownerId);
    // Seed one inbound message (which creates its own conversation) so createDraftReplyTask has something to reply to.
    await processInboundProviderEvent(db, {
      organizationId: orgId,
      connectionId: connection.id,
      provider: "dev_email",
      externalEventId: "seed-1",
      eventType: "inbound",
      rawPayload: { externalEventId: "seed-1", senderReference: "customer@example.com", recipientReference: "us@example.com", bodyText: "Hi there", subject: "Question" },
    });

    const { communicationConversations } = await import("@/db/schema");
    const [existingConversation] = await db.select().from(communicationConversations).where(eq(communicationConversations.organizationId, orgId));
    const result = await createDraftReplyTask(db, { organizationId: orgId, conversationId: existingConversation.id, actorUserId: ownerId });
    expect(result.draftMessageId).not.toBe("");

    await expect(approveDraftDirectly(db, { organizationId: orgId, messageId: result.draftMessageId, actorUserId: ownerId })).rejects.toThrow(AgentCannotApproveOwnMessageError);

    // The formal Runtime-approval path is the real way forward for an agent-authored draft.
    const submitted = await submitMessageForApproval(db, { organizationId: orgId, messageId: result.draftMessageId, summary: "Please review this agent-drafted reply.", actorUserId: ownerId });
    expect(submitted.status).toBe("pending_approval");

    const decided = await applyMessageApprovalDecision(db, { organizationId: orgId, messageId: result.draftMessageId, decision: "approved", actorUserId: ownerId });
    expect(decided.status).toBe("approved");
  });

  it("a draft does not create a CRM activity; a real send does", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const actorId = await makeCommunicationsUser(orgId, "communications_agent", ownerId);
    const { contact } = await createContact(db, { organizationId: orgId, displayName: "Jamie Rivera", primaryEmail: "jamie@example.com", actorUserId: ownerId });
    const connection = await makeTestConnection(orgId, ownerId);
    const conversation = await findOrCreateConversation(db, { organizationId: orgId, channel: "email", integrationConnectionId: connection.id, contactId: contact.id, actorUserId: ownerId });

    const draft = await createDraftMessage(db, { organizationId: orgId, conversationId: conversation.id, channel: "email", integrationConnectionId: connection.id, recipientReference: "jamie@example.com", bodyText: "Hello Jamie", idempotencyKey: "activity-1", actorUserId: actorId });

    const activitiesAfterDraft = await db.select().from(crmActivities).where(eq(crmActivities.organizationId, orgId));
    expect(activitiesAfterDraft).toHaveLength(0);

    await approveDraftDirectly(db, { organizationId: orgId, messageId: draft.id, actorUserId: actorId });
    await queueMessageForSend(db, { organizationId: orgId, messageId: draft.id, actorUserId: actorId });
    await processSendJob(db, { organizationId: orgId, messageId: draft.id });

    const activitiesAfterSend = await db.select().from(crmActivities).where(eq(crmActivities.organizationId, orgId));
    expect(activitiesAfterSend).toHaveLength(1);
    expect(activitiesAfterSend[0].direction).toBe("outbound");
  });

  it("ambiguous CRM identity does not auto-link; an exact unique match resolves safely", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);

    const unique = await resolveContactByIdentity(db, { organizationId: orgId, channel: "email", rawIdentity: "nobody@example.com" });
    expect(unique.contactId).toBeNull();

    await createContact(db, { organizationId: orgId, displayName: "One", primaryEmail: "shared@example.com", actorUserId: ownerId });
    await createContact(db, { organizationId: orgId, displayName: "Two", primaryEmail: "shared@example.com", actorUserId: ownerId });
    const ambiguous = await resolveContactByIdentity(db, { organizationId: orgId, channel: "email", rawIdentity: "shared@example.com" });
    expect(ambiguous.contactId).toBeNull();

    const { contact: soleContact } = await createContact(db, { organizationId: orgId, displayName: "Solo", primaryEmail: "solo@example.com", actorUserId: ownerId });
    const exact = await resolveContactByIdentity(db, { organizationId: orgId, channel: "email", rawIdentity: "solo@example.com" });
    expect(exact.contactId).toBe(soleContact.id);
  });

  it("an inbound provider event creates a canonical message and a real CRM activity", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { contact } = await createContact(db, { organizationId: orgId, displayName: "Sam", primaryEmail: "sam@example.com", actorUserId: ownerId });
    const connection = await makeTestConnection(orgId, ownerId);

    const outcome = await processInboundProviderEvent(db, {
      organizationId: orgId,
      connectionId: connection.id,
      provider: "dev_email",
      externalEventId: "inbound-evt-1",
      eventType: "inbound",
      rawPayload: { externalEventId: "inbound-evt-1", senderReference: "sam@example.com", recipientReference: "us@example.com", bodyText: "Real question", subject: "Hi" },
    });
    expect(outcome).toBe("processed");

    const messages = await db.select().from(communicationMessages).where(eq(communicationMessages.organizationId, orgId));
    expect(messages).toHaveLength(1);
    expect(messages[0].direction).toBe("inbound");

    const activities = await db.select().from(crmActivities).where(and(eq(crmActivities.organizationId, orgId), eq(crmActivities.contactId, contact.id)));
    expect(activities).toHaveLength(1);
    expect(activities[0].direction).toBe("inbound");
  });

  it("provider event deduplication — the same externalEventId processed twice creates exactly one message", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const connection = await makeTestConnection(orgId, ownerId);
    const payload = { externalEventId: "dedup-1", senderReference: "dup@example.com", recipientReference: "us@example.com", bodyText: "Hello" };

    const first = await processInboundProviderEvent(db, { organizationId: orgId, connectionId: connection.id, provider: "dev_email", externalEventId: "dedup-1", eventType: "inbound", rawPayload: payload });
    const second = await processInboundProviderEvent(db, { organizationId: orgId, connectionId: connection.id, provider: "dev_email", externalEventId: "dedup-1", eventType: "inbound", rawPayload: payload });

    expect(first).toBe("processed");
    expect(second).toBe("duplicate");

    const events = await db.select().from(communicationProviderEvents).where(eq(communicationProviderEvents.organizationId, orgId));
    expect(events).toHaveLength(1);
    const messages = await db.select().from(communicationMessages).where(eq(communicationMessages.organizationId, orgId));
    expect(messages).toHaveLength(1);
  });

  it("a provider credential secret never appears in audit metadata", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const connection = await createConnection(db, { organizationId: orgId, provider: "resend", integrationType: "email", displayName: "Real-looking connection", actorUserId: ownerId });
    const secret = "re_TOTALLY_SECRET_TOKEN_VALUE_998877";

    process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    await storeConnectionCredential(db, { organizationId: orgId, connectionId: connection.id, secret, actorUserId: ownerId });

    const logs = await db.select().from(auditLogs).where(eq(auditLogs.organizationId, orgId));
    const serialized = JSON.stringify(logs);
    expect(serialized.includes(secret)).toBe(false);
  });

  it("message body text never appears in audit metadata", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const actorId = await makeCommunicationsUser(orgId, "communications_agent", ownerId);
    const conversation = await makeTestConversation(orgId, ownerId);
    const distinctiveBody = "The quarterly renewal figure is exactly $48213.55, please confirm by Friday.";

    await createDraftMessage(db, { organizationId: orgId, conversationId: conversation.id, channel: "email", recipientReference: "x@example.com", bodyText: distinctiveBody, idempotencyKey: "body-audit-1", actorUserId: actorId });

    const logs = await db.select().from(auditLogs).where(eq(auditLogs.organizationId, orgId));
    const serialized = JSON.stringify(logs);
    expect(serialized.includes(distinctiveBody)).toBe(false);
  });

  it("invalid message lifecycle transitions are rejected — draft cannot jump directly to delivered", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const actorId = await makeCommunicationsUser(orgId, "communications_agent", ownerId);
    const conversation = await makeTestConversation(orgId, ownerId);
    const draft = await createDraftMessage(db, { organizationId: orgId, conversationId: conversation.id, channel: "email", recipientReference: "x@example.com", bodyText: "hi", idempotencyKey: "invalid-transition-1", actorUserId: actorId });

    await expect(queueMessageForSend(db, { organizationId: orgId, messageId: draft.id, actorUserId: actorId })).rejects.toThrow(MessageNotApprovedError);
  });

  it("recordExternalIdentitySeen upserts rather than duplicating a seen identity", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await recordExternalIdentitySeen(db, { organizationId: orgId, channel: "email", rawIdentity: "seen@example.com", contactId: null });
    await recordExternalIdentitySeen(db, { organizationId: orgId, channel: "email", rawIdentity: "seen@example.com", contactId: null });

    const { communicationExternalIdentities } = await import("@/db/schema");
    const rows = await db.select().from(communicationExternalIdentities).where(eq(communicationExternalIdentities.organizationId, orgId));
    expect(rows).toHaveLength(1);
  });
});
