import { randomUUID } from "node:crypto";
import { normalizeEmail } from "@/lib/crm/normalize";
import type { NormalizedInboundEvent, ProviderAdapter, SendMessageInput, SendMessageResult } from "./types";

/** Dev-only synthetic inbound payload shape — a real provider has its own webhook schema (see `resend.ts`); this stand-in exists purely so the inbound pipeline is exercisable end-to-end without a real vendor account. */
interface DevInboundPayload {
  externalEventId: string;
  senderReference: string;
  recipientReference: string;
  subject?: string | null;
  bodyText: string;
  externalThreadId?: string | null;
  receivedAt?: string;
}

function isDevInboundPayload(payload: unknown): payload is DevInboundPayload {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  return typeof p.externalEventId === "string" && typeof p.senderReference === "string" && typeof p.recipientReference === "string" && typeof p.bodyText === "string";
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Development/log provider — used whenever no real `RESEND_API_KEY` is
 * configured. Truthfully represents what actually happened: the message is
 * logged to the server console and marked "accepted" by this stand-in, but
 * `capabilities.supportsDeliveryEvents: false` means the canonical message
 * can advance to "sent" and no further — it is NEVER marked "delivered",
 * because no real delivery evidence exists. This is the deliberate
 * "do not falsely claim a real email was sent" contract from the spec.
 */
export const devEmailProvider: ProviderAdapter = {
  provider: "dev_email",
  channel: "email",
  capabilities: { supportsDeliveryEvents: false, supportsReadReceipts: false, supportsFetchStatus: false, maxRecipientsPerCall: 1 },

  async verifyConnection() {
    return { verified: true, externalAccountId: "dev-email-local", detail: "Development email provider — no real account, always verifies." };
  },

  async sendMessage(_credential, input: SendMessageInput): Promise<SendMessageResult> {
    const providerMessageId = `dev-email-${randomUUID()}`;
    console.log(`[communications-os][dev-email] would send to=${input.recipientReference} subject=${JSON.stringify(input.subject)} idempotencyKey=${input.idempotencyKey} providerMessageId=${providerMessageId}`);
    return { outcome: "accepted", providerMessageId, failureClass: null, failureCode: null, rawStatusText: "dev-provider-accepted" };
  },

  normalizeInboundEvent(rawPayload: unknown): NormalizedInboundEvent | null {
    if (!isDevInboundPayload(rawPayload)) return null;
    return {
      externalEventId: rawPayload.externalEventId,
      externalThreadId: rawPayload.externalThreadId ?? null,
      senderReference: normalizeEmail(rawPayload.senderReference),
      recipientReference: normalizeEmail(rawPayload.recipientReference),
      subject: rawPayload.subject ?? null,
      bodyText: rawPayload.bodyText,
      receivedAt: rawPayload.receivedAt ? new Date(rawPayload.receivedAt) : new Date(),
    };
  },
  normalizeDeliveryEvent() {
    return null;
  },

  validateRecipient(recipient: string) {
    const trimmed = recipient.trim();
    if (!EMAIL_PATTERN.test(trimmed)) return { valid: false, normalizedRecipient: null, reason: "not a valid email address" };
    return { valid: true, normalizedRecipient: normalizeEmail(trimmed), reason: null };
  },

  mapProviderError() {
    return { failureClass: "unknown" as const, failureCode: "dev_provider_error" };
  },
};
