import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { normalizePhone } from "@/lib/crm/normalize";
import type { CommunicationDeliveryEventType, CommunicationFailureClass } from "../validation";
import type {
  FetchStatusResult,
  NormalizedDeliveryEvent,
  NormalizedInboundEvent,
  ProviderAdapter,
  ProviderCredential,
  ProviderTemplateDirective,
  SendMessageInput,
  SendMessageResult,
  VerifyConnectionResult,
} from "./types";

export type { ProviderTemplateDirective };

/**
 * ============================================================================
 * Meta WhatsApp Cloud API adapter — the real one
 * ============================================================================
 * Implements the same bounded `ProviderAdapter` contract `resend.ts`
 * does. Nothing about the Cloud API's own response shapes escapes this
 * file; every method returns one of the closed shapes in `types.ts`.
 *
 * ## Where the credential lives
 * A Cloud API connection needs more than one opaque string: an access
 * token, the Phone Number ID it sends from, the WhatsApp Business Account
 * (WABA) it belongs to, the app secret webhooks are signed with, and the
 * verify token Meta echoes during webhook setup. Rather than add columns
 * (and therefore a second, unencrypted home for a signing secret), the
 * whole set is stored as a single JSON document in the EXISTING
 * `integration_credentials` AES-256-GCM ciphertext — see `secrets.ts`.
 * `parseWhatsAppCredential` is the only thing that reads it, and the
 * parsed object never leaves this module.
 *
 * ## What this adapter will and will not claim
 * `sendMessage` reports `accepted` only when Meta returned a real
 * `messages[0].id` (a `wamid.…`). Anything else is `rejected` (Meta
 * refused, nothing was created) or `uncertain` (the request may or may
 * not have reached Meta). It never invents a provider message ID, and
 * there is no fallback to the development provider.
 */

const DEFAULT_GRAPH_API_VERSION = "v23.0";
const GRAPH_API_BASE = "https://graph.facebook.com";
/** Meta gives no per-request idempotency key; a slow send must not be retried behind our back. */
const REQUEST_TIMEOUT_MS = 20_000;

const whatsAppCredentialSchema = z.object({
  /** System user or app access token with `whatsapp_business_messaging`. */
  accessToken: z.string().trim().min(20),
  /** The Cloud API Phone Number ID — NOT the phone number itself. */
  phoneNumberId: z.string().trim().regex(/^\d{5,25}$/, "phoneNumberId must be the numeric Cloud API Phone Number ID"),
  /** The WhatsApp Business Account ID that owns the phone number and the templates. */
  wabaId: z.string().trim().regex(/^\d{5,25}$/, "wabaId must be the numeric WhatsApp Business Account ID"),
  /** Meta app secret — used ONLY to verify `X-Hub-Signature-256` on inbound webhooks. */
  appSecret: z.string().trim().min(16).optional(),
  /** The token Meta echoes back during webhook subscription (`hub.verify_token`). */
  webhookVerifyToken: z.string().trim().min(8).optional(),
  /** Pinned Graph API version, e.g. "v23.0". */
  graphApiVersion: z
    .string()
    .trim()
    .regex(/^v\d+\.\d+$/)
    .default(DEFAULT_GRAPH_API_VERSION),
  /** The E.164 number this Phone Number ID sends from, for market/sender assertions. */
  senderPhoneE164: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,14}$/)
    .optional(),
});

export type WhatsAppCredential = z.infer<typeof whatsAppCredentialSchema>;

export class WhatsAppCredentialFormatError extends Error {
  constructor(detail: string) {
    // Deliberately carries the shape complaint only — never any part of the value itself.
    super(`WhatsApp Cloud API credential is not usable: ${detail}`);
    this.name = "WhatsAppCredentialFormatError";
  }
}

/** Parses the JSON credential document. Throws a message that never contains any secret material. */
export function parseWhatsAppCredential(secret: string): WhatsAppCredential {
  let raw: unknown;
  try {
    raw = JSON.parse(secret);
  } catch {
    throw new WhatsAppCredentialFormatError("stored credential is not valid JSON");
  }
  const parsed = whatsAppCredentialSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".") || "(root)").join(", ");
    throw new WhatsAppCredentialFormatError(`invalid or missing field(s): ${fields}`);
  }
  return parsed.data;
}

/** Builds the credential document to hand to `storeConnectionCredential`. Never logged, never returned to a browser. */
export function serializeWhatsAppCredential(input: WhatsAppCredential): string {
  return JSON.stringify(whatsAppCredentialSchema.parse(input));
}

function graphUrl(credential: WhatsAppCredential, path: string): string {
  return `${GRAPH_API_BASE}/${credential.graphApiVersion}/${path}`;
}

async function graphFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * ============================================================================
 * Error classification
 * ============================================================================
 * Meta's error codes split cleanly into three buckets, and conflating
 * them is what turns a two-minute rate limit into a permanently failed
 * campaign. `retryable` means Meta positively refused the request and
 * created nothing, so re-sending later is safe and cannot duplicate.
 * `permanent` means re-sending will fail identically forever.
 * Documented at developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes.
 */
const RETRYABLE_META_ERROR_CODES = new Set([
  4, // Application request limit reached
  80007, // Rate limit issues
  130429, // Cloud API message throughput reached
  131048, // Spam rate limit hit
  131056, // Pair rate limit hit
  133016, // Too many requests during registration
  1, // API unknown / transient platform error
  2, // API service temporarily unavailable
]);

const PERMANENT_META_ERROR_CODES = new Set([
  100, // Invalid parameter
  190, // Access token expired/invalid
  200, // Permission denied
  368, // Temporarily blocked for policy violations (needs a human, never a blind retry)
  131008, // Required parameter missing
  131009, // Parameter value not valid
  131021, // Recipient cannot be the sender
  131026, // Message undeliverable — recipient not on WhatsApp / cannot receive
  131031, // Account has been locked
  131047, // Re-engagement message required (outside the 24h window; needs a template, not a retry)
  131051, // Unsupported message type
  132000, // Template param count mismatch
  132001, // Template does not exist in this language
  132005, // Template hydrated text too long
  132007, // Template format character policy violated
  132012, // Template parameter format mismatch
  132015, // Template is paused
  132016, // Template is disabled
  133010, // Phone number not registered
]);

export interface MetaErrorShape {
  code: number | null;
  subcode: number | null;
  message: string | null;
  type: string | null;
}

export function extractMetaError(body: unknown): MetaErrorShape {
  const error = (body as { error?: { code?: unknown; error_subcode?: unknown; message?: unknown; type?: unknown } } | null)?.error;
  return {
    code: typeof error?.code === "number" ? error.code : null,
    subcode: typeof error?.error_subcode === "number" ? error.error_subcode : null,
    message: typeof error?.message === "string" ? error.message : null,
    type: typeof error?.type === "string" ? error.type : null,
  };
}

export type MetaFailureDisposition = "retryable" | "permanent" | "uncertain";

export function classifyMetaFailure(httpStatus: number, metaError: MetaErrorShape): { disposition: MetaFailureDisposition; failureClass: CommunicationFailureClass; failureCode: string } {
  const code = metaError.code;
  const failureCode = code !== null ? `meta_${code}${metaError.subcode !== null ? `_${metaError.subcode}` : ""}` : `http_${httpStatus}`;

  if (code !== null && PERMANENT_META_ERROR_CODES.has(code)) {
    const failureClass: CommunicationFailureClass =
      code === 131026 || code === 131021 || code === 133010
        ? "invalid_recipient"
        : code === 190 || code === 200 || code === 131031
          ? "connection_disabled"
          : "permanent_provider_error";
    return { disposition: "permanent", failureClass, failureCode };
  }

  if (code !== null && RETRYABLE_META_ERROR_CODES.has(code)) {
    return { disposition: "retryable", failureClass: "transient_provider_error", failureCode };
  }

  if (httpStatus === 429) return { disposition: "retryable", failureClass: "transient_provider_error", failureCode };
  // 5xx: Meta may or may not have created the message before failing — genuinely unknown, never retried blindly.
  if (httpStatus >= 500) return { disposition: "uncertain", failureClass: "provider_timeout", failureCode };
  // Any 4xx Meta code this adapter does not yet know: refuse permanently rather than
  // guess it is safe to retry. A wrong "retryable" here re-sends a rejected message forever.
  return { disposition: "permanent", failureClass: "provider_rejected", failureCode };
}

/**
 * ============================================================================
 * Recipient normalization
 * ============================================================================
 * Meta wants a bare international number with no `+`, no spaces and no
 * leading zeros or trunk prefixes. LYNQ stores E.164. The conversion is
 * one-directional and total: anything that is not already unambiguously
 * E.164 is rejected rather than "fixed", because a guessed country code
 * sends a real message to a real stranger.
 */
export function normalizeWhatsAppRecipient(recipient: string): { valid: boolean; e164: string | null; metaFormat: string | null; reason: string | null } {
  const normalized = normalizePhone(recipient);
  const withPlus = normalized.startsWith("+") ? normalized : `+${normalized}`;
  if (!/^\+[1-9]\d{7,14}$/.test(withPlus)) {
    return { valid: false, e164: null, metaFormat: null, reason: "not a valid E.164 phone number" };
  }
  return { valid: true, e164: withPlus, metaFormat: withPlus.slice(1), reason: null };
}

/**
 * ============================================================================
 * Webhook payload handling
 * ============================================================================
 * Meta batches: one POST can carry several `entry[]`, each with several
 * `changes[]`, each carrying several `messages[]` and `statuses[]`. The
 * Communications OS event pipeline is deliberately one-event-in /
 * one-normalized-record-out, and dedupes on `externalEventId`. So the
 * route splits a batched payload into single-fact envelopes FIRST
 * (`splitWhatsAppWebhookPayload`), and each envelope then flows through
 * the existing `processInboundProviderEvent` unchanged. Nothing is
 * dropped, and every individual message or status keeps its own stable,
 * replay-safe dedup key.
 */
export interface WhatsAppWebhookEnvelope {
  /** Stable across Meta's at-least-once redeliveries — this is what dedupe keys off. */
  externalEventId: string;
  eventType: string;
  /** A single-fact payload shaped exactly like a one-message/one-status Meta payload. */
  payload: unknown;
  /** The Phone Number ID the event was addressed to, so a route can confirm it matches the connection. */
  phoneNumberId: string | null;
}

interface MetaValue {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
  messages?: Array<Record<string, unknown>>;
  statuses?: Array<Record<string, unknown>>;
}

function readMetaValues(payload: unknown): MetaValue[] {
  const entries = (payload as { entry?: Array<{ changes?: Array<{ field?: string; value?: MetaValue }> }> } | null)?.entry;
  if (!Array.isArray(entries)) return [];
  const values: MetaValue[] = [];
  for (const entry of entries) {
    if (!Array.isArray(entry?.changes)) continue;
    for (const change of entry.changes) {
      // Only the `messages` field carries message and status facts; other
      // subscribed fields (template status updates, quality alerts) are
      // deliberately not treated as communications events here.
      if (change?.field !== "messages" || !change.value) continue;
      values.push(change.value);
    }
  }
  return values;
}

export function splitWhatsAppWebhookPayload(payload: unknown): WhatsAppWebhookEnvelope[] {
  const envelopes: WhatsAppWebhookEnvelope[] = [];

  for (const value of readMetaValues(payload)) {
    const phoneNumberId = typeof value.metadata?.phone_number_id === "string" ? value.metadata.phone_number_id : null;
    const metadata = value.metadata;
    const contacts = value.contacts;

    for (const message of value.messages ?? []) {
      const id = typeof message.id === "string" ? message.id : null;
      if (!id) continue;
      envelopes.push({
        externalEventId: `msg:${id}`,
        eventType: `whatsapp.message.${typeof message.type === "string" ? message.type : "unknown"}`,
        payload: { entry: [{ changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata, contacts, messages: [message] } }] }] },
        phoneNumberId,
      });
    }

    for (const status of value.statuses ?? []) {
      const id = typeof status.id === "string" ? status.id : null;
      const state = typeof status.status === "string" ? status.status : null;
      if (!id || !state) continue;
      envelopes.push({
        // A single message produces sent → delivered → read as three separate
        // facts; the status name is part of the key so they do not dedupe
        // each other away, while a redelivery of the same fact still does.
        externalEventId: `status:${id}:${state}`,
        eventType: `whatsapp.status.${state}`,
        payload: { entry: [{ changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata, statuses: [status] } }] }] },
        phoneNumberId,
      });
    }
  }

  return envelopes;
}

/** `X-Hub-Signature-256: sha256=<hex HMAC-SHA256(rawBody, appSecret)>`, compared in constant time. */
export function verifyWhatsAppWebhookSignature(input: { appSecret: string; rawBody: string; signatureHeader: string | null }): boolean {
  if (!input.signatureHeader) return false;
  const [algorithm, provided] = input.signatureHeader.split("=");
  if (algorithm !== "sha256" || !provided) return false;
  const expected = createHmac("sha256", input.appSecret).update(input.rawBody, "utf8").digest("hex");
  const providedBuffer = Buffer.from(provided, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

/** Meta's `GET` subscription handshake. Returns the challenge to echo, or null to reject with 403. */
export function resolveWebhookVerificationChallenge(input: { mode: string | null; verifyToken: string | null; challenge: string | null; expectedVerifyToken: string }): string | null {
  if (input.mode !== "subscribe" || !input.verifyToken || !input.challenge) return null;
  const provided = Buffer.from(input.verifyToken, "utf8");
  const expected = Buffer.from(input.expectedVerifyToken, "utf8");
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;
  return input.challenge;
}

const STATUS_TO_DELIVERY_EVENT: Record<string, CommunicationDeliveryEventType> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
};

function metaTimestampToDate(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value * 1000);
  if (typeof value === "string" && /^\d+$/.test(value)) return new Date(Number(value) * 1000);
  return null;
}

/** Extracts human-readable text from the message types worth ingesting; returns null for the rest rather than a misleading placeholder. */
function readInboundBodyText(message: Record<string, unknown>): string | null {
  const type = typeof message.type === "string" ? message.type : null;
  switch (type) {
    case "text":
      return typeof (message.text as { body?: unknown })?.body === "string" ? ((message.text as { body: string }).body) : null;
    case "button":
      return typeof (message.button as { text?: unknown })?.text === "string" ? ((message.button as { text: string }).text) : null;
    case "interactive": {
      const interactive = message.interactive as { button_reply?: { title?: unknown }; list_reply?: { title?: unknown } } | undefined;
      const title = interactive?.button_reply?.title ?? interactive?.list_reply?.title;
      return typeof title === "string" ? title : null;
    }
    case "reaction":
      return typeof (message.reaction as { emoji?: unknown })?.emoji === "string" ? ((message.reaction as { emoji: string }).emoji) : null;
    default:
      // Media, location, contacts, order, system messages: a real reply
      // arrived, and recording it with an honest marker beats silently
      // dropping a prospect's response.
      return type ? `[${type} message]` : null;
  }
}

export const whatsAppCloudApiProvider: ProviderAdapter = {
  provider: "whatsapp_cloud_api",
  channel: "whatsapp",
  capabilities: { supportsDeliveryEvents: true, supportsReadReceipts: true, supportsFetchStatus: false, maxRecipientsPerCall: 1 },

  async verifyConnection(credential: ProviderCredential): Promise<VerifyConnectionResult> {
    let parsed: WhatsAppCredential;
    try {
      parsed = parseWhatsAppCredential(credential.secret);
    } catch (err) {
      return { verified: false, externalAccountId: null, detail: err instanceof Error ? err.message : "credential unreadable" };
    }

    try {
      const response = await graphFetch(graphUrl(parsed, `${parsed.phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status`), {
        method: "GET",
        headers: { Authorization: `Bearer ${parsed.accessToken}` },
      });
      const body = (await response.json().catch(() => null)) as
        | { id?: string; display_phone_number?: string; verified_name?: string; quality_rating?: string; code_verification_status?: string }
        | null;

      if (!response.ok || !body?.id) {
        const metaError = extractMetaError(body);
        return { verified: false, externalAccountId: null, detail: metaError.message ?? `Meta returned HTTP ${response.status}` };
      }

      if (body.id !== parsed.phoneNumberId) {
        return { verified: false, externalAccountId: null, detail: "Meta returned a different Phone Number ID than the credential declares" };
      }

      // The WABA is checked too — a token that can read the phone number
      // but not its business account cannot manage or send templates, and
      // finding that out at the first campaign is far too late.
      const wabaResponse = await graphFetch(graphUrl(parsed, `${parsed.wabaId}?fields=id,name`), {
        method: "GET",
        headers: { Authorization: `Bearer ${parsed.accessToken}` },
      });
      if (!wabaResponse.ok) {
        const wabaBody = await wabaResponse.json().catch(() => null);
        const metaError = extractMetaError(wabaBody);
        return { verified: false, externalAccountId: null, detail: `Phone number reachable but WABA ${parsed.wabaId} is not: ${metaError.message ?? `HTTP ${wabaResponse.status}`}` };
      }

      const detail = [
        `display_phone_number=${body.display_phone_number ?? "unknown"}`,
        `verified_name=${body.verified_name ?? "unknown"}`,
        `quality_rating=${body.quality_rating ?? "unknown"}`,
        `code_verification_status=${body.code_verification_status ?? "unknown"}`,
      ].join(" ");

      return { verified: true, externalAccountId: body.id, detail };
    } catch (err) {
      return { verified: false, externalAccountId: null, detail: err instanceof Error ? `verification request failed: ${err.name}` : "verification request failed" };
    }
  },

  async sendMessage(credential: ProviderCredential, input: SendMessageInput): Promise<SendMessageResult> {
    let parsed: WhatsAppCredential;
    try {
      parsed = parseWhatsAppCredential(credential.secret);
    } catch (err) {
      return { outcome: "rejected", providerMessageId: null, failureClass: "connection_disabled", failureCode: "credential_unreadable", rawStatusText: err instanceof Error ? err.message : null };
    }

    const recipient = normalizeWhatsAppRecipient(input.recipientReference);
    if (!recipient.valid || !recipient.metaFormat) {
      return { outcome: "rejected", providerMessageId: null, failureClass: "invalid_recipient", failureCode: "not_e164", rawStatusText: recipient.reason };
    }

    const template = input.providerTemplate ?? null;
    const body = template
      ? {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: recipient.metaFormat,
          type: "template",
          template: {
            name: template.name,
            language: { code: template.languageCode },
            components: template.bodyParameters.length > 0 ? [{ type: "body", parameters: template.bodyParameters.map((text) => ({ type: "text", text })) }] : [],
          },
        }
      : {
          // Free-form text is only legal inside an open 24-hour customer
          // service window — i.e. replies. Every business-INITIATED LYNQ
          // message carries a template directive; a caller that omits one
          // for a cold contact will get Meta error 131047 back, which this
          // adapter classifies as permanent rather than retrying it.
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: recipient.metaFormat,
          type: "text",
          text: { preview_url: true, body: input.bodyText },
        };

    let response: Response;
    try {
      response = await graphFetch(graphUrl(parsed, `${parsed.phoneNumberId}/messages`), {
        method: "POST",
        headers: { Authorization: `Bearer ${parsed.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      // The request never completed. Meta may or may not have created the
      // message. Never assumed either way, and never re-sent automatically.
      return { outcome: "uncertain", providerMessageId: null, failureClass: "provider_timeout", failureCode: "network_error", rawStatusText: null };
    }

    const responseBody = (await response.json().catch(() => null)) as { messages?: Array<{ id?: string; message_status?: string }> } | null;

    if (response.ok) {
      const providerMessageId = responseBody?.messages?.[0]?.id;
      if (typeof providerMessageId === "string" && providerMessageId.length > 0) {
        return { outcome: "accepted", providerMessageId, failureClass: null, failureCode: null, rawStatusText: responseBody?.messages?.[0]?.message_status ?? "accepted" };
      }
      // 200 with no wamid should not happen. It is NOT treated as a send.
      return { outcome: "uncertain", providerMessageId: null, failureClass: "provider_timeout", failureCode: "missing_provider_message_id", rawStatusText: "Meta returned 200 without a message id" };
    }

    const metaError = extractMetaError(responseBody);
    const classified = classifyMetaFailure(response.status, metaError);
    return {
      outcome: classified.disposition === "uncertain" ? "uncertain" : "rejected",
      providerMessageId: null,
      failureClass: classified.failureClass,
      failureCode: classified.failureCode,
      rawStatusText: metaError.message,
    };
  },

  normalizeInboundEvent(rawPayload: unknown): NormalizedInboundEvent | null {
    const [value] = readMetaValues(rawPayload);
    const message = value?.messages?.[0];
    if (!value || !message) return null;

    const id = typeof message.id === "string" ? message.id : null;
    const from = typeof message.from === "string" ? message.from : null;
    const receivedAt = metaTimestampToDate(message.timestamp);
    const bodyText = readInboundBodyText(message);
    if (!id || !from || !receivedAt || bodyText === null) return null;

    const recipient = value.metadata?.display_phone_number ?? value.metadata?.phone_number_id ?? "";

    return {
      externalEventId: `msg:${id}`,
      // WhatsApp has one thread per (business number, customer number)
      // pair, so the customer's wa_id IS the thread identity. This is
      // what makes a reply land on the same conversation the outbound
      // template created, rather than opening a second one.
      externalThreadId: `wa:${from}`,
      senderReference: `+${from.replace(/\D/g, "")}`,
      recipientReference: recipient.startsWith("+") ? recipient : `+${recipient.replace(/\D/g, "")}`,
      subject: null,
      bodyText,
      receivedAt,
    };
  },

  normalizeDeliveryEvent(rawPayload: unknown): NormalizedDeliveryEvent | null {
    const [value] = readMetaValues(rawPayload);
    const status = value?.statuses?.[0];
    if (!value || !status) return null;

    const id = typeof status.id === "string" ? status.id : null;
    const state = typeof status.status === "string" ? status.status : null;
    const occurredAt = metaTimestampToDate(status.timestamp);
    if (!id || !state || !occurredAt) return null;

    const eventType = STATUS_TO_DELIVERY_EVENT[state];
    if (!eventType) return null; // e.g. "deleted", or a future status this adapter has not been taught.

    const errors = Array.isArray(status.errors) ? (status.errors as Array<{ code?: unknown; title?: unknown; message?: unknown }>) : [];
    const firstError = errors[0];
    const rawStatusText = firstError
      ? `${state}: ${typeof firstError.code === "number" ? `meta_${firstError.code} ` : ""}${typeof firstError.title === "string" ? firstError.title : typeof firstError.message === "string" ? firstError.message : ""}`.trim()
      : state;

    return { externalEventId: `status:${id}:${state}`, providerMessageId: id, eventType, occurredAt, rawStatusText };
  },

  validateRecipient(recipient: string) {
    const result = normalizeWhatsAppRecipient(recipient);
    return { valid: result.valid, normalizedRecipient: result.e164, reason: result.reason };
  },

  mapProviderError(err: unknown) {
    if (err instanceof WhatsAppCredentialFormatError) {
      return { failureClass: "connection_disabled" as const, failureCode: "credential_unreadable" };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { failureClass: "unknown" as const, failureCode: message.slice(0, 100) };
  },
};

/** Exported for the reconciliation path; the Cloud API has no per-message status GET, so this is deliberately absent from the adapter object. */
export const WHATSAPP_FETCH_STATUS_UNSUPPORTED: FetchStatusResult = { found: false, eventType: null, occurredAt: null, rawStatusText: "WhatsApp Cloud API has no per-message status read; status arrives by webhook only." };
