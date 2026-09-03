import { describe, it, expect, afterEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { auditLogs, jarvisPhoneCommands, organizationMemberships, organizations, users } from "@/db/schema";
import { createSession } from "@/lib/auth/session";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";
import { ensureCallSession, upsertCommandDraft } from "@/lib/voice/call-store";
import { buildCommandDraft } from "@/lib/voice/command-draft";
import { PASSCODE_DIGITS } from "@/lib/voice/founder-verification";
import { PostgresRateLimiter } from "@/lib/rate-limit/postgres";
import {
  callBudgetKey,
  founderLineBudgetIdentity,
  INBOUND_CALL_RATE_LIMIT,
  refusedBudgetKey,
  refusedCallBudgetIdentity,
  REFUSED_CALL_RATE_LIMIT,
} from "@/lib/voice/verification-budget";

/**
 * The HTTP boundary of the phone lane.
 *
 * Every authorization property below is enforced deep inside the library —
 * `resolvePhoneCommandActor`, `requireOrganizationAdminOverride`,
 * `listPhoneCallsForUser` — and every one of those is already covered by its
 * own test. None of that proves the ROUTES call them, in the right order,
 * before doing anything else. Review round six pointed out that the three
 * routes this lane adds had no test at any level: the whole surface a browser
 * can reach was covered only by inference from the layer beneath it.
 *
 * So these are deliberately about wiring, not about logic: does a member of
 * another organization get a 404 rather than a code, does a member of THIS
 * organization get read access but not decisions, does the passcode response
 * carry the headers a secret-bearing response must carry, and can the same
 * command be approved twice.
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

const { GET: GET_PHONE } = await import("./route");
const { GET: GET_PASSCODE, POST: POST_PASSCODE } = await import("./passcode/route");
const { POST: POST_DECISION } = await import("./commands/[commandId]/route");

const env = loadEnv();
const db = createDbClient(env);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `jarvis-phone-route-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrg(ownerId: string): Promise<string> {
  const [org] = await db
    .insert(organizations)
    .values({ name: "Phone Route Org", slug: `jarvis-phone-route-${crypto.randomUUID().slice(0, 8)}` })
    .returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: ownerId, role: "owner" });
  createdOrgIds.push(org.id);
  return org.id;
}

async function addMember(organizationId: string, userId: string, role: "admin" | "member" | "viewer"): Promise<void> {
  await db.insert(organizationMemberships).values({ organizationId, userId, role });
}

async function authenticateAs(userId: string): Promise<void> {
  const { rawToken } = await createSession(db, { userId });
  cookieStore.set(SESSION_COOKIE_NAME, rawToken);
}

async function openGatedCommand(organizationId: string, founderUserId: string) {
  const session = await ensureCallSession(db, {
    organizationId,
    founderUserId,
    providerCallId: `call-${crypto.randomUUID()}`,
    direction: "inbound",
    purpose: "founder_command",
    callerNumber: "+14165551234",
    callerNumberMatched: true,
  });
  const command = await upsertCommandDraft(db, {
    organizationId,
    callSessionId: session.id,
    founderUserId,
    // Gated: reaching a customer is exactly the category that must stop for a
    // human decision inside an authenticated session.
    draft: buildCommandDraft({ requestedOutcome: "Email the restaurant owner our proposal" }),
  });
  await db.update(jarvisPhoneCommands).set({ dispatchState: "awaiting_approval" }).where(eq(jarvisPhoneCommands.id, command.id));
  return command;
}

function phoneParams(organizationId: string) {
  return { params: Promise.resolve({ organizationId }) };
}

function decisionParams(organizationId: string, commandId: string) {
  return { params: Promise.resolve({ organizationId, commandId }) };
}

function decisionRequest(decision: "approve" | "decline" | "retry"): Request {
  return new Request("https://app.lynq.build/api/organizations/x/jarvis/phone/commands/y", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision }),
  });
}

afterEach(async () => {
  cookieStore.clear();
  vi.unstubAllEnvs();
  // Delete the organization and let the cascades do the rest. Removing
  // memberships first breaks `agents_human_owner_org_membership_fk` as soon as
  // a test has actually dispatched something.
  while (createdOrgIds.length > 0) {
    await db.delete(organizations).where(eq(organizations.id, createdOrgIds.pop()!));
  }
  while (createdUserIds.length > 0) {
    await db.delete(users).where(eq(users.id, createdUserIds.pop()!));
  }
});

describe("GET /jarvis/phone — who may read the screen", () => {
  it("returns 404 to a signed-in user from another organization, never a call list", async () => {
    const owner = await makeUser();
    const organizationId = await makeOrg(owner);
    await openGatedCommand(organizationId, owner);

    const outsider = await makeUser();
    await makeOrg(outsider);
    await authenticateAs(outsider);

    const response = await GET_PHONE(new Request("https://app.lynq.build/x"), phoneParams(organizationId));

    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toMatch(/restaurant owner/i);
  });

  it("lets an ordinary member read, but tells the screen they may not decide", async () => {
    const owner = await makeUser();
    const organizationId = await makeOrg(owner);
    await openGatedCommand(organizationId, owner);

    const member = await makeUser();
    await addMember(organizationId, member, "member");
    await authenticateAs(member);

    const response = await GET_PHONE(new Request("https://app.lynq.build/x"), phoneParams(organizationId));
    const body = (await response.json()) as { data: { canDecide: boolean; canSeePasscode: boolean; calls: unknown[] } };

    expect(response.status).toBe(200);
    expect(body.data.calls).toHaveLength(1);
    // Both authority answers are server-computed. A screen that guesses them
    // renders controls that are refused on click.
    expect(body.data.canDecide).toBe(false);
    expect(body.data.canSeePasscode).toBe(false);
  });
});

describe("GET /jarvis/phone/passcode — the second factor", () => {
  it("refuses an ordinary member before any code is derived", async () => {
    const owner = await makeUser();
    const organizationId = await makeOrg(owner);
    const member = await makeUser();
    await addMember(organizationId, member, "member");
    await authenticateAs(member);

    const response = await GET_PASSCODE(new Request("https://app.lynq.build/x"), phoneParams(organizationId));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(await response.json())).not.toMatch(/"passcode":"\d/);
  });

  it("returns 404 to a member of another organization", async () => {
    const owner = await makeUser();
    const organizationId = await makeOrg(owner);
    const outsider = await makeUser();
    await makeOrg(outsider);
    await authenticateAs(outsider);

    const response = await GET_PASSCODE(new Request("https://app.lynq.build/x"), phoneParams(organizationId));
    expect(response.status).toBe(404);
  });

  it("never lets a code response be cached or leak through a Referer, even when there is no code", async () => {
    // Phone control is not configured for this organization, so the body is a
    // refusal — and the headers must be there anyway. An intermediary does not
    // read the body before deciding what to store.
    const owner = await makeUser();
    const organizationId = await makeOrg(owner);
    await authenticateAs(owner);

    const response = await GET_PASSCODE(new Request("https://app.lynq.build/x"), phoneParams(organizationId));

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("does not hand the founder's code to an admin who is not the founder", async () => {
    const founder = await makeUser();
    const organizationId = await makeOrg(founder);
    const admin = await makeUser();
    await addMember(organizationId, admin, "admin");

    vi.stubEnv("JARVIS_PHONE_COMMANDS_ENABLED", "true");
    vi.stubEnv("JARVIS_PHONE_ORGANIZATION_ID", organizationId);
    vi.stubEnv("JARVIS_PHONE_FOUNDER_USER_ID", founder);
    vi.stubEnv("JARVIS_PHONE_VERIFICATION_SECRET", "a-verification-secret-that-is-long-enough-01234");
    vi.stubEnv("JARVIS_FOUNDER_PHONE_E164", "+14165551234");

    await authenticateAs(admin);
    const refused = (await (await GET_PASSCODE(new Request("https://app.lynq.build/x"), phoneParams(organizationId))).json()) as {
      data: { available: boolean; passcode: string | null; reason?: string };
    };
    expect(refused.data.available).toBe(false);
    expect(refused.data.passcode).toBeNull();
    // And it says why, in words that are true: not "this is not set up".
    expect(refused.data.reason).toMatch(/founder's account/i);

    cookieStore.clear();
    await authenticateAs(founder);
    const issued = (await (await GET_PASSCODE(new Request("https://app.lynq.build/x"), phoneParams(organizationId))).json()) as {
      data: { available: boolean; passcode: string | null };
    };
    expect(issued.data.available).toBe(true);
    expect(issued.data.passcode).toMatch(new RegExp(`^\\d{${PASSCODE_DIGITS}}$`));
  });

  /**
   * Round twelve. Both caller budgets are keyed on the number a caller asserts,
   * and caller ID is spoofable — so someone spoofing the founder's line can
   * spend them and keep them spent, and the founder is refused before their
   * correct code is ever checked. A rate limit that an attacker can hold down
   * is a denial-of-service primitive aimed at the person it protects, so it has
   * to be visible and clearable from an authenticated session.
   */
  it("shows the founder a spent caller budget, and lets the founder clear it", async () => {
    const founder = await makeUser();
    const organizationId = await makeOrg(founder);
    vi.stubEnv("JARVIS_PHONE_COMMANDS_ENABLED", "true");
    vi.stubEnv("JARVIS_PHONE_ORGANIZATION_ID", organizationId);
    vi.stubEnv("JARVIS_PHONE_FOUNDER_USER_ID", founder);
    vi.stubEnv("JARVIS_PHONE_VERIFICATION_SECRET", "a-verification-secret-that-is-long-enough-01234");
    vi.stubEnv("JARVIS_FOUNDER_PHONE_E164", "+14165551234");
    await authenticateAs(founder);

    const identity = founderLineBudgetIdentity({
      verificationSecret: "a-verification-secret-that-is-long-enough-01234",
      organizationId,
    });
    const limiter = new PostgresRateLimiter(db);
    for (let attempt = 0; attempt <= INBOUND_CALL_RATE_LIMIT.limit; attempt += 1) {
      await limiter.recordAttempt(callBudgetKey(identity), INBOUND_CALL_RATE_LIMIT);
    }

    const locked = (await (await GET_PASSCODE(new Request("https://app.lynq.build/x"), phoneParams(organizationId))).json()) as {
      data: { lockout: { locked: boolean; resetAt: string | null } | null };
    };
    expect(locked.data.lockout?.locked).toBe(true);
    expect(locked.data.lockout?.resetAt).toBeTruthy();

    const cleared = (await (await POST_PASSCODE(new Request("https://app.lynq.build/x", { method: "POST" }), phoneParams(organizationId))).json()) as {
      data: { cleared: boolean; lockout: { locked: boolean } | null };
    };
    expect(cleared.data.cleared).toBe(true);
    expect(cleared.data.lockout?.locked).toBe(false);

    const after = (await (await GET_PASSCODE(new Request("https://app.lynq.build/x"), phoneParams(organizationId))).json()) as {
      data: { available: boolean; lockout: { locked: boolean } | null };
    };
    expect(after.data.lockout?.locked).toBe(false);
    // Clearing a throttle is not a grant: the code is still the thing that
    // authenticates, and it is still required.
    expect(after.data.available).toBe(true);

    const audited = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.eventType, "jarvis_phone_verification_lockout_cleared")));
    expect(audited).toHaveLength(1);
  });

  /**
   * Round fourteen, from the compliance audit. `describeDispatchFailure`
   * rendered the raw code — "It failed (model rate limited). Nothing was
   * started." — into `data.message`, which the Jarvis screen shows verbatim in
   * its decision banner. The component already had a founder-readable mapping
   * and its own test asserts the card never shows a code; the banner is a
   * different element, so the one surface the test could not see was the one
   * that leaked.
   */
  it("never puts a raw failure code in the sentence the founder reads", async () => {
    const { describeDispatchFailure } = await import("@/lib/voice/failure-labels");
    for (const code of ["model_rate_limited", "no_agents_available", "provider_unreachable", "unknown_error", "authorization_failed"]) {
      const described = describeDispatchFailure(code);
      expect(described).not.toContain("_");
      expect(described).not.toMatch(/model rate limited|no agents available|provider unreachable|unknown error/i);
    }
    // An unmapped code reads as the honest generic rather than as jargon.
    expect(describeDispatchFailure("some_future_code")).toBe("an unexpected problem");
    expect(describeDispatchFailure(null)).toBe("an unexpected problem");
  });

  it("reports another tenant's flood of wrong numbers as what it is, not as the founder's lockout", async () => {
    /**
     * Round fifteen. Folding the tenant-wide refused-call budget into `locked`
     * made the screen announce that Jarvis was turning down the FOUNDER'S calls
     * after twenty wrong numbers reached the tenant — when their own budgets
     * were untouched and their next call would have worked.
     */
    const founder = await makeUser();
    const organizationId = await makeOrg(founder);
    vi.stubEnv("JARVIS_PHONE_COMMANDS_ENABLED", "true");
    vi.stubEnv("JARVIS_PHONE_ORGANIZATION_ID", organizationId);
    vi.stubEnv("JARVIS_PHONE_FOUNDER_USER_ID", founder);
    vi.stubEnv("JARVIS_PHONE_VERIFICATION_SECRET", "a-verification-secret-that-is-long-enough-01234");
    vi.stubEnv("JARVIS_FOUNDER_PHONE_E164", "+14165551234");
    await authenticateAs(founder);

    const refusedIdentity = refusedCallBudgetIdentity({
      verificationSecret: "a-verification-secret-that-is-long-enough-01234",
      organizationId,
    });
    const limiter = new PostgresRateLimiter(db);
    for (let attempt = 0; attempt <= REFUSED_CALL_RATE_LIMIT.limit; attempt += 1) {
      await limiter.recordAttempt(refusedBudgetKey(refusedIdentity), REFUSED_CALL_RATE_LIMIT);
    }

    const state = (await (await GET_PASSCODE(new Request("https://app.lynq.build/x"), phoneParams(organizationId))).json()) as {
      data: { lockout: { locked: boolean; refusedCallsSpent: boolean; callsRemaining: number } | null };
    };

    expect(state.data.lockout?.refusedCallsSpent).toBe(true);
    // The founder's own budget is untouched, so they are not locked out.
    expect(state.data.lockout?.locked).toBe(false);
    expect(state.data.lockout?.callsRemaining).toBe(INBOUND_CALL_RATE_LIMIT.limit);
  });

  it("will not let an admin who is not the founder clear the founder's lockout", async () => {
    const founder = await makeUser();
    const organizationId = await makeOrg(founder);
    const admin = await makeUser();
    await addMember(organizationId, admin, "admin");
    vi.stubEnv("JARVIS_PHONE_COMMANDS_ENABLED", "true");
    vi.stubEnv("JARVIS_PHONE_ORGANIZATION_ID", organizationId);
    vi.stubEnv("JARVIS_PHONE_FOUNDER_USER_ID", founder);
    vi.stubEnv("JARVIS_PHONE_VERIFICATION_SECRET", "a-verification-secret-that-is-long-enough-01234");
    vi.stubEnv("JARVIS_FOUNDER_PHONE_E164", "+14165551234");
    await authenticateAs(admin);

    const response = (await (await POST_PASSCODE(new Request("https://app.lynq.build/x", { method: "POST" }), phoneParams(organizationId))).json()) as {
      data: { cleared: boolean };
    };
    expect(response.data.cleared).toBe(false);

    const audited = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.eventType, "jarvis_phone_verification_lockout_cleared")));
    expect(audited).toHaveLength(0);
  });
});

describe("POST /jarvis/phone/commands/[commandId] — deciding", () => {
  it("refuses a member of the same organization", async () => {
    const owner = await makeUser();
    const organizationId = await makeOrg(owner);
    const command = await openGatedCommand(organizationId, owner);

    const member = await makeUser();
    await addMember(organizationId, member, "member");
    await authenticateAs(member);

    const response = await POST_DECISION(decisionRequest("approve"), decisionParams(organizationId, command.id));

    expect(response.status).toBeGreaterThanOrEqual(400);
    const settled = await db.select().from(jarvisPhoneCommands).where(eq(jarvisPhoneCommands.id, command.id));
    expect(settled[0].dispatchState).toBe("awaiting_approval");
  });

  it("returns 404 for a command id belonging to another organization", async () => {
    const ownerA = await makeUser();
    const orgA = await makeOrg(ownerA);
    const command = await openGatedCommand(orgA, ownerA);

    const ownerB = await makeUser();
    const orgB = await makeOrg(ownerB);
    await authenticateAs(ownerB);

    const response = await POST_DECISION(decisionRequest("decline"), decisionParams(orgB, command.id));

    expect(response.status).toBe(404);
    const settled = await db.select().from(jarvisPhoneCommands).where(eq(jarvisPhoneCommands.id, command.id));
    expect(settled[0].dispatchState).toBe("awaiting_approval");
  });

  it("records the approver on the row before doing any work, and decides only once", async () => {
    const owner = await makeUser();
    const organizationId = await makeOrg(owner);
    const command = await openGatedCommand(organizationId, owner);
    await authenticateAs(owner);

    const first = await POST_DECISION(decisionRequest("decline"), decisionParams(organizationId, command.id));
    expect(first.status).toBe(200);

    const settled = await db.select().from(jarvisPhoneCommands).where(eq(jarvisPhoneCommands.id, command.id));
    expect(settled[0].dispatchState).toBe("declined");
    expect(settled[0].approvalDecidedByUserId).toBe(owner);

    // A second decision on a settled command changes nothing. The row is the
    // authority, not the request that arrives second.
    const second = await POST_DECISION(decisionRequest("approve"), decisionParams(organizationId, command.id));
    expect(second.status).toBeGreaterThanOrEqual(400);
    const unchanged = await db.select().from(jarvisPhoneCommands).where(eq(jarvisPhoneCommands.id, command.id));
    expect(unchanged[0].dispatchState).toBe("declined");
    expect(unchanged[0].projectId).toBeNull();
  });

  /**
   * Round six moved the approver write and its audit row to BEFORE the
   * dispatch, and made that write the decide-once guard rather than leaving it
   * to the dispatch claim.
   *
   * What this asserts is the guard itself: the second of two simultaneous
   * approvals is refused with `command_already_decided`, having changed and
   * recorded nothing, and the row carries exactly one approver. The winning
   * request's own outcome is deliberately not asserted — the success branch
   * schedules background work through `after()`, which needs a real Next
   * request scope that a direct handler call does not provide.
   */
  it("refuses the second of two simultaneous approvals rather than deciding twice", async () => {
    const owner = await makeUser();
    const organizationId = await makeOrg(owner);
    const command = await openGatedCommand(organizationId, owner);
    await authenticateAs(owner);

    const responses = await Promise.all([
      POST_DECISION(decisionRequest("approve"), decisionParams(organizationId, command.id)),
      POST_DECISION(decisionRequest("approve"), decisionParams(organizationId, command.id)),
    ]);
    const bodies = (await Promise.all(responses.map((response) => response.json()))) as Array<{ error?: { code?: string } }>;

    // Exactly one request was refused as already decided; it is never two
    // approvals, and never two silent successes.
    const refused = bodies.filter((body) => body.error?.code === "command_already_decided");
    expect(refused).toHaveLength(1);

    const settled = await db.select().from(jarvisPhoneCommands).where(eq(jarvisPhoneCommands.id, command.id));
    expect(settled[0].approvalDecidedByUserId).toBe(owner);
    // The approver is on the row before any project exists, so a handoff that
    // dies part-way still leaves a record of who authorized it.
    expect(settled[0].approvalDecidedAt).toBeTruthy();

    const decisions = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.targetId, command.id)));
    expect(decisions.filter((row) => row.eventType === "jarvis_phone_command_decided")).toHaveLength(1);
  });

  /**
   * The follow-up to the case above, at the route level: once a decision has
   * been made, a second admin arriving later is refused and the first
   * approver's identity survives.
   *
   * This does NOT isolate the decide-once guard itself — by the time the
   * second request arrives the first has already moved the command out of
   * `awaiting_approval`, so the route's own state check refuses it before the
   * guard is reached. The guard is exercised directly in
   * `call-store.integration.test.ts`, where the state can be held still.
   */
  it("keeps the first approver on the record when a second admin arrives later", async () => {
    const owner = await makeUser();
    const organizationId = await makeOrg(owner);
    const admin = await makeUser();
    await addMember(organizationId, admin, "admin");
    const command = await openGatedCommand(organizationId, owner);

    const { rawToken: ownerToken } = await createSession(db, { userId: owner });
    const { rawToken: adminToken } = await createSession(db, { userId: admin });

    cookieStore.set(SESSION_COOKIE_NAME, ownerToken);
    await POST_DECISION(decisionRequest("approve"), decisionParams(organizationId, command.id));

    // The second admin loads the screen fresh — so they hold the CURRENT
    // revision, not a stale one — and then approves.
    const current = await db.select().from(jarvisPhoneCommands).where(eq(jarvisPhoneCommands.id, command.id));
    expect(current[0].revision).toBeGreaterThan(command.revision);
    expect(current[0].approvalDecidedByUserId).toBe(owner);

    cookieStore.set(SESSION_COOKIE_NAME, adminToken);
    const second = await POST_DECISION(decisionRequest("approve"), decisionParams(organizationId, command.id));
    expect(second.status).toBeGreaterThanOrEqual(400);

    const settled = await db.select().from(jarvisPhoneCommands).where(eq(jarvisPhoneCommands.id, command.id));
    // The first approver's identity survives. It is the record of who
    // authorized work that may already be running.
    expect(settled[0].approvalDecidedByUserId).toBe(owner);

    const decisions = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.targetId, command.id)));
    expect(decisions.filter((row) => row.eventType === "jarvis_phone_command_decided")).toHaveLength(1);
  });

  it("refuses to retry a command that has never been dispatched", async () => {
    // The safety property the retry path rests on: a command still awaiting
    // approval cannot be retried into existence.
    const owner = await makeUser();
    const organizationId = await makeOrg(owner);
    const command = await openGatedCommand(organizationId, owner);
    await authenticateAs(owner);

    const response = await POST_DECISION(decisionRequest("retry"), decisionParams(organizationId, command.id));

    expect(response.status).toBeGreaterThanOrEqual(400);
    const settled = await db.select().from(jarvisPhoneCommands).where(eq(jarvisPhoneCommands.id, command.id));
    expect(settled[0].dispatchState).toBe("awaiting_approval");
    expect(settled[0].projectId).toBeNull();
  });
});
