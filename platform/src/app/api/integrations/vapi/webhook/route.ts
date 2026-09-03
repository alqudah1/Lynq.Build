import "server-only";

import { timingSafeEqualStrings } from "@/lib/communications-os/secrets";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { resolveJarvisPhoneCommandConfig, type JarvisPhoneCommandConfig } from "@/lib/voice/phone-config";
import { isInboundCallEvent, normalizeVapiEvent, type NormalizedVapiEvent, type VapiServerMessageEnvelope } from "@/lib/voice/vapi-events";
import { handleInboundConversationEvent } from "@/lib/voice/inbound-conversation";
import {
  claimWebhookEvent,
  findRecordedWebhookAnswer,
  PhoneCommandActorUnavailableError,
  recordWebhookEventOutcome,
  releaseWebhookEventClaim,
} from "@/lib/voice/call-store";
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
 * What a redelivery of an event this deployment has already taken gets back.
 *
 * The claim is what stops the SIDE EFFECTS happening twice. It is not an
 * answer, and for two of the five event kinds an answer is exactly what the
 * provider is waiting on: Vapi reads a tool result out of `results` and an
 * assistant out of `assistant`, and a bare `{received:true}` carries neither.
 * So a `confirm_command` that outran the provider's timeout — which is the
 * normal case, since creating a directive means an LLM plan and a chain of
 * writes — was retried, lost the claim, and left the assistant with no result
 * at all while a real project was being created behind it. The founder heard
 * silence, or whatever the model invented to fill it. An `assistant-request`
 * that failed once was worse: every retry returned no assistant, so a single
 * transient error killed that call permanently.
 *
 * Two different answers, because the two events differ in kind:
 *
 * - A tool call is answered with the SAME sentence the first delivery
 *   produced, replayed from the event row. If that sentence is not there yet,
 *   the first delivery has not finished, and the honest answer is that it is
 *   still going — never an invented outcome.
 * - An assistant request is REBUILT rather than replayed, because the config
 *   depends on live state (whether the founder has verified yet), so a rebuild
 *   is more accurate than a stored copy. Re-running it is safe: its durable
 *   writes are an idempotent `ensureCallSession` and a guarded refusal, and the
 *   call budget it consults is claimed once per provider call id, so a
 *   redelivery is recognised as a call already paid for rather than charged
 *   again.
 */
async function duplicateResponse(
  db: ReturnType<typeof createDbClient>,
  input: { config: JarvisPhoneCommandConfig; event: NormalizedVapiEvent }
): Promise<Response> {
  const { event } = input;

  if (event.kind === "assistant_request") {
    try {
      const result = await handleInboundConversationEvent(db, { config: input.config, event });
      if (result.payload) return Response.json(result.payload);
    } catch {
      console.error("[jarvis-phone]", JSON.stringify({ event: "duplicate-assistant-rebuild-failed" }));
    }
    return Response.json({ received: true, duplicate: true });
  }

  if (event.kind === "tool_call") {
    const recorded = await findRecordedWebhookAnswer(db, {
      externalEventId: event.idempotencyKey,
      organizationId: input.config.organizationId,
    }).catch(() => null);
    const replay = recorded?.responseText?.trim();
    return Response.json({
      results: [
        {
          toolCallId: event.toolCallId,
          result:
            replay && replay.length > 0
              ? replay
              : "I'm still working on that one. Give me a moment — whatever happens, it'll be on the Jarvis screen in LYNQ Office.",
        },
      ],
    });
  }

  return Response.json({ received: true, duplicate: true });
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
/**
 * The whole inbound lane collapses to this one string, so a short one is a
 * deployment error rather than a configuration choice. `JARVIS_PHONE_VERIFICATION_SECRET`
 * is already held to 32; this was checked only for being non-empty, in the
 * route and in readiness alike, so a four-character value passed every check
 * the deployment makes.
 *
 * It is a precondition for the INBOUND lane only, and that placement is the
 * whole point. Enforcing it at the door — which is how this was first written
 * — turns every request into a 401 on any deployment whose existing
 * `VAPI_WEBHOOK_SECRET` is shorter than 32, and nothing ever required 32
 * before this branch. The outbound founder-notification events share this
 * endpoint and have nothing to do with phone control, so that upgrade would
 * have silently ended all Jarvis call-status logging on a lane this branch is
 * not supposed to touch. The door therefore keeps the original rule
 * (non-empty, constant-time equal) and the length floor gates the new lane,
 * which is where a weak secret actually buys an attacker something.
 */
const MIN_WEBHOOK_SECRET_LENGTH = 32;

function webhookSecretStrongEnoughForPhoneControl(secret: string | undefined): boolean {
  return (secret?.trim().length ?? 0) >= MIN_WEBHOOK_SECRET_LENGTH;
}

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

  // Checked after the flag, so a deployment that has not asked for phone
  // control is neither refused nor warned about a rule that does not apply to
  // it. Checked before any state is touched, so a weak secret means the
  // inbound lane simply does not run.
  if (!webhookSecretStrongEnoughForPhoneControl(configuredSecret)) {
    console.warn(
      "[jarvis-phone]",
      JSON.stringify({ event: "config-incomplete", reason: "weak_webhook_secret", missing: ["VAPI_WEBHOOK_SECRET"] })
    );
    return Response.json({ received: true });
  }

  const event = normalizeVapiEvent(payload);
  if (event.kind === "ignored") return Response.json({ received: true });

  let db;
  let claim;
  try {
    db = createDbClient(loadEnv());
    // Claim first. Losing this race means the event was already handled, so it
    // is acted on no further — though it is still ANSWERED; see
    // `duplicateResponse`.
    claim = await claimWebhookEvent(db, {
      organizationId: configResolution.config.organizationId,
      externalEventId: event.idempotencyKey,
      eventType: event.rawType,
      providerCallId: event.providerCallId,
      processingStatus: "processed",
    });
  } catch {
    // Neither of those touches the founder's state, so failing here means the
    // event has not been acted on at all — and what to answer depends entirely
    // on which lane the event belongs to.
    //
    // The OUTBOUND founder notifications share this endpoint and were
    // acknowledged unconditionally with a 200 before phone control existed.
    // Turning a transient Neon error into a 5xx for them is a regression on a
    // lane this branch is not supposed to touch: the provider would retry, and
    // then give up, on an event whose only purpose here is the log line
    // already written above.
    //
    // Only an event that demonstrably belongs to an INBOUND command call gets a
    // 503 and a retry. Everything else is acknowledged, which is what this
    // endpoint did for every event before phone control existed.
    //
    // The tempting alternative — retry unless demonstrably OUTBOUND — was tried
    // and is worse. `isInboundCallEvent` falls back to the event kind when
    // `call.type` is absent, so an ambiguous `status-update` or
    // `end-of-call-report` would be retried, and those are exactly the events
    // the pre-existing outbound notification lane produces: a database blip
    // would answer 5xx to a lane this branch is not supposed to touch, and
    // sustained 5xx is how a provider decides to disable a webhook.
    //
    // What made that trade look necessary was the fear of losing an inbound
    // `call_ended` and wedging an unconfirmed draft forever. That is no longer
    // load-bearing on one delivery: `reapAbandonedDraft` expires such a draft on
    // the read path. A state whose only exit depends on a single event arriving
    // is a state that eventually wedges, so it was fixed where it lived rather
    // than defended here.
    console.error("[jarvis-phone]", JSON.stringify({ event: "event-store-unavailable", eventType: event.rawType }));
    if (!isInboundCallEvent(event)) return Response.json({ received: true });
    return Response.json({ error: { code: "unavailable", message: "Temporarily unavailable" } }, { status: 503 });
  }

  if (!claim.claimed) {
    console.info("[jarvis-phone]", JSON.stringify({ event: "duplicate-ignored", eventType: event.rawType }));
    return duplicateResponse(db, { config: configResolution.config, event });
  }

  try {
    const result = await handleInboundConversationEvent(db, { config: configResolution.config, event });

    // The claim row is written before the handler runs (so a retry cannot
    // re-run it), so the real outcome is recorded back onto it here. Without
    // this, every event would read `processed` — including refusals.
    //
    // `responseText` is recorded for the same reason: a retry that loses the
    // claim has to be answered with the SAME sentence, and this row is the
    // only place that sentence survives.
    await recordWebhookEventOutcome(db, {
      externalEventId: event.idempotencyKey,
      callSessionId: result.sessionId ?? null,
      organizationId: configResolution.config.organizationId,
      processingStatus: result.processingStatus,
      failureCode: result.failureCode ?? null,
      responseText: event.kind === "tool_call" ? result.spoken : null,
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

    // A side-effecting handler keeps its claim: releasing it would let an
    // automatic provider retry re-run something that may already have
    // partially completed.
    //
    // The idempotent ones do NOT. `transcript`, `status_update` and
    // `call_ended` are plain state updates guarded by revision or by their own
    // uniqueness, so re-running them is safe — and keeping the claim on a
    // failed `call_ended` was worse than a duplicate: the session stayed
    // `active` and an unconfirmed draft stayed `awaiting_confirmation`
    // forever, both of which the screen shows as live.
    const retryable = event.kind === "transcript" || event.kind === "status_update" || event.kind === "call_ended";
    if (retryable) {
      await releaseWebhookEventClaim(db, { externalEventId: event.idempotencyKey }).catch(() => undefined);
    } else {
      await recordWebhookEventOutcome(db, {
        externalEventId: event.idempotencyKey,
        organizationId: configResolution.config.organizationId,
        processingStatus: "failed",
        failureCode,
      }).catch(() => undefined);
    }

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
