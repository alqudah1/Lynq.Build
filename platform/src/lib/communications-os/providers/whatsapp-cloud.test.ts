import { createHmac } from "node:crypto";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  WhatsAppCredentialFormatError,
  classifyMetaFailure,
  extractMetaError,
  normalizeWhatsAppRecipient,
  parseWhatsAppCredential,
  resolveWebhookVerificationChallenge,
  serializeWhatsAppCredential,
  splitWhatsAppWebhookPayload,
  verifyWhatsAppWebhookSignature,
  whatsAppCloudApiProvider,
} from "./whatsapp-cloud";

const CREDENTIAL = serializeWhatsAppCredential({
  accessToken: "EAAG-not-a-real-token-000000000000",
  phoneNumberId: "123456789012345",
  wabaId: "987654321098765",
  appSecret: "0123456789abcdef0123456789abcdef",
  webhookVerifyToken: "verify-token-value",
  graphApiVersion: "v23.0",
  senderPhoneE164: "+962796940024",
});

const TEMPLATE = { name: "lynq_demo_direction_reviews_en", languageCode: "en", bodyParameters: ["Beit Sitti", "https://app.lynq.build/demo/abc", "25 JOD"] };

function sendInput(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: "org",
    connectionId: "conn",
    recipientReference: "+962 79 123 4567",
    senderReference: "+962796940024",
    subject: null,
    bodyText: "rendered body",
    idempotencyKey: "bulk:1:2",
    providerTemplate: TEMPLATE,
    ...overrides,
  } as Parameters<typeof whatsAppCloudApiProvider.sendMessage>[1];
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("credential handling", () => {
  it("round-trips a valid credential document", () => {
    const parsed = parseWhatsAppCredential(CREDENTIAL);
    expect(parsed.phoneNumberId).toBe("123456789012345");
    expect(parsed.wabaId).toBe("987654321098765");
    expect(parsed.graphApiVersion).toBe("v23.0");
  });

  it("rejects a malformed credential without echoing any of it", () => {
    expect(() => parseWhatsAppCredential("not json")).toThrow(WhatsAppCredentialFormatError);
    try {
      parseWhatsAppCredential(JSON.stringify({ accessToken: "super-secret-value-aaaaaaaaaaaaa", phoneNumberId: "not-numeric", wabaId: "1" }));
      throw new Error("expected a throw");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain("phoneNumberId");
      // The error must never carry the secret it was parsing.
      expect(message).not.toContain("super-secret-value");
    }
  });
});

describe("recipient normalization", () => {
  it("normalizes a formatted number to E.164 and to Meta's digits-only form", () => {
    const result = normalizeWhatsAppRecipient("+962 79 694 0024");
    expect(result.valid).toBe(true);
    expect(result.e164).toBe("+962796940024");
    expect(result.metaFormat).toBe("962796940024");
  });

  it("accepts a number written without the plus", () => {
    expect(normalizeWhatsAppRecipient("16478927346").e164).toBe("+16478927346");
  });

  it("rejects anything it cannot read as unambiguously international", () => {
    // Never guess a country code: a guess sends a real message to a stranger.
    for (const value of ["0796940024", "", "12345", "not a phone"]) {
      expect(normalizeWhatsAppRecipient(value).valid).toBe(false);
    }
  });

  it("exposes the same rule through the adapter's validateRecipient", () => {
    expect(whatsAppCloudApiProvider.validateRecipient("+962796940024")).toEqual({ valid: true, normalizedRecipient: "+962796940024", reason: null });
    expect(whatsAppCloudApiProvider.validateRecipient("0796940024").valid).toBe(false);
  });
});

describe("sendMessage", () => {
  it("sends an approved template with its parameters and returns the provider message id", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { messages: [{ id: "wamid.HBgLOTYy", message_status: "accepted" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await whatsAppCloudApiProvider.sendMessage({ secret: CREDENTIAL, externalAccountId: "123456789012345" }, sendInput());

    expect(result.outcome).toBe("accepted");
    expect(result.providerMessageId).toBe("wamid.HBgLOTYy");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v23.0/123456789012345/messages");
    const body = JSON.parse(init.body as string);
    expect(body.type).toBe("template");
    expect(body.to).toBe("962791234567");
    expect(body.template.name).toBe("lynq_demo_direction_reviews_en");
    expect(body.template.language).toEqual({ code: "en" });
    expect(body.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual(["Beit Sitti", "https://app.lynq.build/demo/abc", "25 JOD"]);
    // The access token travels in the header, never in the URL or the body.
    expect(url).not.toContain("EAAG");
    expect(init.body).not.toContain("EAAG");
  });

  it("sends free text only when no template directive is supplied", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { messages: [{ id: "wamid.X" }] }));
    vi.stubGlobal("fetch", fetchMock);

    await whatsAppCloudApiProvider.sendMessage({ secret: CREDENTIAL, externalAccountId: null }, sendInput({ providerTemplate: null }));

    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.type).toBe("text");
    expect(body.text.body).toBe("rendered body");
  });

  it("never reports a send without a real provider message id", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { messages: [] })));
    const result = await whatsAppCloudApiProvider.sendMessage({ secret: CREDENTIAL, externalAccountId: null }, sendInput());
    // A 200 with no wamid is genuinely unknown — it is not a send.
    expect(result.outcome).toBe("uncertain");
    expect(result.providerMessageId).toBeNull();
    expect(result.failureCode).toBe("missing_provider_message_id");
  });

  it("rejects before calling Meta when the recipient is not E.164", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await whatsAppCloudApiProvider.sendMessage({ secret: CREDENTIAL, externalAccountId: null }, sendInput({ recipientReference: "0796940024" }));
    expect(result.outcome).toBe("rejected");
    expect(result.failureClass).toBe("invalid_recipient");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an unusable credential as a connection problem, not a send failure", async () => {
    const result = await whatsAppCloudApiProvider.sendMessage({ secret: "{}", externalAccountId: null }, sendInput());
    expect(result.outcome).toBe("rejected");
    expect(result.failureClass).toBe("connection_disabled");
    expect(result.failureCode).toBe("credential_unreadable");
  });

  it("treats a network failure as uncertain rather than failed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("socket hang up"); }));
    const result = await whatsAppCloudApiProvider.sendMessage({ secret: CREDENTIAL, externalAccountId: null }, sendInput());
    expect(result.outcome).toBe("uncertain");
    expect(result.failureClass).toBe("provider_timeout");
    expect(result.providerMessageId).toBeNull();
  });

  it("classifies a rate limit as retryable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(400, { error: { code: 130429, message: "Rate limit hit", type: "OAuthException" } })));
    const result = await whatsAppCloudApiProvider.sendMessage({ secret: CREDENTIAL, externalAccountId: null }, sendInput());
    expect(result.outcome).toBe("rejected");
    expect(result.failureClass).toBe("transient_provider_error");
    expect(result.failureCode).toBe("meta_130429");
  });

  it("classifies an unreachable recipient as permanently invalid", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(400, { error: { code: 131026, message: "Message undeliverable" } })));
    const result = await whatsAppCloudApiProvider.sendMessage({ secret: CREDENTIAL, externalAccountId: null }, sendInput());
    expect(result.failureClass).toBe("invalid_recipient");
  });
});

describe("error classification", () => {
  it.each([
    [4, "retryable"],
    [80007, "retryable"],
    [131048, "retryable"],
  ])("treats Meta code %i as retryable", (code, disposition) => {
    expect(classifyMetaFailure(400, { code, subcode: null, message: null, type: null }).disposition).toBe(disposition);
  });

  it.each([
    [132000, "permanent_provider_error"],
    [132015, "permanent_provider_error"],
    [131047, "permanent_provider_error"],
    [190, "connection_disabled"],
    [131026, "invalid_recipient"],
  ])("treats Meta code %i as permanent", (code, failureClass) => {
    const result = classifyMetaFailure(400, { code, subcode: null, message: null, type: null });
    expect(result.disposition).toBe("permanent");
    expect(result.failureClass).toBe(failureClass);
  });

  it("treats a bare HTTP 429 as retryable and a 5xx as uncertain", () => {
    expect(classifyMetaFailure(429, { code: null, subcode: null, message: null, type: null }).disposition).toBe("retryable");
    expect(classifyMetaFailure(503, { code: null, subcode: null, message: null, type: null }).disposition).toBe("uncertain");
  });

  it("refuses to guess that an unknown 4xx code is safe to retry", () => {
    // Wrongly calling an unknown rejection retryable re-sends it forever.
    expect(classifyMetaFailure(400, { code: 999999, subcode: null, message: null, type: null }).disposition).toBe("permanent");
  });

  it("reads Meta's error envelope without trusting its shape", () => {
    expect(extractMetaError({ error: { code: 131026, error_subcode: 2, message: "m", type: "t" } })).toEqual({ code: 131026, subcode: 2, message: "m", type: "t" });
    expect(extractMetaError(null)).toEqual({ code: null, subcode: null, message: null, type: null });
    expect(extractMetaError({ error: "boom" })).toEqual({ code: null, subcode: null, message: null, type: null });
  });
});

describe("verifyConnection", () => {
  it("verifies a reachable phone number and WABA", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/123456789012345?")
          ? jsonResponse(200, { id: "123456789012345", display_phone_number: "+962 79 694 0024", verified_name: "LYNQ", quality_rating: "GREEN", code_verification_status: "VERIFIED" })
          : jsonResponse(200, { id: "987654321098765", name: "LYNQ" })
      )
    );

    const result = await whatsAppCloudApiProvider.verifyConnection({ secret: CREDENTIAL, externalAccountId: null });
    expect(result.verified).toBe(true);
    expect(result.externalAccountId).toBe("123456789012345");
    expect(result.detail).toContain("quality_rating=GREEN");
  });

  it("does not verify when the token cannot read the WABA", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/123456789012345?")
          ? jsonResponse(200, { id: "123456789012345" })
          : jsonResponse(403, { error: { code: 200, message: "Permission denied" } })
      )
    );
    const result = await whatsAppCloudApiProvider.verifyConnection({ secret: CREDENTIAL, externalAccountId: null });
    expect(result.verified).toBe(false);
    expect(result.detail).toContain("WABA");
  });

  it("does not verify when Meta returns a different phone number id", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { id: "999999999999999" })));
    const result = await whatsAppCloudApiProvider.verifyConnection({ secret: CREDENTIAL, externalAccountId: null });
    expect(result.verified).toBe(false);
  });

  it("does not verify an unreadable credential and makes no network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await whatsAppCloudApiProvider.verifyConnection({ secret: "nonsense", externalAccountId: null });
    expect(result.verified).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("webhook authentication", () => {
  const appSecret = "0123456789abcdef0123456789abcdef";
  const rawBody = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
  const signature = `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;

  it("accepts a correctly signed payload", () => {
    expect(verifyWhatsAppWebhookSignature({ appSecret, rawBody, signatureHeader: signature })).toBe(true);
  });

  it("rejects a tampered payload, a wrong secret, a missing header and a wrong algorithm", () => {
    expect(verifyWhatsAppWebhookSignature({ appSecret, rawBody: rawBody + " ", signatureHeader: signature })).toBe(false);
    expect(verifyWhatsAppWebhookSignature({ appSecret: "f".repeat(32), rawBody, signatureHeader: signature })).toBe(false);
    expect(verifyWhatsAppWebhookSignature({ appSecret, rawBody, signatureHeader: null })).toBe(false);
    expect(verifyWhatsAppWebhookSignature({ appSecret, rawBody, signatureHeader: signature.replace("sha256", "sha1") })).toBe(false);
    expect(verifyWhatsAppWebhookSignature({ appSecret, rawBody, signatureHeader: "sha256=abcd" })).toBe(false);
  });

  it("echoes the challenge only for a matching verify token", () => {
    expect(resolveWebhookVerificationChallenge({ mode: "subscribe", verifyToken: "tok", challenge: "1234", expectedVerifyToken: "tok" })).toBe("1234");
    expect(resolveWebhookVerificationChallenge({ mode: "subscribe", verifyToken: "nope", challenge: "1234", expectedVerifyToken: "tok" })).toBeNull();
    expect(resolveWebhookVerificationChallenge({ mode: "unsubscribe", verifyToken: "tok", challenge: "1234", expectedVerifyToken: "tok" })).toBeNull();
    expect(resolveWebhookVerificationChallenge({ mode: "subscribe", verifyToken: "tok", challenge: null, expectedVerifyToken: "tok" })).toBeNull();
  });
});

describe("webhook payload handling", () => {
  const batched = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "987654321098765",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "962796940024", phone_number_id: "123456789012345" },
              statuses: [
                { id: "wamid.A", status: "sent", timestamp: "1750000000", recipient_id: "962791234567" },
                { id: "wamid.A", status: "delivered", timestamp: "1750000060", recipient_id: "962791234567" },
              ],
            },
          },
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "962796940024", phone_number_id: "123456789012345" },
              contacts: [{ wa_id: "962791234567", profile: { name: "Sami" } }],
              messages: [{ id: "wamid.B", from: "962791234567", timestamp: "1750000120", type: "text", text: { body: "Looks great" } }],
            },
          },
          { field: "message_template_status_update", value: { event: "APPROVED" } },
        ],
      },
    ],
  };

  it("splits one batched delivery into a separate envelope per fact", () => {
    const envelopes = splitWhatsAppWebhookPayload(batched);
    // Three facts: two statuses and one message. Handling only the first
    // would silently drop the prospect's reply.
    expect(envelopes.map((e) => e.externalEventId).sort()).toEqual(["msg:wamid.B", "status:wamid.A:delivered", "status:wamid.A:sent"]);
    expect(envelopes.every((e) => e.phoneNumberId === "123456789012345")).toBe(true);
  });

  it("gives the same message a stable dedup key across redeliveries", () => {
    const first = splitWhatsAppWebhookPayload(batched).map((e) => e.externalEventId);
    const second = splitWhatsAppWebhookPayload(JSON.parse(JSON.stringify(batched))).map((e) => e.externalEventId);
    expect(first).toEqual(second);
  });

  it("ignores subscribed fields that are not message facts", () => {
    const envelopes = splitWhatsAppWebhookPayload({ entry: [{ changes: [{ field: "message_template_status_update", value: { event: "APPROVED" } }] }] });
    expect(envelopes).toEqual([]);
  });

  it("normalizes an inbound reply onto the customer's own thread", () => {
    const envelope = splitWhatsAppWebhookPayload(batched).find((e) => e.externalEventId === "msg:wamid.B")!;
    const inbound = whatsAppCloudApiProvider.normalizeInboundEvent(envelope.payload);
    expect(inbound).toMatchObject({
      externalEventId: "msg:wamid.B",
      externalThreadId: "wa:962791234567",
      senderReference: "+962791234567",
      bodyText: "Looks great",
    });
    expect(inbound?.receivedAt.toISOString()).toBe(new Date(1750000120 * 1000).toISOString());
  });

  it("records a non-text reply rather than dropping it", () => {
    const payload = { entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "1" }, messages: [{ id: "wamid.C", from: "962791234567", timestamp: "1750000200", type: "image", image: { id: "x" } }] } }] }] };
    expect(whatsAppCloudApiProvider.normalizeInboundEvent(payload)?.bodyText).toBe("[image message]");
  });

  it("normalizes sent, delivered, read and failed statuses", () => {
    for (const [status, expected] of [["sent", "sent"], ["delivered", "delivered"], ["read", "read"], ["failed", "failed"]] as const) {
      const payload = { entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "1" }, statuses: [{ id: "wamid.D", status, timestamp: "1750000300" }] } }] }] };
      const event = whatsAppCloudApiProvider.normalizeDeliveryEvent(payload);
      expect(event?.eventType).toBe(expected);
      expect(event?.providerMessageId).toBe("wamid.D");
    }
  });

  it("carries the Meta error into a failed status's raw text", () => {
    const payload = { entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "1" }, statuses: [{ id: "wamid.E", status: "failed", timestamp: "1750000400", errors: [{ code: 131026, title: "Message undeliverable" }] }] } }] }] };
    expect(whatsAppCloudApiProvider.normalizeDeliveryEvent(payload)?.rawStatusText).toContain("meta_131026");
  });

  it("ignores a status it has not been taught rather than guessing", () => {
    const payload = { entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "1" }, statuses: [{ id: "wamid.F", status: "deleted", timestamp: "1750000500" }] } }] }] };
    expect(whatsAppCloudApiProvider.normalizeDeliveryEvent(payload)).toBeNull();
  });

  it("returns null for a payload that is neither a message nor a status", () => {
    expect(whatsAppCloudApiProvider.normalizeInboundEvent({})).toBeNull();
    expect(whatsAppCloudApiProvider.normalizeDeliveryEvent({})).toBeNull();
    expect(whatsAppCloudApiProvider.normalizeInboundEvent(null)).toBeNull();
  });
});
