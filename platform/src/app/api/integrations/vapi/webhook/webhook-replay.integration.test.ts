import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { jarvisCallSessions, jarvisVoiceWebhookEvents, organizationMemberships, organizations, users } from "@/db/schema";

/**
 * What a provider redelivery gets back.
 *
 * The idempotency claim is what stops an event's SIDE EFFECTS happening twice.
 * It is not an answer — and Vapi is waiting on an answer for two of the five
 * event kinds. A tool result lives in `results` and an assistant config lives
 * in `assistant`; a bare `{received:true}` carries neither, so a retry of a
 * slow `confirm_command` used to leave the assistant with nothing at all while
 * a real project was being created behind it, and one transient failure on an
 * `assistant-request` permanently bricked the call it belonged to.
 *
 * These are integration tests rather than unit tests because the whole point is
 * the interaction between the claim row, the recorded answer, and the response
 * body — three things that only exist together against a real database.
 */

const { POST } = await import("./route");

const env = loadEnv();
const db = createDbClient(env);

const WEBHOOK_SECRET = "an-integration-webhook-secret-well-over-32-chars";
const VERIFICATION_SECRET = "an-integration-verification-secret-over-32-chars";
const FOUNDER_NUMBER = "+14165550137";

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];
const createdCallIds: string[] = [];

async function makeFounderOrg(): Promise<{ organizationId: string; founderUserId: string }> {
  const [user] = await db
    .insert(users)
    .values({ email: `jarvis-replay-${crypto.randomUUID()}@example.com` })
    .returning({ id: users.id });
  createdUserIds.push(user.id);

  const [org] = await db
    .insert(organizations)
    .values({ name: "Replay Org", slug: `jarvis-replay-${crypto.randomUUID().slice(0, 8)}` })
    .returning({ id: organizations.id });
  createdOrgIds.push(org.id);

  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  return { organizationId: org.id, founderUserId: user.id };
}

function configure(organizationId: string, founderUserId: string): void {
  vi.stubEnv("VAPI_WEBHOOK_SECRET", WEBHOOK_SECRET);
  vi.stubEnv("JARVIS_PHONE_COMMANDS_ENABLED", "true");
  vi.stubEnv("JARVIS_PHONE_ORGANIZATION_ID", organizationId);
  vi.stubEnv("JARVIS_PHONE_FOUNDER_USER_ID", founderUserId);
  vi.stubEnv("JARVIS_PHONE_VERIFICATION_SECRET", VERIFICATION_SECRET);
  vi.stubEnv("JARVIS_FOUNDER_PHONE_E164", FOUNDER_NUMBER);
}

function post(body: unknown): Request {
  return new Request("https://app.lynq.build/api/integrations/vapi/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${WEBHOOK_SECRET}` },
    body: JSON.stringify(body),
  });
}

function toolCall(callId: string, toolCallId: string, name: string, args: Record<string, unknown>) {
  return {
    message: {
      type: "tool-calls",
      call: { id: callId, type: "inboundPhoneCall", customer: { number: FOUNDER_NUMBER } },
      customer: { number: FOUNDER_NUMBER },
      toolCalls: [{ id: toolCallId, function: { name, arguments: args } }],
    },
  };
}

function assistantRequest(callId: string) {
  return {
    message: {
      type: "assistant-request",
      call: { id: callId, type: "inboundPhoneCall", customer: { number: FOUNDER_NUMBER } },
      customer: { number: FOUNDER_NUMBER },
    },
  };
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const callId of createdCallIds.splice(0)) {
    await db.delete(jarvisVoiceWebhookEvents).where(eq(jarvisVoiceWebhookEvents.providerCallId, callId));
    await db.delete(jarvisCallSessions).where(eq(jarvisCallSessions.providerCallId, callId));
  }
  for (const organizationId of createdOrgIds.splice(0)) {
    await db.delete(organizations).where(eq(organizations.id, organizationId));
  }
  for (const userId of createdUserIds.splice(0)) {
    await db.delete(users).where(eq(users.id, userId));
  }
});

describe("a redelivered tool call", () => {
  it("is answered with the same sentence, and does not spend a second verification attempt", async () => {
    const { organizationId, founderUserId } = await makeFounderOrg();
    configure(organizationId, founderUserId);
    const callId = `call-${crypto.randomUUID()}`;
    createdCallIds.push(callId);

    const first = await POST(post(toolCall(callId, "tc-verify-1", "verify_founder", { code: "000000" })));
    const firstBody = (await first.json()) as { results?: Array<{ toolCallId: string; result: string }> };
    expect(firstBody.results?.[0]?.toolCallId).toBe("tc-verify-1");
    const spoken = firstBody.results?.[0]?.result ?? "";
    // A wrong code, so the answer names the tries left — which is exactly what
    // makes a silent second attempt visible if one happens.
    expect(spoken).toMatch(/2 more tries/i);

    const [afterFirst] = await db
      .select({ attempts: jarvisCallSessions.verificationAttempts })
      .from(jarvisCallSessions)
      .where(eq(jarvisCallSessions.providerCallId, callId));
    expect(afterFirst.attempts).toBe(1);

    const second = await POST(post(toolCall(callId, "tc-verify-1", "verify_founder", { code: "000000" })));
    const secondBody = (await second.json()) as { results?: Array<{ toolCallId: string; result: string }>; received?: boolean };

    // The provider gets a tool result, not a bare acknowledgement.
    expect(secondBody.received).toBeUndefined();
    expect(secondBody.results?.[0]?.toolCallId).toBe("tc-verify-1");
    expect(secondBody.results?.[0]?.result).toBe(spoken);

    const [afterSecond] = await db
      .select({ attempts: jarvisCallSessions.verificationAttempts })
      .from(jarvisCallSessions)
      .where(eq(jarvisCallSessions.providerCallId, callId));
    expect(afterSecond.attempts).toBe(1);
  });

  it("says the work is still in flight when the first delivery has not answered yet", async () => {
    const { organizationId, founderUserId } = await makeFounderOrg();
    configure(organizationId, founderUserId);
    const callId = `call-${crypto.randomUUID()}`;
    createdCallIds.push(callId);

    // Stand in for a first delivery that is still running: the claim exists,
    // the answer does not. This is the common case, not an edge one — it is
    // what a provider timeout during a slow dispatch looks like.
    const { normalizeVapiEvent } = await import("@/lib/voice/vapi-events");
    const event = normalizeVapiEvent(toolCall(callId, "tc-confirm-1", "confirm_command", { confirmed: true }));
    await db.insert(jarvisVoiceWebhookEvents).values({
      organizationId,
      provider: "vapi",
      externalEventId: event.idempotencyKey,
      eventType: event.rawType,
      providerCallId: callId,
      processingStatus: "processed",
    });

    const response = await POST(post(toolCall(callId, "tc-confirm-1", "confirm_command", { confirmed: true })));
    const body = (await response.json()) as { results?: Array<{ result: string }> };

    expect(body.results?.[0]?.result).toMatch(/still working on that one/i);
    // Never an invented outcome: it must not claim a project was opened.
    expect(body.results?.[0]?.result).not.toMatch(/opened the project|briefed the team/i);
  });
});

describe("a redelivered assistant request", () => {
  it("gets a real assistant back rather than an acknowledgement with none", async () => {
    const { organizationId, founderUserId } = await makeFounderOrg();
    configure(organizationId, founderUserId);
    const callId = `call-${crypto.randomUUID()}`;
    createdCallIds.push(callId);

    const first = await POST(post(assistantRequest(callId)));
    const firstBody = (await first.json()) as { assistant?: { firstMessage?: string } };
    expect(firstBody.assistant?.firstMessage).toBeTruthy();

    const second = await POST(post(assistantRequest(callId)));
    const secondBody = (await second.json()) as { assistant?: { firstMessage?: string }; received?: boolean };

    expect(secondBody.received).toBeUndefined();
    expect(secondBody.assistant?.firstMessage).toBe(firstBody.assistant?.firstMessage);
  });

  it("creates exactly one call session and one start audit entry across both deliveries", async () => {
    const { organizationId, founderUserId } = await makeFounderOrg();
    configure(organizationId, founderUserId);
    const callId = `call-${crypto.randomUUID()}`;
    createdCallIds.push(callId);

    await POST(post(assistantRequest(callId)));
    await POST(post(assistantRequest(callId)));

    const sessions = await db.select({ id: jarvisCallSessions.id }).from(jarvisCallSessions).where(eq(jarvisCallSessions.providerCallId, callId));
    expect(sessions).toHaveLength(1);

    const { auditLogs } = await import("@/db/schema");
    const started = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.eventType, "jarvis_phone_call_started")));
    // Rebuilding the assistant on a duplicate must not re-audit the call as
    // newly started: `ensureCallSession` audits only a genuine creation, and
    // that property is what makes the rebuild safe to do at all.
    expect(started).toHaveLength(1);
  });
});
