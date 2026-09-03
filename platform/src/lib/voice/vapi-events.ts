import { createHash } from "node:crypto";

/**
 * Normalizes Vapi's server messages into the small, closed set of events this
 * lane actually acts on, and derives a stable idempotency key for each one.
 *
 * Vapi does not send a guaranteed-unique event id on every message type, and a
 * webhook that assumes one would silently create duplicate projects the first
 * time the provider retries. So the key is DERIVED: it is a hash of the fields
 * that identify the event's content (call id, type, and whatever makes this
 * occurrence distinct — a turn's text, a tool call's id, a status value). Two
 * genuine deliveries of the same event hash identically and the second is
 * ignored; two different events never collide.
 *
 * Pure parsing — no database, no environment, no network — so every branch is
 * unit-testable without a provider.
 */

/**
 * Fields every normalized event carries. `callType` is the provider's own
 * `call.type` ("inboundPhoneCall" / "outboundPhoneCall") — load-bearing,
 * because the SAME webhook receives the pre-existing outbound founder
 * notification calls, and those must never be mistaken for a command
 * conversation.
 */
interface NormalizedEventBase {
  providerCallId: string | null;
  callerNumber: string | null;
  callType: string | null;
  idempotencyKey: string;
  rawType: string;
}

export type NormalizedVapiEvent =
  | ({ kind: "assistant_request" } & NormalizedEventBase)
  | ({ kind: "tool_call"; toolCallId: string; toolName: string; args: Record<string, unknown> } & NormalizedEventBase)
  | ({ kind: "transcript"; role: "founder" | "jarvis"; text: string; isFinal: boolean } & NormalizedEventBase)
  | ({ kind: "status_update"; status: string | null } & NormalizedEventBase)
  | ({ kind: "call_ended"; endedReason: string | null; summaryTranscript: string | null } & NormalizedEventBase)
  | ({ kind: "ignored" } & NormalizedEventBase);

export interface VapiServerMessageEnvelope {
  message?: {
    type?: string;
    status?: string;
    endedReason?: string;
    role?: string;
    transcript?: string;
    transcriptType?: string;
    artifact?: { transcript?: string };
    timestamp?: number | string;
    call?: { id?: string; type?: string; status?: string; customer?: { number?: string } };
    customer?: { number?: string };
    phoneNumber?: { number?: string };
    toolCalls?: Array<{ id?: string; function?: { name?: string; arguments?: unknown } }>;
    toolCallList?: Array<{ id?: string; name?: string; arguments?: unknown }>;
    functionCall?: { name?: string; parameters?: unknown };
  };
}

function hashKey(parts: Array<string | null | undefined>): string {
  return createHash("sha256").update(parts.map((part) => part ?? "").join("\u0000")).digest("hex");
}

function readArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

/** Vapi's transcript role vocabulary maps onto the two speakers this lane records. */
function normalizeRole(role: string | undefined): "founder" | "jarvis" {
  return role === "assistant" || role === "bot" ? "jarvis" : "founder";
}

export function normalizeVapiEvent(payload: VapiServerMessageEnvelope): NormalizedVapiEvent {
  const message = payload.message ?? {};
  const rawType = typeof message.type === "string" ? message.type : "unknown";
  const providerCallId = typeof message.call?.id === "string" ? message.call.id : null;
  const callerNumber =
    (typeof message.customer?.number === "string" ? message.customer.number : null) ??
    (typeof message.call?.customer?.number === "string" ? message.call.customer.number : null);

  const callType = typeof message.call?.type === "string" ? message.call.type : null;
  const base = { providerCallId, callerNumber, callType, rawType };

  // Idempotency keys are built from the NORMALIZED kind, never from `rawType`.
  //
  // Several provider type strings alias to one logical event — `tool-calls`,
  // `function-call` and `tool-call` all mean "the assistant called a tool", and
  // `status-update`/ended, `end-of-call-report` and `hang` all mean "the call
  // is over". Folding `rawType` into the key gave the same logical event a
  // different key per alias, so the dedup layer's promise that an event is
  // claimed exactly once did not actually hold: `finalizeCall` could run three
  // times for one call. Downstream guards absorbed it, but "claimed once" has
  // to be true where it is claimed.
  const keyFor = (kind: string, ...parts: Array<string | null | undefined>) => hashKey([providerCallId, kind, ...parts]);

  if (rawType === "assistant-request") {
    return { kind: "assistant_request", ...base, idempotencyKey: keyFor("assistant_request") };
  }

  if (rawType === "tool-calls" || rawType === "function-call" || rawType === "tool-call") {
    const fromToolCalls = message.toolCalls?.[0];
    const fromToolCallList = message.toolCallList?.[0];
    const toolName =
      (typeof fromToolCalls?.function?.name === "string" ? fromToolCalls.function.name : null) ??
      (typeof fromToolCallList?.name === "string" ? fromToolCallList.name : null) ??
      (typeof message.functionCall?.name === "string" ? message.functionCall.name : null);
    if (!toolName) return { kind: "ignored", ...base, idempotencyKey: keyFor("tool_call", "no-tool") };

    const args = readArguments(fromToolCalls?.function?.arguments ?? fromToolCallList?.arguments ?? message.functionCall?.parameters);
    const toolCallId = (typeof fromToolCalls?.id === "string" ? fromToolCalls.id : null) ?? (typeof fromToolCallList?.id === "string" ? fromToolCallList.id : null) ?? hashKey([providerCallId, toolName, JSON.stringify(args)]).slice(0, 32);

    return {
      kind: "tool_call",
      ...base,
      toolCallId,
      toolName,
      args,
      // The tool call id is provider-unique per invocation; when absent it is
      // derived above from the call, name and arguments, which is exactly the
      // property a retry must hash identically on.
      idempotencyKey: keyFor("tool_call", toolCallId),
    };
  }

  if (rawType === "transcript" || rawType === "transcript[transcriptType='final']") {
    const text = typeof message.transcript === "string" ? message.transcript : "";
    if (!text.trim()) return { kind: "ignored", ...base, idempotencyKey: keyFor("transcript", "empty") };
    const isFinal = message.transcriptType !== "partial";
    return {
      kind: "transcript",
      ...base,
      role: normalizeRole(message.role),
      text,
      isFinal,
      // Content-addressed: a redelivered partial and its final differ in
      // `transcriptType`, so both are recorded once and neither duplicates.
      idempotencyKey: keyFor("transcript", typeof message.role === "string" ? message.role : "", isFinal ? "final" : "partial", text),
    };
  }

  if (rawType === "status-update") {
    const status = typeof message.status === "string" ? message.status : null;
    if (status === "ended") {
      return {
        kind: "call_ended",
        ...base,
        endedReason: typeof message.endedReason === "string" ? message.endedReason : null,
        summaryTranscript: typeof message.artifact?.transcript === "string" ? message.artifact.transcript : null,
        idempotencyKey: keyFor("call_ended"),
      };
    }
    return { kind: "status_update", ...base, status, idempotencyKey: keyFor("status_update", status) };
  }

  if (rawType === "end-of-call-report" || rawType === "hang") {
    return {
      kind: "call_ended",
      ...base,
      endedReason: typeof message.endedReason === "string" ? message.endedReason : rawType === "hang" ? "hang" : null,
      summaryTranscript: typeof message.artifact?.transcript === "string" ? message.artifact.transcript : null,
      idempotencyKey: keyFor("call_ended"),
    };
  }

  // `ignored` keeps `rawType`: two different unrecognized event types are not
  // the same event, and collapsing them would silently drop one.
  return { kind: "ignored", ...base, idempotencyKey: keyFor("ignored", rawType) };
}

/** The three tool names the inbound assistant is allowed to call. Anything else is refused rather than guessed at. */
export const JARVIS_PHONE_TOOLS = ["verify_founder", "capture_command", "confirm_command"] as const;
export type JarvisPhoneToolName = (typeof JARVIS_PHONE_TOOLS)[number];

/**
 * True when the event demonstrably belongs to an INBOUND call.
 *
 * Two independent signals, either of which is sufficient: the provider said so
 * in `call.type`, or the event is one only an inbound command conversation can
 * produce (`assistant-request`, or one of this lane's own tool calls — an
 * outbound notification assistant declares no tools). Anything else is left to
 * the outbound notification lane rather than guessed at.
 */
export function isInboundCallEvent(event: NormalizedVapiEvent): boolean {
  if (event.callType) return /^inbound/i.test(event.callType);
  return event.kind === "assistant_request" || event.kind === "tool_call";
}

export function isJarvisPhoneTool(name: string): name is JarvisPhoneToolName {
  return (JARVIS_PHONE_TOOLS as readonly string[]).includes(name);
}
