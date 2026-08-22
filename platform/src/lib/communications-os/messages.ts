import "server-only";
import { and, eq, desc } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { communicationMessages, communicationApprovalLinks } from "@/db/schema";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { recordAuditEvent } from "@/lib/audit";
import { approveRequest, rejectRequest } from "@/lib/agent-runtime/approvals";
import { enqueueJob } from "@/lib/runtime/queue";
import { PostgresRateLimiter } from "@/lib/rate-limit/postgres";
import { resolveCommunicationAuthContext, requireCommunicationsDraftAuthority, requireCommunicationsSendAuthority } from "./authz";
import {
  StaleCommunicationUpdateError,
  InvalidMessageTransitionError,
  MessageNotApprovedError,
  AgentCannotApproveOwnMessageError,
  RecipientSuppressedError,
  ConsentRequiredError,
  InvalidRecipientError,
  ProviderTemporarilyUnavailableError,
} from "./errors";
import { resolveConversationById, touchConversationLastMessageAt } from "./conversations";
import { resolveConnectionById, requireConnectionUsable } from "./connections";
import { resolveProviderAdapter } from "./providers/registry";
import { getActiveSuppression } from "./consent";
import { requestMessageSendApproval } from "./agents";
import { enforceSendRateLimits } from "./rate-limits";
import { recordCommunicationCrmActivity } from "./crm-integration";
import { providerTemplateDirectiveSchema } from "./validation";
import type { CommunicationChannel, CommunicationDirection, CommunicationMessageStatus, CommunicationFailureClass, IntegrationProvider } from "./validation";
import type { ProviderTemplateDirective, SendMessageResult } from "./providers/types";

type Db = NeonHttpDatabase<Record<string, unknown>>;

export interface CommunicationMessage {
  id: string;
  organizationId: string;
  conversationId: string;
  direction: CommunicationDirection;
  channel: CommunicationChannel;
  provider: IntegrationProvider | null;
  integrationConnectionId: string | null;
  senderReference: string | null;
  recipientReference: string | null;
  subject: string | null;
  bodyText: string | null;
  providerTemplate: ProviderTemplateDirective | null;
  contentArtifactId: string | null;
  status: CommunicationMessageStatus;
  providerMessageId: string | null;
  idempotencyKey: string;
  sentAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  receivedAt: Date | null;
  failureClass: CommunicationFailureClass | null;
  failureCode: string | null;
  createdByUserId: string | null;
  createdByAgentId: string | null;
  approvalRequestId: string | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Explicit lifecycle transition map — no code path sets `status` to an
 * arbitrary value directly. A draft is not a sent communication; "sent"
 * only ever comes from a real worker-driven provider dispatch
 * (`processSendJob`), never from this map being walked manually.
 */
const ALLOWED_TRANSITIONS: Record<CommunicationMessageStatus, CommunicationMessageStatus[]> = {
  draft: ["pending_approval", "approved", "cancelled"],
  pending_approval: ["approved", "draft", "cancelled"],
  approved: ["queued", "cancelled"],
  queued: ["sending", "cancelled"],
  // `sending -> queued` exists for exactly one case: the provider
  // POSITIVELY refused the request (a rate limit, an explicit 429) and
  // therefore created nothing, so releasing the claim and letting the
  // durable job retry with backoff cannot duplicate a delivery. It is
  // never used for an UNCERTAIN outcome — that still parks at `sending`
  // for reconciliation, because a blind retry there could double-send.
  sending: ["sent", "failed", "queued"],
  sent: ["delivered", "failed"],
  delivered: [],
  failed: [],
  received: [],
  cancelled: [],
};

function assertTransitionAllowed(from: CommunicationMessageStatus, to: CommunicationMessageStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) throw new InvalidMessageTransitionError(from, to);
}

export interface CreateDraftMessageInput {
  organizationId: string;
  conversationId: string;
  channel: CommunicationChannel;
  integrationConnectionId?: string | null;
  senderReference?: string | null;
  recipientReference: string;
  subject?: string | null;
  bodyText: string;
  /**
   * Required for any business-initiated WhatsApp message — Meta will not
   * deliver free text to someone outside an open 24-hour service window.
   * `bodyText` must be the rendering of this same template with these
   * same parameters, so the human approving the draft is approving the
   * exact string Meta will deliver.
   */
  providerTemplate?: ProviderTemplateDirective | null;
  idempotencyKey: string;
  createdByAgentId?: string | null;
  actorUserId: string;
}

export async function createDraftMessage(db: Db, input: CreateDraftMessageInput): Promise<CommunicationMessage> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsDraftAuthority(db, ctx, "communication_message", "new");
  const conversation = await resolveConversationById(db, input.organizationId, input.conversationId);

  const adapter = input.integrationConnectionId ? resolveProviderAdapter((await resolveConnectionById(db, input.organizationId, input.integrationConnectionId)).provider) : null;
  if (adapter) {
    const validation = adapter.validateRecipient(input.recipientReference);
    if (!validation.valid) throw new InvalidRecipientError(validation.reason ?? "invalid recipient");
  }

  // Validated here rather than at send time: a template directive Meta
  // would reject must never reach an approved batch, where the failure
  // would surface one recipient at a time in production.
  const providerTemplate = input.providerTemplate ? providerTemplateDirectiveSchema.parse(input.providerTemplate) : null;

  const [row] = await db
    .insert(communicationMessages)
    .values({
      organizationId: input.organizationId,
      conversationId: conversation.id,
      direction: "outbound",
      channel: input.channel,
      integrationConnectionId: input.integrationConnectionId ?? null,
      senderReference: input.senderReference ?? null,
      recipientReference: input.recipientReference,
      subject: input.subject ?? null,
      bodyText: input.bodyText,
      providerTemplate,
      idempotencyKey: input.idempotencyKey,
      createdByUserId: input.createdByAgentId ? null : input.actorUserId,
      createdByAgentId: input.createdByAgentId ?? null,
    })
    .returning();

  await recordAuditEvent(db, { eventType: "communication_message_draft_created", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "communication_message", targetId: row.id, metadata: { channel: input.channel, conversationId: conversation.id } });
  return row as CommunicationMessage;
}

export async function resolveMessageById(db: Db, organizationId: string, messageId: string): Promise<CommunicationMessage> {
  const [row] = await db.select().from(communicationMessages).where(and(eq(communicationMessages.id, messageId), eq(communicationMessages.organizationId, organizationId)));
  if (!row) throw new TenantResourceNotFoundError();
  return row as CommunicationMessage;
}

export async function getMessageForUser(db: Db, input: { organizationId: string; messageId: string; actorUserId: string }): Promise<CommunicationMessage> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsDraftAuthority(db, ctx, "communication_message", input.messageId);
  return resolveMessageById(db, input.organizationId, input.messageId);
}

export async function listMessagesForConversation(db: Db, input: { organizationId: string; conversationId: string; actorUserId: string }): Promise<CommunicationMessage[]> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsDraftAuthority(db, ctx, "communication_message", "list");
  return db
    .select()
    .from(communicationMessages)
    .where(and(eq(communicationMessages.organizationId, input.organizationId), eq(communicationMessages.conversationId, input.conversationId)))
    .orderBy(communicationMessages.createdAt) as Promise<CommunicationMessage[]>;
}

/**
 * `fromStatus` is the CALLER's own already-known status (from the object
 * it just read) — deliberately never re-read fresh here. Re-reading would
 * open exactly the race this function exists to prevent: under two
 * concurrent callers racing the same transition, the loser's fresh read
 * could observe the WINNER's already-updated status and fail
 * `assertTransitionAllowed` with a confusing `InvalidMessageTransitionError`
 * ("sending" -> "sending") instead of the intended, revision-guarded
 * `StaleCommunicationUpdateError`. Checking against the caller's own
 * belief, then including that same belief in the UPDATE's WHERE clause
 * alongside the revision guard, makes the whole claim atomic — a losing
 * caller's WHERE clause simply matches zero rows.
 */
async function transitionMessageStatus(db: Db, input: { organizationId: string; messageId: string; fromStatus: CommunicationMessageStatus; toStatus: CommunicationMessageStatus; expectedRevision: number; extraSet?: Record<string, unknown> }): Promise<CommunicationMessage> {
  assertTransitionAllowed(input.fromStatus, input.toStatus);

  const [row] = await db
    .update(communicationMessages)
    .set({ status: input.toStatus, revision: input.expectedRevision + 1, updatedAt: new Date(), ...(input.extraSet ?? {}) })
    .where(
      and(
        eq(communicationMessages.id, input.messageId),
        eq(communicationMessages.organizationId, input.organizationId),
        eq(communicationMessages.status, input.fromStatus),
        eq(communicationMessages.revision, input.expectedRevision)
      )
    )
    .returning();
  if (!row) throw new StaleCommunicationUpdateError("communication message");
  return row as CommunicationMessage;
}

/**
 * Requests real approval via a fresh Communications Assistant execution —
 * the ONLY way an agent-authored draft may ever move toward being sent.
 * "Agent-generated external message: approval required by default."
 */
export async function submitMessageForApproval(db: Db, input: { organizationId: string; messageId: string; summary: string; actorUserId: string }): Promise<CommunicationMessage> {
  const message = await getMessageForUser(db, { organizationId: input.organizationId, messageId: input.messageId, actorUserId: input.actorUserId });

  const { approval } = await requestMessageSendApproval(db, {
    organizationId: input.organizationId,
    messageId: message.id,
    summary: input.summary,
    artifactId: message.contentArtifactId,
    actorUserId: input.actorUserId,
  });

  const updated = await transitionMessageStatus(db, { organizationId: input.organizationId, messageId: input.messageId, fromStatus: message.status, toStatus: "pending_approval", expectedRevision: message.revision, extraSet: { approvalRequestId: approval.id } });
  return updated;
}

/**
 * The lighter-weight, EXPLICIT path for a purely human-written internal
 * draft — "configurable" per spec: an org may choose to skip a formal
 * Runtime approval record for a plain human draft, but this still requires
 * `communications_send` capability (the sender IS the approver of their
 * own typed text) and is structurally unavailable for an agent-authored
 * draft, which must go through `submitMessageForApproval` instead.
 */
export async function approveDraftDirectly(db: Db, input: { organizationId: string; messageId: string; actorUserId: string }): Promise<CommunicationMessage> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsSendAuthority(db, ctx, "communication_message", input.messageId);

  const message = await resolveMessageById(db, input.organizationId, input.messageId);
  if (message.createdByAgentId) throw new AgentCannotApproveOwnMessageError();

  const updated = await transitionMessageStatus(db, { organizationId: input.organizationId, messageId: input.messageId, fromStatus: message.status, toStatus: "approved", expectedRevision: message.revision });
  await recordAuditEvent(db, { eventType: "communication_message_approved", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "communication_message", targetId: message.id, metadata: { path: "direct" } });
  return updated;
}

/** Reads the real Runtime approval decision and applies its consequence to the message — mirrors Marketing OS's `applyContentApprovalDecision` exactly. Decision authority (human-only) is enforced by `approveRequest`/`rejectRequest` themselves, never re-implemented here. */
export async function applyMessageApprovalDecision(db: Db, input: { organizationId: string; messageId: string; decision: "approved" | "rejected"; decisionNote?: string; actorUserId: string }): Promise<CommunicationMessage> {
  const message = await resolveMessageById(db, input.organizationId, input.messageId);

  const [link] = await db
    .select()
    .from(communicationApprovalLinks)
    .where(and(eq(communicationApprovalLinks.organizationId, input.organizationId), eq(communicationApprovalLinks.linkedEntityType, "message"), eq(communicationApprovalLinks.linkedEntityId, input.messageId)))
    .orderBy(desc(communicationApprovalLinks.createdAt))
    .limit(1);
  if (!link) throw new TenantResourceNotFoundError();

  if (input.decision === "approved") {
    const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
    await requireCommunicationsSendAuthority(db, ctx, "communication_message", input.messageId);
    await approveRequest(db, { organizationId: input.organizationId, approvalId: link.approvalRequestId, actorUserId: input.actorUserId, decisionNote: input.decisionNote });
    const updated = await transitionMessageStatus(db, { organizationId: input.organizationId, messageId: input.messageId, fromStatus: message.status, toStatus: "approved", expectedRevision: message.revision });
    await recordAuditEvent(db, { eventType: "communication_message_approved", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "communication_message", targetId: message.id, metadata: { path: "runtime_approval" } });
    return updated;
  }

  await rejectRequest(db, { organizationId: input.organizationId, approvalId: link.approvalRequestId, actorUserId: input.actorUserId, decisionNote: input.decisionNote });
  return transitionMessageStatus(db, { organizationId: input.organizationId, messageId: input.messageId, fromStatus: message.status, toStatus: "draft", expectedRevision: message.revision });
}

/** "Approval revoked before send blocks" — an already-approved (but not yet dispatched) message can be pulled back to `cancelled`; the send worker's own claim step naturally refuses a message that is no longer `queued`. */
export async function revokeMessageApproval(db: Db, input: { organizationId: string; messageId: string; reason: string; actorUserId: string }): Promise<CommunicationMessage> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsSendAuthority(db, ctx, "communication_message", input.messageId);
  const message = await resolveMessageById(db, input.organizationId, input.messageId);
  return transitionMessageStatus(db, { organizationId: input.organizationId, messageId: input.messageId, fromStatus: message.status, toStatus: "cancelled", expectedRevision: message.revision, extraSet: { failureCode: input.reason } });
}

export function messageSendJobIdempotencyKey(messageId: string): string {
  return `communication_send:${messageId}`;
}
export function parseMessageIdFromSendJobKey(key: string): string | null {
  return key.startsWith("communication_send:") ? key.slice("communication_send:".length) : null;
}

/**
 * `approved -> queued` — live-rechecks consent/suppression BEFORE
 * enqueuing (not just at draft time), so a recipient who opted out between
 * drafting and queuing is caught here rather than only at send time.
 * Enqueues the durable Runtime job the worker actually dispatches from.
 */
export async function queueMessageForSend(db: Db, input: { organizationId: string; messageId: string; actorUserId: string }): Promise<CommunicationMessage> {
  const ctx = await resolveCommunicationAuthContext(db, { organizationId: input.organizationId, actorUserId: input.actorUserId });
  await requireCommunicationsSendAuthority(db, ctx, "communication_message", input.messageId);

  const message = await resolveMessageById(db, input.organizationId, input.messageId);
  if (message.status !== "approved") throw new MessageNotApprovedError();
  if (!message.recipientReference) throw new InvalidRecipientError("message has no recipient");

  const suppression = await getActiveSuppression(db, { organizationId: input.organizationId, channel: message.channel, rawIdentity: message.recipientReference });
  if (suppression) throw new RecipientSuppressedError();

  const updated = await transitionMessageStatus(db, { organizationId: input.organizationId, messageId: input.messageId, fromStatus: message.status, toStatus: "queued", expectedRevision: message.revision });

  await enqueueJob(db, {
    organizationId: input.organizationId,
    jobType: "communication_send",
    idempotencyKey: messageSendJobIdempotencyKey(message.id),
  });

  await recordAuditEvent(db, { eventType: "communication_message_queued", actorUserId: input.actorUserId, organizationId: input.organizationId, targetType: "communication_message", targetId: message.id, metadata: { channel: message.channel } });
  return updated;
}

const FAILURE_CLASS_TO_MESSAGE: Record<Exclude<CommunicationFailureClass, "unknown">, string> = {
  invalid_recipient: "The recipient is not valid for this channel.",
  suppressed: "This recipient is on the suppression list.",
  consent_required: "This recipient has not opted in.",
  provider_rejected: "The provider rejected this message.",
  provider_timeout: "The provider's outcome for this send is uncertain.",
  permanent_provider_error: "A permanent provider error occurred.",
  transient_provider_error: "A transient provider error occurred.",
  approval_revoked: "Approval for this message was revoked before it could be sent.",
  connection_disabled: "The integration connection is disabled.",
};

async function failMessage(db: Db, message: CommunicationMessage, failureClass: CommunicationFailureClass, failureCode: string | null): Promise<CommunicationMessage> {
  const updated = await transitionMessageStatus(db, {
    organizationId: message.organizationId,
    messageId: message.id,
    fromStatus: message.status,
    toStatus: "failed",
    expectedRevision: message.revision,
    extraSet: { failedAt: new Date(), failureClass, failureCode: failureCode ?? FAILURE_CLASS_TO_MESSAGE[failureClass as Exclude<CommunicationFailureClass, "unknown">] ?? "unknown error" },
  });
  await recordAuditEvent(db, { eventType: "communication_message_failed", organizationId: message.organizationId, targetType: "communication_message", targetId: message.id, metadata: { failureClass, channel: message.channel } });
  return updated;
}

/**
 * ============================================================================
 * The worker-driven send — Module 16's `communication_send` job handler
 * ============================================================================
 * Claim-then-dispatch, mirroring Module 14's `agent_execution` node
 * concurrency hardening: the `queued -> sending` transition is the atomic
 * claim (a revision-guarded CAS); only the caller that wins it proceeds to
 * actually call the provider. Every precondition (approval still valid,
 * connection usable, consent/suppression not revoked) is re-checked LIVE
 * here, never trusted from queue time — "live permissions must be
 * revalidated before send."
 */
export async function processSendJob(db: Db, input: { organizationId: string; messageId: string }): Promise<{ outcome: "sent" | "failed" | "skipped_not_queued" | "uncertain" }> {
  const message = await resolveMessageById(db, input.organizationId, input.messageId);
  if (message.status !== "queued") return { outcome: "skipped_not_queued" };

  let claimed: CommunicationMessage;
  try {
    claimed = await transitionMessageStatus(db, { organizationId: input.organizationId, messageId: input.messageId, fromStatus: message.status, toStatus: "sending", expectedRevision: message.revision });
  } catch (err) {
    if (err instanceof StaleCommunicationUpdateError) return { outcome: "skipped_not_queued" };
    throw err;
  }

  if (!claimed.recipientReference) {
    await failMessage(db, claimed, "invalid_recipient", "no recipient");
    return { outcome: "failed" };
  }

  const suppression = await getActiveSuppression(db, { organizationId: input.organizationId, channel: claimed.channel, rawIdentity: claimed.recipientReference });
  if (suppression) {
    await failMessage(db, claimed, "suppressed", suppression.suppressionReason);
    return { outcome: "failed" };
  }

  if (!claimed.integrationConnectionId) {
    await failMessage(db, claimed, "connection_disabled", "no connection configured");
    return { outcome: "failed" };
  }
  const connection = await resolveConnectionById(db, input.organizationId, claimed.integrationConnectionId);
  try {
    requireConnectionUsable(connection);
  } catch {
    await failMessage(db, claimed, "connection_disabled", connection.status);
    return { outcome: "failed" };
  }

  const rateLimiter = new PostgresRateLimiter(db);
  try {
    await enforceSendRateLimits(db, rateLimiter, {
      organizationId: input.organizationId,
      connectionId: connection.id,
      channel: claimed.channel,
      recipientReference: claimed.recipientReference,
      agentId: claimed.createdByAgentId,
      workflowExecutionId: null,
    });
  } catch {
    await failMessage(db, claimed, "provider_rejected", "rate_limited");
    return { outcome: "failed" };
  }

  const adapter = resolveProviderAdapter(connection.provider);
  const { resolveActiveCredentialSecret } = await import("./connections");
  const secret = await resolveActiveCredentialSecret(db, { organizationId: input.organizationId, connectionId: connection.id });

  let result: SendMessageResult;
  try {
    result = await adapter.sendMessage(
      { secret: secret ?? "", externalAccountId: connection.externalAccountId },
      {
        organizationId: input.organizationId,
        connectionId: connection.id,
        recipientReference: claimed.recipientReference,
        senderReference: claimed.senderReference,
        subject: claimed.subject,
        bodyText: claimed.bodyText ?? "",
        idempotencyKey: claimed.idempotencyKey,
        providerTemplate: claimed.providerTemplate,
      }
    );
  } catch (err) {
    const mapped = adapter.mapProviderError(err);
    await failMessage(db, claimed, mapped.failureClass, mapped.failureCode);
    return { outcome: "failed" };
  }

  if (result.outcome === "rejected") {
    if (result.failureClass === "transient_provider_error") {
      // The provider refused the request outright and created nothing —
      // a rate limit or a throttle. Release the claim back to `queued`
      // and throw, so the DURABLE job retries with the queue's own
      // exponential backoff instead of this message dying on a condition
      // that clears itself in seconds. Safe against duplication
      // precisely because "rejected" means no message exists provider-side.
      await transitionMessageStatus(db, { organizationId: input.organizationId, messageId: input.messageId, fromStatus: claimed.status, toStatus: "queued", expectedRevision: claimed.revision, extraSet: { failureCode: result.failureCode } });
      throw new ProviderTemporarilyUnavailableError(result.failureCode ?? "transient_provider_error");
    }
    await failMessage(db, claimed, result.failureClass ?? "provider_rejected", result.failureCode);
    return { outcome: "failed" };
  }

  if (result.outcome === "uncertain") {
    // The provider's own outcome is genuinely unknown — never assumed
    // successful or blindly retried. Left at "sending" for reconciliation
    // to surface for human review rather than auto-resent under the same
    // (already possibly-used) idempotency key.
    await recordAuditEvent(db, { eventType: "communication_message_failed", organizationId: input.organizationId, targetType: "communication_message", targetId: claimed.id, metadata: { failureClass: "provider_timeout", uncertain: true } });
    return { outcome: "uncertain" };
  }

  const sentAt = new Date();
  const sent = await transitionMessageStatus(db, {
    organizationId: input.organizationId,
    messageId: input.messageId,
    fromStatus: claimed.status,
    toStatus: "sent",
    expectedRevision: claimed.revision,
    extraSet: { sentAt, providerMessageId: result.providerMessageId, provider: connection.provider, failureCode: null, failureClass: null },
  });

  await recordAuditEvent(db, { eventType: "communication_message_sent", organizationId: input.organizationId, targetType: "communication_message", targetId: sent.id, metadata: { channel: sent.channel, provider: connection.provider } });

  const conversation = await resolveConversationById(db, input.organizationId, sent.conversationId);
  await touchConversationLastMessageAt(db, { organizationId: input.organizationId, conversationId: conversation.id, at: sentAt });

  // Always the org owner, never `sent.createdByUserId` — a Communications-
  // role-only sender will typically hold no CRM authority at all (the two
  // permission systems are deliberately independent), so using the
  // drafting human as the CRM-activity actor would silently fail for the
  // common case. The owner's bootstrap CRM authority exists precisely so
  // a genuinely system-triggered record like this one always succeeds.
  const { resolveOrganizationOwnerUserId } = await import("./crm-integration");
  const systemActor = await resolveOrganizationOwnerUserId(db, input.organizationId);
  if (systemActor) {
    await recordCommunicationCrmActivity(db, {
      organizationId: input.organizationId,
      channel: sent.channel,
      direction: "outbound",
      contactId: conversation.contactId,
      companyId: conversation.companyId,
      leadId: conversation.leadId,
      opportunityId: conversation.opportunityId,
      messageId: sent.id,
      occurredAt: sentAt,
      actorUserId: systemActor,
      agentId: sent.createdByAgentId,
    }).catch(() => undefined);
  }

  return { outcome: "sent" };
}

export interface IngestInboundMessageInput {
  organizationId: string;
  connectionId: string;
  conversationId: string;
  senderReference: string;
  recipientReference: string;
  subject: string | null;
  bodyText: string;
  channel: CommunicationChannel;
  receivedAt: Date;
}

/** Creates the canonical inbound message and, when the conversation has a resolved CRM link, a real CRM activity — never at any earlier stage than actual receipt. */
export async function ingestInboundMessage(db: Db, input: IngestInboundMessageInput): Promise<CommunicationMessage> {
  const connection = await resolveConnectionById(db, input.organizationId, input.connectionId);

  const [row] = await db
    .insert(communicationMessages)
    .values({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      direction: "inbound",
      channel: input.channel,
      provider: connection.provider,
      integrationConnectionId: connection.id,
      senderReference: input.senderReference,
      recipientReference: input.recipientReference,
      subject: input.subject,
      bodyText: input.bodyText,
      status: "received",
      receivedAt: input.receivedAt,
      idempotencyKey: `inbound:${input.connectionId}:${input.senderReference}:${input.receivedAt.toISOString()}`,
    })
    .returning();

  await recordAuditEvent(db, { eventType: "communication_message_received", organizationId: input.organizationId, targetType: "communication_message", targetId: row.id, metadata: { channel: input.channel } });

  await touchConversationLastMessageAt(db, { organizationId: input.organizationId, conversationId: input.conversationId, at: input.receivedAt });

  const conversation = await resolveConversationById(db, input.organizationId, input.conversationId);
  const { resolveOrganizationOwnerUserId } = await import("./crm-integration");
  const systemActor = await resolveOrganizationOwnerUserId(db, input.organizationId);
  if (systemActor) {
    await recordCommunicationCrmActivity(db, {
      organizationId: input.organizationId,
      channel: input.channel,
      direction: "inbound",
      contactId: conversation.contactId,
      companyId: conversation.companyId,
      leadId: conversation.leadId,
      opportunityId: conversation.opportunityId,
      messageId: row.id,
      occurredAt: input.receivedAt,
      actorUserId: systemActor,
    }).catch(() => undefined);
  }

  return row as CommunicationMessage;
}

/** Also used directly for consent gating checks elsewhere (e.g. bulk recipient filtering) without needing a full message object. */
export async function assertConsentAllowsSend(db: Db, input: { organizationId: string; channel: CommunicationChannel; rawIdentity: string; requireExplicitOptIn: boolean }): Promise<void> {
  const suppression = await getActiveSuppression(db, { organizationId: input.organizationId, channel: input.channel, rawIdentity: input.rawIdentity });
  if (suppression) throw new RecipientSuppressedError();
  if (!input.requireExplicitOptIn) return;

  const { getConsentStatus } = await import("./consent");
  const consent = await getConsentStatus(db, { organizationId: input.organizationId, channel: input.channel, rawIdentity: input.rawIdentity });
  if (!consent || consent.consentStatus !== "opted_in") throw new ConsentRequiredError();
}
