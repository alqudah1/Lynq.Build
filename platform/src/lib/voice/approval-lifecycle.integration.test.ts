import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import {
  agentExecutions,
  auditLogs,
  jarvisCallSessions,
  jarvisPhoneCommands,
  organizationMemberships,
  organizations,
  projects,
  projectTasks,
  users,
} from "@/db/schema";
import { createSession } from "@/lib/auth/session";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";
import { ensureOfficeDeliveryTeam } from "@/lib/office/team";
import { deriveFounderPasscode } from "./founder-verification";
import { handleInboundConversationEvent } from "./inbound-conversation";
import { normalizeVapiEvent } from "./vapi-events";

/**
 * ============================================================================
 * From a sentence on a phone call to agents actually running
 * ============================================================================
 *
 * This is the path the whole lane exists to make safe, and the only one that
 * turns speech into work: the founder describes something the risk gate stops,
 * confirms the wording on the call, and an owner or admin — inside an
 * authenticated browser session, never on the phone — approves it. Only then
 * does a real Office project exist.
 *
 * Every piece of that has its own test. The pieces have never been run
 * together, and "no simulated work" is a claim about the whole chain rather
 * than about any link in it. So this asserts on the things that would be
 * missing if any of it were a placeholder: real `projects`, real
 * `project_tasks`, real `agent_executions`, a command row that points at the
 * project that actually exists, and an audit trail that records who approved
 * it.
 *
 * The reverse claims matter as much. Before the approval there must be no
 * project — not a draft one, not an empty one — and a decline must leave the
 * same nothing behind.
 *
 * Requires a Postgres the Neon driver can reach:
 *   set -a && source .env.local && set +a && npm run test:integration
 */

const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (cookieStore.has(name) ? { name, value: cookieStore.get(name) } : undefined),
      set: (name: string, value: string) => cookieStore.set(name, value),
      delete: (name: string) => cookieStore.delete(name),
    }),
}));

// `after()` schedules the runtime drain at the route boundary. The drain itself
// is the existing worker and is not what this test is about; running it would
// reach the model provider.
vi.mock("next/server", () => ({ after: () => undefined }));

const { POST: POST_DECISION } = await import("@/app/api/organizations/[organizationId]/jarvis/phone/commands/[commandId]/route");

const env = loadEnv();
const db = createDbClient(env);

const VERIFICATION_SECRET = "an-approval-lifecycle-secret-well-over-32-chars-x";
const FOUNDER_NUMBER = "+14165550199";
const NOW = Date.now();

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeFounder() {
  const [user] = await db
    .insert(users)
    .values({ email: `jarvis-approval-${crypto.randomUUID()}@example.com`, name: "Approval Founder" })
    .returning({ id: users.id });
  createdUserIds.push(user.id);

  const [org] = await db
    .insert(organizations)
    .values({ name: "Approval Org", slug: `jarvis-approval-${crypto.randomUUID().slice(0, 8)}` })
    .returning({ id: organizations.id });
  createdOrgIds.push(org.id);
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: user.id, role: "owner" });

  // The real delivery roster, through the real registry.
  await ensureOfficeDeliveryTeam(db, { organizationId: org.id, humanOwnerUserId: user.id, actorUserId: user.id });

  return {
    organizationId: org.id,
    founderUserId: user.id,
    config: {
      organizationId: org.id,
      founderUserId: user.id,
      founderPhoneNumber: FOUNDER_NUMBER,
      verificationSecret: VERIFICATION_SECRET,
    },
  };
}

type Config = Awaited<ReturnType<typeof makeFounder>>["config"];

function tool(callId: string, toolCallId: string, name: string, args: Record<string, unknown>) {
  return normalizeVapiEvent({
    message: {
      type: "tool-calls",
      call: { id: callId, type: "inboundPhoneCall" },
      customer: { number: FOUNDER_NUMBER },
      toolCalls: [{ id: toolCallId, function: { name, arguments: args } }],
    },
  });
}

function assistantRequest(callId: string) {
  return normalizeVapiEvent({
    message: {
      type: "assistant-request",
      call: { id: callId, type: "inboundPhoneCall", customer: { number: FOUNDER_NUMBER } },
      customer: { number: FOUNDER_NUMBER },
    },
  });
}

/** Plays a call up to a confirmed, gated command and returns the command row. */
async function callInAGatedCommand(config: Config, outcome: string) {
  const callId = `call-${crypto.randomUUID()}`;
  await handleInboundConversationEvent(db, { config, event: assistantRequest(callId), nowMs: NOW });
  await handleInboundConversationEvent(db, {
    config,
    event: tool(callId, "tc-v", "verify_founder", { code: deriveFounderPasscode(VERIFICATION_SECRET, NOW) }),
    nowMs: NOW,
  });
  await handleInboundConversationEvent(db, {
    config,
    event: tool(callId, "tc-c", "capture_command", { requestedOutcome: outcome }),
    nowMs: NOW,
  });
  const confirmed = await handleInboundConversationEvent(db, {
    config,
    event: tool(callId, "tc-y", "confirm_command", { confirmed: true }),
    nowMs: NOW,
  });

  const [command] = await db
    .select()
    .from(jarvisPhoneCommands)
    .where(eq(jarvisPhoneCommands.organizationId, config.organizationId))
    .orderBy(asc(jarvisPhoneCommands.createdAt));
  return { callId, command, spoken: confirmed.spoken };
}

async function authenticateAs(userId: string) {
  const { rawToken } = await createSession(db, { userId });
  cookieStore.set(SESSION_COOKIE_NAME, rawToken);
}

function decisionParams(organizationId: string, commandId: string) {
  return { params: Promise.resolve({ organizationId, commandId }) };
}

function decide(organizationId: string, commandId: string, body: Record<string, unknown>) {
  return POST_DECISION(
    new Request("https://app.lynq.build/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    decisionParams(organizationId, commandId)
  );
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(async () => {
  cookieStore.clear();
  vi.restoreAllMocks();
  // Deleting the organization cascades every project, task, execution and job a
  // real dispatch created.
  for (const organizationId of createdOrgIds.splice(0)) {
    await db.delete(organizations).where(eq(organizations.id, organizationId));
  }
  for (const userId of createdUserIds.splice(0)) {
    await db.delete(users).where(eq(users.id, userId));
  }
});

describe("a gated command becomes real work only when a human approves it", () => {
  it("creates nothing until the approval, then creates a project, tasks and running agents", async () => {
    const { organizationId, founderUserId, config } = await makeFounder();
    const { command, spoken } = await callInAGatedCommand(config, "Email the restaurant owner our proposal this week");

    // On the call: gated, and said so plainly.
    expect(command.requiresApproval).toBe(true);
    expect(command.dispatchState).toBe("awaiting_approval");
    expect(spoken).toMatch(/nothing has started/i);

    // Before the approval there is no project. Not a draft one, not an empty
    // one — none.
    expect(await db.select({ id: projects.id }).from(projects).where(eq(projects.organizationId, organizationId))).toHaveLength(0);
    expect(command.projectId).toBeNull();

    await authenticateAs(founderUserId);
    const response = await decide(organizationId, command.id, { decision: "approve", decisionNote: "Yes, send it." });
    expect(response.status).toBe(200);

    // Now there is real work, and the command points at the project that
    // actually exists.
    const projectRows = await db
      .select({ id: projects.id, name: projects.name, status: projects.status })
      .from(projects)
      .where(eq(projects.organizationId, organizationId));
    expect(projectRows).toHaveLength(1);

    const [stored] = await db.select().from(jarvisPhoneCommands).where(eq(jarvisPhoneCommands.id, command.id));
    expect(stored.dispatchState).toBe("directive_created");
    expect(stored.projectId).toBe(projectRows[0].id);
    expect(stored.approvalDecidedByUserId).toBe(founderUserId);
    expect(stored.approvalDecisionNote).toBe("Yes, send it.");

    const tasks = await db.select({ id: projectTasks.id }).from(projectTasks).where(eq(projectTasks.projectId, projectRows[0].id));
    expect(tasks.length).toBeGreaterThan(0);

    const executions = await db
      .select({ id: agentExecutions.id })
      .from(agentExecutions)
      .where(eq(agentExecutions.organizationId, organizationId));
    // At least one agent is actually running, not merely planned.
    expect(executions.length).toBeGreaterThan(0);

    const decided = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.eventType, "jarvis_phone_command_decided")));
    expect(decided).toHaveLength(1);

    const dispatched = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.eventType, "jarvis_phone_command_dispatched")));
    expect(dispatched).toHaveLength(1);
  });

  it("leaves nothing behind when the approval is declined", async () => {
    const { organizationId, founderUserId, config } = await makeFounder();
    const { command } = await callInAGatedCommand(config, "Email the restaurant owner our proposal this week");

    await authenticateAs(founderUserId);
    const response = await decide(organizationId, command.id, { decision: "decline", decisionNote: "Not yet." });
    expect(response.status).toBe(200);

    const [stored] = await db.select().from(jarvisPhoneCommands).where(eq(jarvisPhoneCommands.id, command.id));
    expect(stored.dispatchState).toBe("declined");
    expect(stored.projectId).toBeNull();
    expect(stored.approvalDecidedByUserId).toBe(founderUserId);

    expect(await db.select({ id: projects.id }).from(projects).where(eq(projects.organizationId, organizationId))).toHaveLength(0);
    expect(
      await db.select({ id: agentExecutions.id }).from(agentExecutions).where(eq(agentExecutions.organizationId, organizationId))
    ).toHaveLength(0);
  });

  it("cannot be approved twice, however many times the button is pressed", async () => {
    const { organizationId, founderUserId, config } = await makeFounder();
    const { command } = await callInAGatedCommand(config, "Email the restaurant owner our proposal this week");
    await authenticateAs(founderUserId);

    const [first, second] = await Promise.all([
      decide(organizationId, command.id, { decision: "approve" }),
      decide(organizationId, command.id, { decision: "approve" }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBeGreaterThanOrEqual(400);

    // The assertion that actually means the race is closed.
    expect(await db.select({ id: projects.id }).from(projects).where(eq(projects.organizationId, organizationId))).toHaveLength(1);
    const decided = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.eventType, "jarvis_phone_command_decided")));
    expect(decided).toHaveLength(1);
  });

  it("refuses a member of the same organization, and creates nothing on the attempt", async () => {
    const { organizationId, config } = await makeFounder();
    const { command } = await callInAGatedCommand(config, "Email the restaurant owner our proposal this week");

    const [member] = await db
      .insert(users)
      .values({ email: `jarvis-approval-member-${crypto.randomUUID()}@example.com` })
      .returning({ id: users.id });
    createdUserIds.push(member.id);
    await db.insert(organizationMemberships).values({ organizationId, userId: member.id, role: "member" });
    await authenticateAs(member.id);

    const response = await decide(organizationId, command.id, { decision: "approve" });
    expect(response.status).toBeGreaterThanOrEqual(400);

    const [stored] = await db.select().from(jarvisPhoneCommands).where(eq(jarvisPhoneCommands.id, command.id));
    expect(stored.dispatchState).toBe("awaiting_approval");
    expect(await db.select({ id: projects.id }).from(projects).where(eq(projects.organizationId, organizationId))).toHaveLength(0);
  });

  it("keeps the founder's own words intact all the way into the project", async () => {
    // The point of the read-back is that what the founder confirmed is what
    // gets worked on. This follows one distinctive phrase from the tool call
    // through the command row and into the Office project's own record.
    const { organizationId, founderUserId, config } = await makeFounder();
    const { command } = await callInAGatedCommand(config, "Email the Pizzeria Bella owner our proposal this week");

    expect(command.requestedOutcome).toContain("Pizzeria Bella");
    expect(command.readbackText).toContain("Pizzeria Bella");

    await authenticateAs(founderUserId);
    await decide(organizationId, command.id, { decision: "approve" });

    const [project] = await db
      .select({ description: projects.description, objective: projects.objective })
      .from(projects)
      .where(eq(projects.organizationId, organizationId));
    expect(project.description).toContain("Pizzeria Bella");
    expect(project.objective).toContain("Pizzeria Bella");
    // And the record says how it got there.
    expect(project.description).toMatch(/captured from a verified founder phone call/i);
  });
});

describe("the call itself can never do what the approval does", () => {
  it("refuses a second confirmation on the call and reports what really happened", async () => {
    const { config } = await makeFounder();
    const { callId, command } = await callInAGatedCommand(config, "Email the restaurant owner our proposal this week");

    const again = await handleInboundConversationEvent(db, {
      config,
      event: tool(callId, "tc-y2", "confirm_command", { confirmed: true }),
      nowMs: NOW,
    });

    expect(again.spoken).toMatch(/already waiting for your approval/i);
    expect(again.spoken).toMatch(/nothing has started/i);

    const [stored] = await db.select().from(jarvisPhoneCommands).where(eq(jarvisPhoneCommands.id, command.id));
    expect(stored.dispatchState).toBe("awaiting_approval");
    expect(stored.projectId).toBeNull();
  });

  it("does not let a retraction after a yes read as agreement", async () => {
    const { config } = await makeFounder();
    const { callId } = await callInAGatedCommand(config, "Email the restaurant owner our proposal this week");

    const retracted = await handleInboundConversationEvent(db, {
      config,
      event: tool(callId, "tc-n", "confirm_command", { confirmed: false }),
      nowMs: NOW,
    });

    // It says where the thing actually is, and that the call cannot undo it —
    // not "that one is already waiting", which reads as agreement.
    expect(retracted.spoken).toMatch(/can't undo it from the call/i);
    expect(retracted.spoken).toMatch(/decline it there/i);
  });
});

describe("the session and the command a call leaves behind", () => {
  it("keeps one command per call even when the founder describes it twice", async () => {
    const { organizationId, config } = await makeFounder();
    const callId = `call-${crypto.randomUUID()}`;

    await handleInboundConversationEvent(db, { config, event: assistantRequest(callId), nowMs: NOW });
    await handleInboundConversationEvent(db, {
      config,
      event: tool(callId, "tc-v", "verify_founder", { code: deriveFounderPasscode(VERIFICATION_SECRET, NOW) }),
      nowMs: NOW,
    });
    await handleInboundConversationEvent(db, {
      config,
      event: tool(callId, "tc-c1", "capture_command", { requestedOutcome: "Research three Brampton restaurants" }),
      nowMs: NOW,
    });
    // The founder corrects themselves before confirming anything.
    const second = await handleInboundConversationEvent(db, {
      config,
      event: tool(callId, "tc-c2", "capture_command", { requestedOutcome: "Research three Mississauga restaurants instead" }),
      nowMs: NOW,
    });
    expect(second.spoken).toContain("Mississauga");

    const commands = await db
      .select({ id: jarvisPhoneCommands.id, outcome: jarvisPhoneCommands.requestedOutcome })
      .from(jarvisPhoneCommands)
      .where(eq(jarvisPhoneCommands.organizationId, organizationId));
    // One open draft per call, not one row per sentence.
    expect(commands).toHaveLength(1);
    expect(commands[0].outcome).toContain("Mississauga");

    const [session] = await db.select().from(jarvisCallSessions).where(eq(jarvisCallSessions.providerCallId, callId));
    expect(session.verificationState).toBe("verified");
  });
});
