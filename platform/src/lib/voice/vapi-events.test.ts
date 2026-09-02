import { describe, expect, it } from "vitest";
import { isJarvisPhoneTool, normalizeVapiEvent } from "./vapi-events";

describe("normalizeVapiEvent", () => {
  it("recognizes an inbound assistant request and its caller", () => {
    const event = normalizeVapiEvent({
      message: { type: "assistant-request", call: { id: "call-1" }, customer: { number: "+14165551234" } },
    });
    expect(event.kind).toBe("assistant_request");
    expect(event.providerCallId).toBe("call-1");
    expect(event.callerNumber).toBe("+14165551234");
  });

  it("reads a tool call in the toolCalls shape", () => {
    const event = normalizeVapiEvent({
      message: {
        type: "tool-calls",
        call: { id: "call-1" },
        toolCalls: [{ id: "tc-1", function: { name: "capture_command", arguments: { requestedOutcome: "Research" } } }],
      },
    });
    expect(event.kind).toBe("tool_call");
    if (event.kind !== "tool_call") throw new Error("expected tool_call");
    expect(event.toolName).toBe("capture_command");
    expect(event.toolCallId).toBe("tc-1");
    expect(event.args).toEqual({ requestedOutcome: "Research" });
  });

  it("reads a tool call whose arguments arrived as a JSON string", () => {
    const event = normalizeVapiEvent({
      message: {
        type: "function-call",
        call: { id: "call-1" },
        functionCall: { name: "verify_founder", parameters: JSON.stringify({ code: "417296" }) },
      },
    });
    if (event.kind !== "tool_call") throw new Error("expected tool_call");
    expect(event.toolName).toBe("verify_founder");
    expect(event.args).toEqual({ code: "417296" });
  });

  it("ignores a malformed tool call rather than guessing a tool name", () => {
    const event = normalizeVapiEvent({ message: { type: "tool-calls", call: { id: "call-1" }, toolCalls: [{ id: "tc-1" }] } });
    expect(event.kind).toBe("ignored");
  });

  it("separates partial and final transcripts and identifies the speaker", () => {
    const partial = normalizeVapiEvent({
      message: { type: "transcript", transcriptType: "partial", role: "user", transcript: "research three", call: { id: "call-1" } },
    });
    const final = normalizeVapiEvent({
      message: { type: "transcript", transcriptType: "final", role: "assistant", transcript: "understood", call: { id: "call-1" } },
    });
    if (partial.kind !== "transcript" || final.kind !== "transcript") throw new Error("expected transcripts");
    expect(partial.isFinal).toBe(false);
    expect(partial.role).toBe("founder");
    expect(final.isFinal).toBe(true);
    expect(final.role).toBe("jarvis");
  });

  it("drops an empty transcript", () => {
    expect(normalizeVapiEvent({ message: { type: "transcript", transcript: "   ", call: { id: "call-1" } } }).kind).toBe("ignored");
  });

  it("treats an ended status update, an end-of-call report, and a hang as the end of the call", () => {
    expect(normalizeVapiEvent({ message: { type: "status-update", status: "ended", endedReason: "customer-ended-call", call: { id: "c" } } }).kind).toBe("call_ended");
    expect(normalizeVapiEvent({ message: { type: "end-of-call-report", call: { id: "c" } } }).kind).toBe("call_ended");
    expect(normalizeVapiEvent({ message: { type: "hang", call: { id: "c" } } }).kind).toBe("call_ended");
  });

  it("keeps a non-terminal status update distinct from the end of the call", () => {
    const event = normalizeVapiEvent({ message: { type: "status-update", status: "in-progress", call: { id: "c" } } });
    expect(event.kind).toBe("status_update");
  });

  it("ignores an event type this lane does not handle", () => {
    expect(normalizeVapiEvent({ message: { type: "speech-update", call: { id: "c" } } }).kind).toBe("ignored");
    expect(normalizeVapiEvent({}).kind).toBe("ignored");
  });
});

describe("idempotency keys", () => {
  it("hashes two deliveries of the same event identically", () => {
    const payload = { message: { type: "tool-calls", call: { id: "call-1" }, toolCalls: [{ id: "tc-1", function: { name: "confirm_command", arguments: { confirmed: true } } }] } };
    expect(normalizeVapiEvent(payload).idempotencyKey).toBe(normalizeVapiEvent(payload).idempotencyKey);
  });

  it("gives different tool calls different keys", () => {
    const first = normalizeVapiEvent({ message: { type: "tool-calls", call: { id: "call-1" }, toolCalls: [{ id: "tc-1", function: { name: "confirm_command" } }] } });
    const second = normalizeVapiEvent({ message: { type: "tool-calls", call: { id: "call-1" }, toolCalls: [{ id: "tc-2", function: { name: "confirm_command" } }] } });
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
  });

  it("gives the same tool call on two different calls different keys", () => {
    const first = normalizeVapiEvent({ message: { type: "tool-calls", call: { id: "call-1" }, toolCalls: [{ id: "tc-1", function: { name: "confirm_command" } }] } });
    const second = normalizeVapiEvent({ message: { type: "tool-calls", call: { id: "call-2" }, toolCalls: [{ id: "tc-1", function: { name: "confirm_command" } }] } });
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
  });

  it("derives a stable key for a tool call with no provider id, from its content", () => {
    const build = () => normalizeVapiEvent({ message: { type: "tool-calls", call: { id: "call-1" }, toolCalls: [{ function: { name: "capture_command", arguments: { requestedOutcome: "Research" } } }] } });
    expect(build().idempotencyKey).toBe(build().idempotencyKey);
  });

  it("separates a partial transcript from its final version", () => {
    const partial = normalizeVapiEvent({ message: { type: "transcript", transcriptType: "partial", role: "user", transcript: "same text", call: { id: "c" } } });
    const final = normalizeVapiEvent({ message: { type: "transcript", transcriptType: "final", role: "user", transcript: "same text", call: { id: "c" } } });
    expect(partial.idempotencyKey).not.toBe(final.idempotencyKey);
  });
});

describe("isJarvisPhoneTool", () => {
  it("allows only the three declared tools", () => {
    expect(isJarvisPhoneTool("verify_founder")).toBe(true);
    expect(isJarvisPhoneTool("capture_command")).toBe(true);
    expect(isJarvisPhoneTool("confirm_command")).toBe(true);
    expect(isJarvisPhoneTool("send_email")).toBe(false);
    expect(isJarvisPhoneTool("transfer_call")).toBe(false);
  });
});
