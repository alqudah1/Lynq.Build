import { createHmac } from "node:crypto";
import { normalizeEmail } from "@/lib/crm/normalize";
import { timingSafeEqualStrings } from "../secrets";
import type { CommunicationDeliveryEventType } from "../validation";
import type { NormalizedDeliveryEvent, ProviderAdapter, SendMessageInput, SendMessageResult } from "./types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_API_BASE = "https://api.resend.com";

/**
 * Real Resend adapter — fully implemented so it can plug in the moment a
 * real `RESEND_API_KEY`/connected sender is configured. This environment
 * has no such credential, so `sendMessage` is never exercised for real by
 * this module's own tests; `dev_email` is the provider actually used in
 * every test and the manual E2E run (see `MODULE_16_INTEGRATION_ADAPTERS.md`
 * for the exact statement of what was and wasn't verified against a real
 * account).
 */
export const resendProvider: ProviderAdapter = {
  provider: "resend",
  channel: "email",
  capabilities: { supportsDeliveryEvents: true, supportsReadReceipts: true, supportsFetchStatus: false, maxRecipientsPerCall: 1 },

  async verifyConnection(credential) {
    const response = await fetch(`${RESEND_API_BASE}/api-keys`, {
      method: "GET",
      headers: { Authorization: `Bearer ${credential.secret}` },
    });
    if (!response.ok) {
      return { verified: false, externalAccountId: null, detail: `Resend returned HTTP ${response.status}` };
    }
    return { verified: true, externalAccountId: credential.externalAccountId, detail: null };
  },

  async sendMessage(credential, input: SendMessageInput): Promise<SendMessageResult> {
    try {
      const response = await fetch(`${RESEND_API_BASE}/emails`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credential.secret}`,
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
        },
        body: JSON.stringify({
          from: input.senderReference ?? "onboarding@resend.dev",
          to: [input.recipientReference],
          subject: input.subject ?? "(no subject)",
          text: input.bodyText,
        }),
      });

      const body = (await response.json().catch(() => null)) as { id?: string; message?: string; name?: string } | null;

      if (response.ok && body?.id) {
        return { outcome: "accepted", providerMessageId: body.id, failureClass: null, failureCode: null, rawStatusText: "resend-accepted" };
      }

      if (response.status >= 500 || response.status === 429) {
        return { outcome: "uncertain", providerMessageId: null, failureClass: "provider_timeout", failureCode: `http_${response.status}`, rawStatusText: body?.message ?? null };
      }

      return { outcome: "rejected", providerMessageId: null, failureClass: "provider_rejected", failureCode: body?.name ?? `http_${response.status}`, rawStatusText: body?.message ?? null };
    } catch {
      // Network-level failure — the provider's own outcome for this send is genuinely unknown, never assumed successful or failed.
      return { outcome: "uncertain", providerMessageId: null, failureClass: "provider_timeout", failureCode: "network_error", rawStatusText: null };
    }
  },

  normalizeInboundEvent() {
    // Resend is an outbound-sending ESP; it has no inbound-receiving webhook shape to normalize.
    return null;
  },

  normalizeDeliveryEvent(rawPayload: unknown): NormalizedDeliveryEvent | null {
    if (!rawPayload || typeof rawPayload !== "object") return null;
    const payload = rawPayload as { type?: string; created_at?: string; data?: { email_id?: string } };
    const eventType = mapResendEventType(payload.type);
    if (!eventType || !payload.data?.email_id || !payload.created_at) return null;
    return {
      externalEventId: `${payload.data.email_id}:${payload.type}`,
      providerMessageId: payload.data.email_id,
      eventType,
      occurredAt: new Date(payload.created_at),
      rawStatusText: payload.type ?? null,
    };
  },

  validateRecipient(recipient: string) {
    const trimmed = recipient.trim();
    if (!EMAIL_PATTERN.test(trimmed)) return { valid: false, normalizedRecipient: null, reason: "not a valid email address" };
    return { valid: true, normalizedRecipient: normalizeEmail(trimmed), reason: null };
  },

  mapProviderError(err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { failureClass: "unknown" as const, failureCode: message.slice(0, 100) };
  },
};

function mapResendEventType(type: string | undefined): CommunicationDeliveryEventType | null {
  switch (type) {
    case "email.sent":
      return "sent";
    case "email.delivered":
      return "delivered";
    case "email.bounced":
      return "bounced";
    case "email.complained":
      return "rejected";
    case "email.opened":
      return "read";
    default:
      // "email.delivery_delayed", "email.clicked", and any future event
      // type this adapter doesn't yet map — deliberately ignored rather
      // than guessed at.
      return null;
  }
}

/**
 * Resend signs webhooks in the Svix format: `v1,<base64 HMAC-SHA256>` in
 * the `svix-signature` header (space-separated if multiple signing
 * secrets are active), computed over `${svixId}.${svixTimestamp}.${body}`
 * using the webhook secret's payload after its `whsec_` prefix, base64-
 * decoded as the HMAC key.
 */
export function verifyResendWebhookSignature(input: { webhookSecret: string; svixId: string; svixTimestamp: string; rawBody: string; svixSignatureHeader: string }): boolean {
  const secretPayload = input.webhookSecret.startsWith("whsec_") ? input.webhookSecret.slice("whsec_".length) : input.webhookSecret;
  const key = Buffer.from(secretPayload, "base64");
  const signedContent = `${input.svixId}.${input.svixTimestamp}.${input.rawBody}`;
  const expectedSignature = createHmac("sha256", key).update(signedContent).digest("base64");

  const providedSignatures = input.svixSignatureHeader.split(" ").map((entry) => entry.split(",")[1]).filter(Boolean);
  return providedSignatures.some((sig) => timingSafeEqualStrings(sig, expectedSignature));
}
