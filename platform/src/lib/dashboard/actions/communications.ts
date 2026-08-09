"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { requireDashboardUser } from "@/lib/dashboard/session-gate";
import { getOrganizationBySlugForUser } from "@/lib/organizations/organizations";
import { createConnection, verifyConnection, storeConnectionCredential, disableConnection } from "@/lib/communications-os/connections";
import { findOrCreateConversation, updateConversationStatus, assignConversation } from "@/lib/communications-os/conversations";
import { createDraftMessage, submitMessageForApproval, approveDraftDirectly, applyMessageApprovalDecision, queueMessageForSend, revokeMessageApproval } from "@/lib/communications-os/messages";
import { createTemplate, createTemplateVersion, publishTemplateVersion } from "@/lib/communications-os/templates";
import { upsertConsent, suppressIdentity, liftSuppression } from "@/lib/communications-os/consent";
import { createBulkBatch, snapshotBulkRecipients, requestBulkApproval, applyBulkApprovalDecision, startBulkBatch, cancelBulkBatch } from "@/lib/communications-os/bulk";
import { createBulkBatchFromApprovedContent } from "@/lib/communications-os/marketing-integration";
import { createDraftReplyTask, createDraftFollowUpTask, seedCommunicationsAgent } from "@/lib/communications-os/agents";
import { seedCommunicationsTools } from "@/lib/communications-os/tools-seed";
import { grantCommunicationRole, revokeCommunicationRole } from "@/lib/communications-os/roles";
import { INTEGRATION_PROVIDERS, COMMUNICATION_CHANNELS, COMMUNICATION_CONVERSATION_STATUSES, COMMUNICATION_CONSENT_STATUSES, COMMUNICATION_CONSENT_SOURCES, COMMUNICATION_SUPPRESSION_REASONS, COMMUNICATION_ROLES } from "@/lib/communications-os/validation";
import { toActionResult } from "./errors";
import type { ActionResult } from "./types";

async function context(organizationSlug: string, path: string) {
  const env = loadEnv();
  const db = createDbClient(env);
  const user = await requireDashboardUser(db, path);
  const { organization } = await getOrganizationBySlugForUser(db, organizationSlug, user.userId);
  return { db, user, organization };
}

const uuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

export async function seedCommunicationsAction(organizationSlug: string): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/communications/settings`);
  try {
    await seedCommunicationsAgent(db, { organizationId: organization.id, humanOwnerUserId: user.userId, actorUserId: user.userId });
    await seedCommunicationsTools(db);
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/communications/settings`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

const createConnectionSchema = z.object({ provider: z.enum(INTEGRATION_PROVIDERS), integrationType: z.enum(COMMUNICATION_CHANNELS), displayName: z.string().trim().min(1).max(200) });

export async function createConnectionAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/integrations`);
  const parsed = createConnectionSchema.safeParse({ provider: formData.get("provider"), integrationType: formData.get("integrationType"), displayName: formData.get("displayName") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await createConnection(db, { organizationId: organization.id, actorUserId: user.userId, ...parsed.data });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/integrations`);
  return { ok: true };
}

export async function verifyConnectionAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/integrations`);
  const connectionId = uuidSchema.safeParse(formData.get("connectionId"));
  if (!connectionId.success) return toActionResult(connectionId.error);
  try {
    await verifyConnection(db, { organizationId: organization.id, connectionId: connectionId.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/integrations`);
  revalidatePath(`/app/${organizationSlug}/integrations/${connectionId.data}`);
  return { ok: true };
}

const storeCredentialSchema = z.object({ connectionId: uuidSchema, secret: z.string().trim().min(1).max(2000) });

export async function storeConnectionCredentialAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/integrations`);
  const parsed = storeCredentialSchema.safeParse({ connectionId: formData.get("connectionId"), secret: formData.get("secret") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await storeConnectionCredential(db, { organizationId: organization.id, connectionId: parsed.data.connectionId, secret: parsed.data.secret, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/integrations/${parsed.data.connectionId}`);
  return { ok: true };
}

const disableConnectionSchema = z.object({ connectionId: uuidSchema, expectedRevision: z.coerce.number().int().min(1) });

export async function disableConnectionAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/integrations`);
  const parsed = disableConnectionSchema.safeParse({ connectionId: formData.get("connectionId"), expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await disableConnection(db, { organizationId: organization.id, connectionId: parsed.data.connectionId, expectedRevision: parsed.data.expectedRevision, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/integrations`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Conversations & messages
// ---------------------------------------------------------------------------

const createConversationSchema = z.object({ channel: z.enum(COMMUNICATION_CHANNELS), integrationConnectionId: uuidSchema.optional(), contactId: uuidSchema.optional() });

export async function createConversationAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/communications/inbox`);
  const parsed = createConversationSchema.safeParse({
    channel: formData.get("channel"),
    integrationConnectionId: formData.get("integrationConnectionId") || undefined,
    contactId: formData.get("contactId") || undefined,
  });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await findOrCreateConversation(db, { organizationId: organization.id, actorUserId: user.userId, ...parsed.data });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/communications/inbox`);
  return { ok: true };
}

const updateConversationStatusSchema = z.object({ conversationId: uuidSchema, status: z.enum(COMMUNICATION_CONVERSATION_STATUSES), expectedRevision: z.coerce.number().int().min(1) });

export async function updateConversationStatusAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/communications/inbox`);
  const parsed = updateConversationStatusSchema.safeParse({ conversationId: formData.get("conversationId"), status: formData.get("status"), expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await updateConversationStatus(db, { organizationId: organization.id, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/communications/conversations/${parsed.data.conversationId}`);
  return { ok: true };
}

const assignConversationSchema = z.object({ conversationId: uuidSchema, assignedUserId: uuidSchema.nullable(), expectedRevision: z.coerce.number().int().min(1) });

export async function assignConversationAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/communications/inbox`);
  const rawAssigned = formData.get("assignedUserId");
  const parsed = assignConversationSchema.safeParse({ conversationId: formData.get("conversationId"), assignedUserId: rawAssigned ? rawAssigned : null, expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await assignConversation(db, { organizationId: organization.id, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/communications/conversations/${parsed.data.conversationId}`);
  return { ok: true };
}

const createDraftMessageSchema = z.object({
  conversationId: uuidSchema,
  channel: z.enum(COMMUNICATION_CHANNELS),
  recipientReference: z.string().trim().min(1).max(320),
  subject: z.string().trim().max(300).optional(),
  bodyText: z.string().trim().min(1).max(20000),
  idempotencyKey: z.string().trim().min(1).max(200),
});

export async function createDraftMessageAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/communications/inbox`);
  const parsed = createDraftMessageSchema.safeParse({
    conversationId: formData.get("conversationId"),
    channel: formData.get("channel"),
    recipientReference: formData.get("recipientReference"),
    subject: formData.get("subject") || undefined,
    bodyText: formData.get("bodyText"),
    idempotencyKey: formData.get("idempotencyKey") || `manual:${crypto.randomUUID()}`,
  });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await createDraftMessage(db, { organizationId: organization.id, actorUserId: user.userId, ...parsed.data });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/communications/conversations/${parsed.data.conversationId}`);
  return { ok: true };
}

const messageIdSchema = z.object({ messageId: uuidSchema });

export async function submitMessageForApprovalAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/communications/inbox`);
  const parsed = z.object({ messageId: uuidSchema, summary: z.string().trim().min(1).max(2000) }).safeParse({ messageId: formData.get("messageId"), summary: formData.get("summary") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await submitMessageForApproval(db, { organizationId: organization.id, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/communications/inbox`);
  return { ok: true };
}

export async function approveDraftDirectlyAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/communications/inbox`);
  const parsed = messageIdSchema.safeParse({ messageId: formData.get("messageId") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await approveDraftDirectly(db, { organizationId: organization.id, messageId: parsed.data.messageId, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/communications/inbox`);
  return { ok: true };
}

export async function decideMessageApprovalAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/communications/inbox`);
  const parsed = z.object({ messageId: uuidSchema, decision: z.enum(["approved", "rejected"]), decisionNote: z.string().trim().max(2000).optional() }).safeParse({ messageId: formData.get("messageId"), decision: formData.get("decision"), decisionNote: formData.get("decisionNote") || undefined });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await applyMessageApprovalDecision(db, { organizationId: organization.id, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/communications/inbox`);
  return { ok: true };
}

export async function revokeMessageApprovalAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/communications/inbox`);
  const parsed = z.object({ messageId: uuidSchema, reason: z.string().trim().min(1).max(500) }).safeParse({ messageId: formData.get("messageId"), reason: formData.get("reason") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await revokeMessageApproval(db, { organizationId: organization.id, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/communications/inbox`);
  return { ok: true };
}

export async function queueMessageForSendAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/communications/inbox`);
  const parsed = messageIdSchema.safeParse({ messageId: formData.get("messageId") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await queueMessageForSend(db, { organizationId: organization.id, messageId: parsed.data.messageId, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/communications/inbox`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Agent drafting
// ---------------------------------------------------------------------------

export async function launchDraftReplyAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/communications/inbox`);
  const parsed = z.object({ conversationId: uuidSchema }).safeParse({ conversationId: formData.get("conversationId") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await createDraftReplyTask(db, { organizationId: organization.id, conversationId: parsed.data.conversationId, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/communications/conversations/${parsed.data.conversationId}`);
  return { ok: true };
}

export async function launchDraftFollowUpAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/communications/inbox`);
  const parsed = z.object({ conversationId: uuidSchema, reason: z.string().trim().min(1).max(500) }).safeParse({ conversationId: formData.get("conversationId"), reason: formData.get("reason") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await createDraftFollowUpTask(db, { organizationId: organization.id, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/communications/conversations/${parsed.data.conversationId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const createTemplateSchema = z.object({
  channel: z.enum(COMMUNICATION_CHANNELS),
  name: z.string().trim().min(1).max(200),
  templateKey: z.string().trim().min(1).max(80),
  subjectTemplate: z.string().trim().max(300).optional(),
  bodyTemplate: z.string().trim().min(1).max(20000),
});

export async function createTemplateAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/communications/templates`);
  const parsed = createTemplateSchema.safeParse({
    channel: formData.get("channel"),
    name: formData.get("name"),
    templateKey: formData.get("templateKey"),
    subjectTemplate: formData.get("subjectTemplate") || undefined,
    bodyTemplate: formData.get("bodyTemplate"),
  });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await createTemplate(db, { organizationId: organization.id, actorUserId: user.userId, variableSchema: [], ...parsed.data });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/communications/templates`);
  return { ok: true };
}

export async function createTemplateVersionAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/communications/templates`);
  const parsed = z
    .object({ templateId: uuidSchema, subjectTemplate: z.string().trim().max(300).optional(), bodyTemplate: z.string().trim().min(1).max(20000) })
    .safeParse({ templateId: formData.get("templateId"), subjectTemplate: formData.get("subjectTemplate") || undefined, bodyTemplate: formData.get("bodyTemplate") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await createTemplateVersion(db, { organizationId: organization.id, actorUserId: user.userId, variableSchema: [], ...parsed.data });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/communications/templates/${parsed.data.templateId}`);
  return { ok: true };
}

export async function publishTemplateVersionAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/communications/templates`);
  const parsed = z.object({ templateId: uuidSchema, versionId: uuidSchema, expectedRevision: z.coerce.number().int().min(1) }).safeParse({ templateId: formData.get("templateId"), versionId: formData.get("versionId"), expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await publishTemplateVersion(db, { organizationId: organization.id, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/communications/templates/${parsed.data.templateId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Consent / suppression
// ---------------------------------------------------------------------------

const upsertConsentSchema = z.object({
  channel: z.enum(COMMUNICATION_CHANNELS),
  rawIdentity: z.string().trim().min(1).max(320),
  consentStatus: z.enum(COMMUNICATION_CONSENT_STATUSES),
  consentSource: z.enum(COMMUNICATION_CONSENT_SOURCES),
});

export async function upsertConsentAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/communications/consent`);
  const parsed = upsertConsentSchema.safeParse({
    channel: formData.get("channel"),
    rawIdentity: formData.get("rawIdentity"),
    consentStatus: formData.get("consentStatus"),
    consentSource: formData.get("consentSource"),
  });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await upsertConsent(db, { organizationId: organization.id, actorUserId: user.userId, ...parsed.data });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/communications/consent`);
  return { ok: true };
}

const suppressSchema = z.object({ channel: z.enum(COMMUNICATION_CHANNELS), rawIdentity: z.string().trim().min(1).max(320), suppressionReason: z.enum(COMMUNICATION_SUPPRESSION_REASONS) });

export async function suppressIdentityAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/communications/consent`);
  const parsed = suppressSchema.safeParse({ channel: formData.get("channel"), rawIdentity: formData.get("rawIdentity"), suppressionReason: formData.get("suppressionReason") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await suppressIdentity(db, { organizationId: organization.id, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/communications/consent`);
  return { ok: true };
}

export async function liftSuppressionAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/communications/consent`);
  const parsed = z.object({ suppressionId: uuidSchema }).safeParse({ suppressionId: formData.get("suppressionId") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await liftSuppression(db, { organizationId: organization.id, suppressionId: parsed.data.suppressionId, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/communications/consent`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Bulk batches
// ---------------------------------------------------------------------------

const createBulkBatchSchema = z.object({ name: z.string().trim().min(1).max(200), channel: z.enum(COMMUNICATION_CHANNELS), templateId: uuidSchema, campaignId: uuidSchema.optional(), audienceId: uuidSchema.optional() });

export async function createBulkBatchAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/communications/batches`);
  const parsed = createBulkBatchSchema.safeParse({
    name: formData.get("name"),
    channel: formData.get("channel"),
    templateId: formData.get("templateId"),
    campaignId: formData.get("campaignId") || undefined,
    audienceId: formData.get("audienceId") || undefined,
  });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await createBulkBatch(db, { organizationId: organization.id, actorUserId: user.userId, ...parsed.data });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/communications/batches`);
  return { ok: true };
}

export async function createBulkBatchFromContentAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/communications/batches`);
  const parsed = z.object({ contentItemId: uuidSchema }).safeParse({ contentItemId: formData.get("contentItemId") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await createBulkBatchFromApprovedContent(db, { organizationId: organization.id, contentItemId: parsed.data.contentItemId, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/communications/batches`);
  return { ok: true };
}

export async function snapshotBulkRecipientsAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/communications/batches`);
  const contactIdsRaw = formData.get("contactIds");
  const contactIds = typeof contactIdsRaw === "string" ? contactIdsRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const parsed = z.object({ batchId: uuidSchema, contactIds: z.array(uuidSchema).min(1) }).safeParse({ batchId: formData.get("batchId"), contactIds });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await snapshotBulkRecipients(db, { organizationId: organization.id, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/communications/batches/${parsed.data.batchId}`);
  return { ok: true };
}

export async function requestBulkApprovalAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/communications/batches`);
  const parsed = z.object({ batchId: uuidSchema, summary: z.string().trim().min(1).max(2000) }).safeParse({ batchId: formData.get("batchId"), summary: formData.get("summary") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await requestBulkApproval(db, { organizationId: organization.id, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/communications/batches/${parsed.data.batchId}`);
  return { ok: true };
}

export async function decideBulkApprovalAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/communications/batches`);
  const parsed = z.object({ batchId: uuidSchema, decision: z.enum(["approved", "rejected"]) }).safeParse({ batchId: formData.get("batchId"), decision: formData.get("decision") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await applyBulkApprovalDecision(db, { organizationId: organization.id, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/communications/batches/${parsed.data.batchId}`);
  return { ok: true };
}

export async function startBulkBatchAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/communications/batches`);
  const parsed = z.object({ batchId: uuidSchema, requireExplicitOptIn: z.coerce.boolean().optional() }).safeParse({ batchId: formData.get("batchId"), requireExplicitOptIn: formData.get("requireExplicitOptIn") === "on" });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await startBulkBatch(db, { organizationId: organization.id, batchId: parsed.data.batchId, requireExplicitOptIn: parsed.data.requireExplicitOptIn ?? false, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/communications/batches/${parsed.data.batchId}`);
  return { ok: true };
}

export async function cancelBulkBatchAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/communications/batches`);
  const parsed = z.object({ batchId: uuidSchema }).safeParse({ batchId: formData.get("batchId") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await cancelBulkBatch(db, { organizationId: organization.id, batchId: parsed.data.batchId, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/communications/batches`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

const grantRoleSchema = z.object({ userId: uuidSchema, role: z.enum(COMMUNICATION_ROLES) });

export async function grantCommunicationRoleAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/communications/settings`);
  const parsed = grantRoleSchema.safeParse({ userId: formData.get("userId"), role: formData.get("role") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await grantCommunicationRole(db, { organizationId: organization.id, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/communications/settings`);
  return { ok: true };
}

export async function revokeCommunicationRoleAction(organizationSlug: string, formData: FormData): Promise<ActionResult> {
  const { db, user, organization } = await context(organizationSlug, `/app/${organizationSlug}/communications/settings`);
  const parsed = z.object({ roleAssignmentId: uuidSchema, expectedRevision: z.coerce.number().int().min(1) }).safeParse({ roleAssignmentId: formData.get("roleAssignmentId"), expectedRevision: formData.get("expectedRevision") });
  if (!parsed.success) return toActionResult(parsed.error);
  try {
    await revokeCommunicationRole(db, { organizationId: organization.id, ...parsed.data, actorUserId: user.userId });
  } catch (err) {
    return toActionResult(err);
  }
  revalidatePath(`/app/${organizationSlug}/communications/settings`);
  return { ok: true };
}
