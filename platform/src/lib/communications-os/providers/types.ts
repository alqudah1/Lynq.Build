import type { CommunicationChannel, CommunicationDeliveryEventType, CommunicationFailureClass, IntegrationProvider } from "../validation";

/**
 * ============================================================================
 * Provider adapter contract — Module 16
 * ============================================================================
 * A strict, bounded interface every provider (real or development) must
 * implement. No arbitrary provider SDK response object ever leaks past
 * `execute`/`normalize*` into domain logic — every method returns one of
 * the closed shapes below. Mirrors the discipline Module 14's
 * `AgentTaskHandler` contract already established for agent task types:
 * a fixed, in-code, typed interface, never a data-driven or free-text
 * dispatch.
 */

export interface ProviderCapabilities {
  supportsDeliveryEvents: boolean;
  supportsReadReceipts: boolean;
  supportsFetchStatus: boolean;
  maxRecipientsPerCall: number;
}

export interface ProviderCredential {
  /** Decrypted at the moment of use only — never logged, never placed in an audit event, never returned from an adapter method. */
  secret: string;
  externalAccountId: string | null;
}

/**
 * A provider-native approved-template directive. WhatsApp business-initiated
 * messages MUST be an approved template, not free text — the rendered
 * `bodyText` on the message row is what a human reviews and what LYNQ
 * stores, while THIS is what the provider is actually asked to send. The
 * two are kept identical by construction (see `lib/lead-gen/outreach.ts`).
 * Providers with no template concept ignore it.
 */
export interface ProviderTemplateDirective {
  name: string;
  /** BCP-47 tag the provider expects, e.g. "en". */
  languageCode: string;
  /** Positional body parameters in `{{1}}`…`{{n}}` order. */
  bodyParameters: string[];
}

export interface SendMessageInput {
  organizationId: string;
  connectionId: string;
  recipientReference: string;
  senderReference: string | null;
  subject: string | null;
  bodyText: string;
  idempotencyKey: string;
  providerTemplate?: ProviderTemplateDirective | null;
}

export interface SendMessageResult {
  outcome: "accepted" | "rejected" | "uncertain";
  providerMessageId: string | null;
  failureClass: CommunicationFailureClass | null;
  failureCode: string | null;
  rawStatusText: string | null;
}

export interface VerifyConnectionResult {
  verified: boolean;
  externalAccountId: string | null;
  detail: string | null;
}

export interface FetchStatusResult {
  found: boolean;
  eventType: CommunicationDeliveryEventType | null;
  occurredAt: Date | null;
  rawStatusText: string | null;
}

/** The bounded, canonical shape every inbound webhook payload is normalized into — never the raw provider object. */
export interface NormalizedInboundEvent {
  externalEventId: string;
  externalThreadId: string | null;
  senderReference: string;
  recipientReference: string;
  subject: string | null;
  bodyText: string;
  receivedAt: Date;
}

/** The bounded, canonical shape a delivery/status webhook payload is normalized into. */
export interface NormalizedDeliveryEvent {
  externalEventId: string;
  providerMessageId: string;
  eventType: CommunicationDeliveryEventType;
  occurredAt: Date;
  rawStatusText: string | null;
}

export interface RecipientValidationResult {
  valid: boolean;
  normalizedRecipient: string | null;
  reason: string | null;
}

export interface ProviderAdapter {
  provider: IntegrationProvider;
  channel: CommunicationChannel;
  capabilities: ProviderCapabilities;

  verifyConnection(credential: ProviderCredential): Promise<VerifyConnectionResult>;
  sendMessage(credential: ProviderCredential, input: SendMessageInput): Promise<SendMessageResult>;
  fetchStatus?(credential: ProviderCredential, providerMessageId: string): Promise<FetchStatusResult>;
  normalizeInboundEvent(rawPayload: unknown): NormalizedInboundEvent | null;
  normalizeDeliveryEvent(rawPayload: unknown): NormalizedDeliveryEvent | null;
  validateRecipient(recipient: string): RecipientValidationResult;
  mapProviderError(err: unknown): { failureClass: CommunicationFailureClass; failureCode: string };
}
