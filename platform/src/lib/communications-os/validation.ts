import { z } from "zod";

export const INTEGRATION_PROVIDERS = ["resend", "dev_email", "twilio", "dev_sms", "whatsapp_cloud_api", "dev_whatsapp"] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export const COMMUNICATION_CHANNELS = ["email", "sms", "whatsapp"] as const;
export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];

export const INTEGRATION_CONNECTION_STATUSES = ["pending", "connected", "verification_failed", "disabled", "disconnected"] as const;
export type IntegrationConnectionStatus = (typeof INTEGRATION_CONNECTION_STATUSES)[number];

export const COMMUNICATION_ROLES = ["communications_admin", "communications_manager", "communications_agent", "viewer"] as const;
export type CommunicationRole = (typeof COMMUNICATION_ROLES)[number];

export const COMMUNICATION_CAPABILITIES = [
  "communications_view",
  "communications_draft",
  "communications_send",
  "communications_manage_templates",
  "communications_manage_connections",
  "communications_manage_consent",
  "communications_manage_bulk",
  "communications_admin",
] as const;
export type CommunicationCapability = (typeof COMMUNICATION_CAPABILITIES)[number];

export const COMMUNICATION_CONVERSATION_STATUSES = ["open", "pending", "resolved", "archived"] as const;
export type CommunicationConversationStatus = (typeof COMMUNICATION_CONVERSATION_STATUSES)[number];

export const COMMUNICATION_DIRECTIONS = ["inbound", "outbound"] as const;
export type CommunicationDirection = (typeof COMMUNICATION_DIRECTIONS)[number];

export const COMMUNICATION_MESSAGE_STATUSES = ["draft", "pending_approval", "approved", "queued", "sending", "sent", "delivered", "failed", "received", "cancelled"] as const;
export type CommunicationMessageStatus = (typeof COMMUNICATION_MESSAGE_STATUSES)[number];

export const COMMUNICATION_FAILURE_CLASSES = [
  "invalid_recipient",
  "suppressed",
  "consent_required",
  "provider_rejected",
  "provider_timeout",
  "permanent_provider_error",
  "transient_provider_error",
  "approval_revoked",
  "connection_disabled",
  "unknown",
] as const;
export type CommunicationFailureClass = (typeof COMMUNICATION_FAILURE_CLASSES)[number];

export const COMMUNICATION_TEMPLATE_STATUSES = ["draft", "published", "archived"] as const;
export const COMMUNICATION_TEMPLATE_VERSION_STATUSES = ["draft", "published", "superseded"] as const;

export const COMMUNICATION_PROVIDER_EVENT_PROCESSING_STATUSES = ["pending", "processed", "failed", "ignored"] as const;

export const COMMUNICATION_DELIVERY_EVENT_TYPES = ["accepted", "sent", "delivered", "bounced", "failed", "rejected", "read"] as const;
export type CommunicationDeliveryEventType = (typeof COMMUNICATION_DELIVERY_EVENT_TYPES)[number];

export const COMMUNICATION_CONSENT_STATUSES = ["unknown", "opted_in", "opted_out", "suppressed"] as const;
export type CommunicationConsentStatus = (typeof COMMUNICATION_CONSENT_STATUSES)[number];

export const COMMUNICATION_CONSENT_SOURCES = ["explicit_form", "reply_stop", "reply_start", "manual_admin", "imported", "inferred_transactional"] as const;
export type CommunicationConsentSource = (typeof COMMUNICATION_CONSENT_SOURCES)[number];

export const COMMUNICATION_SUPPRESSION_REASONS = ["user_opt_out", "bounced_hard", "complaint", "manual", "compliance_hold"] as const;
export type CommunicationSuppressionReason = (typeof COMMUNICATION_SUPPRESSION_REASONS)[number];

export const COMMUNICATION_EXTERNAL_IDENTITY_TYPES = ["email", "phone"] as const;
export type CommunicationExternalIdentityType = (typeof COMMUNICATION_EXTERNAL_IDENTITY_TYPES)[number];

export const COMMUNICATION_BULK_BATCH_STATUSES = ["draft", "pending_approval", "approved", "queued", "in_progress", "paused", "completed", "cancelled", "failed"] as const;
export const COMMUNICATION_BULK_RECIPIENT_STATUSES = ["pending", "skipped_suppressed", "skipped_no_consent", "queued", "sent", "failed"] as const;

export const COMMUNICATION_APPROVAL_LINKED_ENTITY_TYPES = ["message", "bulk_batch"] as const;

// Bounded string schemas — mirror Sales/Marketing OS's own conventions.
export const displayNameSchema = z.string().trim().min(1).max(200);
export const templateKeySchema = z.string().trim().min(1).max(80).regex(/^[a-z0-9_-]+$/, "lowercase letters, numbers, underscore, hyphen only");
export const subjectSchema = z.string().trim().max(300).optional();
export const bodyTextSchema = z.string().trim().min(1).max(20000);
export const purposeSchema = z.string().trim().max(500).optional();

/** A declared variable name/type pair — template rendering only ever substitutes variables explicitly declared here, never arbitrary JS. */
export const templateVariableSchema = z.object({
  name: z.string().trim().min(1).max(60).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  description: z.string().trim().max(300).optional(),
  required: z.boolean().default(true),
});
export const templateVariableSchemaArray = z.array(templateVariableSchema).max(30);

export const idempotencyKeySchema = z.string().trim().min(1).max(200);

/**
 * A provider-native approved-template directive, validated at every write
 * so a malformed one is impossible to persist rather than discovered by
 * Meta at send time. WhatsApp template names are lowercase alphanumeric
 * plus underscore; parameters may not contain a newline or tab (Meta
 * rejects the whole message if they do).
 */
export const providerTemplateDirectiveSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .regex(/^[a-z0-9_]+$/, "template name must be lowercase letters, numbers and underscores"),
  languageCode: z
    .string()
    .trim()
    .min(2)
    .max(15)
    .regex(/^[a-zA-Z]{2,3}(_[A-Za-z]{2,4})?$/, "language code must look like \"en\" or \"en_US\""),
  bodyParameters: z
    .array(
      z
        .string()
        .min(1)
        .max(1024)
        .refine((value) => !/[\n\r\t]/.test(value), "template parameters must not contain a newline or tab")
    )
    .max(30),
});
export type ProviderTemplateDirectiveInput = z.infer<typeof providerTemplateDirectiveSchema>;
