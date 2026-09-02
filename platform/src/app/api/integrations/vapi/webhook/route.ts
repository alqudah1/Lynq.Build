import "server-only";

import { timingSafeEqualStrings } from "@/lib/communications-os/secrets";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { resolveJarvisPhoneCommandConfig } from "@/lib/voice/phone-config";
import { normalizeVapiEvent, type VapiServerMessageEnvelope } from "@/lib/voice/vapi-events";
import { handleInboundConversationEvent } from "@/lib/voice/inbound-conversation";
import { claimWebhookEvent, PhoneCommandActorUnavailableError, recordWebhookEventOutcome } from "@/lib/voice/call-store";
import { redactLogFields } from "@/lib/voice/redaction";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_WEBHOOK_BYTES = 1_000_000;

/**
 * Phase-one notification events. These were logged before phone control
 * existed and are still logged identically now, whether or not
 * `JARVIS_PHONE_COMMANDS_ENABLED` is true — the existing two-minute outbound
 * founder notification mode keeps working untouched.
 */
const NOTIFICATION_EVENT_TYPES = new Set(["status-update", "end-of-call-report", "hang"]);

function unauthorized() {
  return Response.json({ error: { code: "unauthorized", message: "Unauthorized" } }, { status: 401 });
}

/**
 * Vapi server webhook.
 *
 * Two lanes share this endpoint:
 *
 * - **Outbound founder notifications** (pre-existing, unchanged): status and
 *   end-of-call events are logged with no phone number and no transcript.
 * - **Inbound secure phone control** (new, off by default): when
 *   `JARVIS_PHONE_COMMANDS_ENABLED=true` AND the rest of the phone
 *   configuration is present and valid, inbound events additionally drive the
 *   stateful conversation in `@/lib/voice/inbound-conversation`.
 *
 * Every request is authenticated with a constant-time bearer comparison
 * BEFORE the body is read, so a forged event never reaches parsing, a database
 * connection, or the event store. Every accepted event is then claimed exactly
 * once against a unique index, so a provider retry cannot create a second
 * project, command, or transcript turn.
 */
export async function POST(request: Request) {
  const configuredSecret = process.env.VAPI_WEBHOOK_SECRET;
  const providedSecret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!configuredSecret || !providedSecret || !timingSafeEqualStrings(providedSecret, configuredSecret)) return unauthorized();

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
    return Response.json({ error: { code: "payload_too_large", message: "Payload too large" } }, { status: 413 });
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES) {
    return Response.json({ error: { code: "payload_too_large", message: "Payload too large" } }, { status: 413 });
  }

  let payload: VapiServerMessageEnvelope;
  try {
    payload = JSON.parse(rawBody) as VapiServerMessageEnvelope;
  } catch {
    return Response.json({ error: { code: "invalid_payload", message: "Body is not valid JSON" } }, { status: 400 });
  }

  const message = payload.message;
  const eventType = message?.type ?? "unknown";

  // ---------------------------------------------------------------------
  // Existing notification behavior, preserved verbatim.
  // ---------------------------------------------------------------------
  if (NOTIFICATION_EVENT_TYPES.has(eventType)) {
    console.info("[jarvis-voice]", JSON.stringify({
      event: eventType,
      provider: "vapi",
      providerCallId: message?.call?.id ?? null,
      status: message?.status ?? message?.call?.status ?? null,
      endedReason: message?.endedReason ?? null,
    }));
  }

  // ---------------------------------------------------------------------
  // Inbound phone control. Off unless explicitly enabled AND fully
  // configured; when off, this endpoint behaves exactly as it did before.
  // ---------------------------------------------------------------------
  const configResolution = resolveJarvisPhoneCommandConfig();
  if (!configResolution.ok) {
    if (configResolution.reason !== "disabled") {
      // Names the missing variables, never their values.
      console.warn(
        "[jarvis-phone]",
        JSON.stringify({ event: "config-incomplete", reason: configResolution.reason, missing: configResolution.missing })
      );
    }
    return Response.json({ received: true });
  }

  const event = normalizeVapiEvent(payload);
  if (event.kind === "ignored") return Response.json({ received: true });

  let db;
  try {
    db = createDbClient(loadEnv());
  } catch {
    // A configuration failure must not look like a successful delivery, and
    // must not tell the provider what is misconfigured.
    console.error("[jarvis-phone]", JSON.stringify({ event: "database-unavailable" }));
    return Response.json({ error: { code: "unavailable", message: "Temporarily unavailable" } }, { status: 503 });
  }

  // Claim first. Losing this race means the event was already handled, so it
  // is acknowledged without acting a second time.
  const claim = await claimWebhookEvent(db, {
    organizationId: configResolution.config.organizationId,
    externalEventId: event.idempotencyKey,
    eventType: event.rawType,
    providerCallId: event.providerCallId,
    processingStatus: "processed",
  });
  if (!claim.claimed) {
    console.info("[jarvis-phone]", JSON.stringify({ event: "duplicate-ignored", eventType: event.rawType }));
    return Response.json({ received: true, duplicate: true });
  }

  try {
    const result = await handleInboundConversationEvent(db, { config: configResolution.config, event });

    // The claim row is written before the handler runs (so a retry cannot
    // re-run it), so the real outcome is recorded back onto it here. Without
    // this, every event would read `processed` — including refusals.
    await recordWebhookEventOutcome(db, {
      externalEventId: event.idempotencyKey,
      callSessionId: result.sessionId ?? null,
      organizationId: configResolution.config.organizationId,
      processingStatus: result.processingStatus,
      failureCode: result.failureCode ?? null,
    }).catch(() => undefined);

    // Vapi reads `assistant` from the top level of an assistant-request
    // response and `results` from a tool-call response. Everything else is a
    // plain acknowledgement.
    if (event.kind === "assistant_request" && result.payload) return Response.json(result.payload);
    if (event.kind === "tool_call") {
      return Response.json({ results: [{ toolCallId: event.toolCallId, result: result.spoken }] });
    }
    return Response.json({ received: true });
  } catch (error) {
    const failureCode = error instanceof PhoneCommandActorUnavailableError ? error.reason : "handler_error";
    console.error("[jarvis-phone]", JSON.stringify(redactLogFields({ event: "handler-failed", eventType: event.rawType, failureCode })));

    // The claim row is marked failed so the failure is visible in the event
    // store rather than silently swallowed. The claim is deliberately NOT
    // released: releasing it would let an automatic provider retry re-run a
    // handler that may already have partially completed.
    await recordWebhookEventOutcome(db, {
      externalEventId: event.idempotencyKey,
      organizationId: configResolution.config.organizationId,
      processingStatus: "failed",
      failureCode,
    }).catch(() => undefined);

    if (event.kind === "tool_call") {
      // Honest failure to the caller: no invented success, no silent hang.
      return Response.json({
        results: [
          {
            toolCallId: event.toolCallId,
            result: "Something went wrong on my side and I don't want to guess. Nothing was started. Please try again in a moment, or use LYNQ Office.",
          },
        ],
      });
    }
    return Response.json({ error: { code: "handler_error", message: "Event could not be processed" } }, { status: 500 });
  }
}
