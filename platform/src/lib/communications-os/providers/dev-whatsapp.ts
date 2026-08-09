import { randomUUID } from "node:crypto";
import { normalizePhone } from "@/lib/crm/normalize";
import type { ProviderAdapter, SendMessageInput, SendMessageResult } from "./types";

const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

/** Development/log provider for WhatsApp — used until a real WhatsApp Cloud API credential is configured. See `dev-email.ts` for the "never falsely claim delivery" contract this mirrors exactly. */
export const devWhatsAppProvider: ProviderAdapter = {
  provider: "dev_whatsapp",
  channel: "whatsapp",
  capabilities: { supportsDeliveryEvents: false, supportsReadReceipts: false, supportsFetchStatus: false, maxRecipientsPerCall: 1 },

  async verifyConnection() {
    return { verified: true, externalAccountId: "dev-whatsapp-local", detail: "Development WhatsApp provider — no real account, always verifies." };
  },

  async sendMessage(_credential, input: SendMessageInput): Promise<SendMessageResult> {
    const providerMessageId = `dev-whatsapp-${randomUUID()}`;
    console.log(`[communications-os][dev-whatsapp] would send to=${input.recipientReference} idempotencyKey=${input.idempotencyKey} providerMessageId=${providerMessageId}`);
    return { outcome: "accepted", providerMessageId, failureClass: null, failureCode: null, rawStatusText: "dev-provider-accepted" };
  },

  normalizeInboundEvent() {
    return null;
  },
  normalizeDeliveryEvent() {
    return null;
  },

  validateRecipient(recipient: string) {
    const normalized = normalizePhone(recipient);
    if (!E164_PATTERN.test(normalized)) return { valid: false, normalizedRecipient: null, reason: "not a valid E.164 phone number" };
    return { valid: true, normalizedRecipient: normalized, reason: null };
  },

  mapProviderError() {
    return { failureClass: "unknown" as const, failureCode: "dev_provider_error" };
  },
};
