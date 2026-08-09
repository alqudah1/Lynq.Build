import { describe, it, expect, afterEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db, makeUser, makeOrgWithOwner, makeAgentWithCredential, grantAgentCapability, authedRequest, cleanupAgentRuntimeTestData } from "@/lib/agent-runtime/test-helpers";
import { createSession } from "@/lib/auth/session";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";
import { revokeAgentCredential } from "@/lib/agents/credentials";
import { auditLogs } from "@/db/schema";

const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (cookieStore.has(name) ? { name, value: cookieStore.get(name) } : undefined),
      set: (name: string, value: string) => cookieStore.set(name, value),
      delete: (name: string) => cookieStore.delete(name),
    }),
}));

import { GET as LIST_EXECUTIONS, POST as CREATE_EXECUTION } from "./route";
import { GET as GET_EXECUTION } from "./[executionId]/route";
import { POST as ASSIGN } from "./[executionId]/assign/route";
import { POST as START } from "./[executionId]/start/route";
import { POST as ADVANCE } from "./[executionId]/advance/route";
import { POST as PLANS } from "./[executionId]/plans/route";

afterEach(async () => {
  cookieStore.clear();
  await cleanupAgentRuntimeTestData();
});

async function authenticateAs(userId: string): Promise<void> {
  const { rawToken } = await createSession(db, { userId });
  cookieStore.set(SESSION_COOKIE_NAME, rawToken);
}

describe("agent-executions routes", () => {
  it("full flow via routes: create -> assign -> start -> advance (agent-authenticated) -> plan", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { agent, secret } = await makeAgentWithCredential(orgId, ownerId);
    await grantAgentCapability(orgId, ownerId, agent.id, "identity", "read");
    await authenticateAs(ownerId);

    const createRes = await CREATE_EXECUTION(
      new Request("https://platform.example.com/x", {
        method: "POST",
        body: JSON.stringify({ goal: "Ship the newsletter", successCriteria: "Sent", failureCriteria: "Not sent", domainsRequested: ["identity"] }),
      }),
      { params: Promise.resolve({ organizationId: orgId }) }
    );
    expect(createRes.status).toBe(201);
    const execution = (await createRes.json()).data;

    const listRes = await LIST_EXECUTIONS(new Request("https://platform.example.com/x"), { params: Promise.resolve({ organizationId: orgId }) });
    expect(listRes.status).toBe(200);
    expect((await listRes.json()).data.executions).toHaveLength(1);

    const assignRes = await ASSIGN(new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ assignedAgentId: agent.id }) }), {
      params: Promise.resolve({ organizationId: orgId, executionId: execution.id }),
    });
    expect(assignRes.status).toBe(200);

    const startRes = await START(new Request("https://platform.example.com/x", { method: "POST" }), { params: Promise.resolve({ organizationId: orgId, executionId: execution.id }) });
    expect(startRes.status).toBe(200);
    expect((await startRes.json()).data.status).toBe("gathering_context");

    const advanceRes = await ADVANCE(
      authedRequest("https://platform.example.com/x", secret, { method: "POST", body: JSON.stringify({ toStatus: "planning" }) }),
      { params: Promise.resolve({ organizationId: orgId, executionId: execution.id }) }
    );
    expect(advanceRes.status).toBe(200);
    expect((await advanceRes.json()).data.status).toBe("planning");

    const planRes = await PLANS(
      authedRequest("https://platform.example.com/x", secret, { method: "POST", body: JSON.stringify({ steps: ["Draft copy", "Send"] }) }),
      { params: Promise.resolve({ organizationId: orgId, executionId: execution.id }) }
    );
    expect(planRes.status).toBe(201);
    const planBody = (await planRes.json()).data;
    expect(planBody.steps).toHaveLength(2);

    const getRes = await GET_EXECUTION(new Request("https://platform.example.com/x"), { params: Promise.resolve({ organizationId: orgId, executionId: execution.id }) });
    expect(getRes.status).toBe(200);
  });

  it("cross-tenant: an execution in org A is invisible (404) to a human authenticated in org B", async () => {
    const ownerA = await makeUser();
    const ownerB = await makeUser();
    const orgA = await makeOrgWithOwner(ownerA);
    const orgB = await makeOrgWithOwner(ownerB);
    await authenticateAs(ownerA);

    const createRes = await CREATE_EXECUTION(
      new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ goal: "g", successCriteria: "s", failureCriteria: "f", domainsRequested: ["identity"] }) }),
      { params: Promise.resolve({ organizationId: orgA }) }
    );
    const execution = (await createRes.json()).data;

    await authenticateAs(ownerB);
    const getRes = await GET_EXECUTION(new Request("https://platform.example.com/x"), { params: Promise.resolve({ organizationId: orgB, executionId: execution.id }) });
    expect(getRes.status).toBe(404);
  });

  it("cross-tenant: an agent credential from org A cannot advance an execution addressed under org B's path (404)", async () => {
    const ownerA = await makeUser();
    const ownerB = await makeUser();
    const orgA = await makeOrgWithOwner(ownerA);
    const orgB = await makeOrgWithOwner(ownerB);
    const { agent: agentA, secret: secretA } = await makeAgentWithCredential(orgA, ownerA);
    await grantAgentCapability(orgA, ownerA, agentA.id, "identity", "read");
    await authenticateAs(ownerB);

    const createRes = await CREATE_EXECUTION(
      new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ goal: "g", successCriteria: "s", failureCriteria: "f", domainsRequested: ["identity"] }) }),
      { params: Promise.resolve({ organizationId: orgB }) }
    );
    const executionB = (await createRes.json()).data;

    const advanceRes = await ADVANCE(
      authedRequest("https://platform.example.com/x", secretA, { method: "POST", body: JSON.stringify({ toStatus: "planning" }) }),
      { params: Promise.resolve({ organizationId: orgB, executionId: executionB.id }) }
    );
    expect(advanceRes.status).toBe(404);
  });

  it("a revoked agent credential fails immediately (401) when used against a runtime route", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { agent, secret } = await makeAgentWithCredential(orgId, ownerId);
    await authenticateAs(ownerId);

    const createRes = await CREATE_EXECUTION(
      new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ goal: "g", successCriteria: "s", failureCriteria: "f", domainsRequested: ["identity"] }) }),
      { params: Promise.resolve({ organizationId: orgId }) }
    );
    const execution = (await createRes.json()).data;

    const { listAgentCredentials } = await import("@/lib/agents/credentials");
    const credentials = await listAgentCredentials(db, { organizationId: orgId, agentId: agent.id, actorUserId: ownerId });
    await revokeAgentCredential(db, { organizationId: orgId, agentId: agent.id, credentialId: credentials[0].id, actorUserId: ownerId });

    const advanceRes = await ADVANCE(
      authedRequest("https://platform.example.com/x", secret, { method: "POST", body: JSON.stringify({ toStatus: "planning" }) }),
      { params: Promise.resolve({ organizationId: orgId, executionId: execution.id }) }
    );
    expect(advanceRes.status).toBe(401);
  });

  it("no raw secret ever appears in the audit log for this organization's runtime activity", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const { agent, secret } = await makeAgentWithCredential(orgId, ownerId);
    await grantAgentCapability(orgId, ownerId, agent.id, "identity", "read");
    await authenticateAs(ownerId);

    const createRes = await CREATE_EXECUTION(
      new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ goal: "g", successCriteria: "s", failureCriteria: "f", domainsRequested: ["identity"] }) }),
      { params: Promise.resolve({ organizationId: orgId }) }
    );
    const execution = (await createRes.json()).data;
    await ASSIGN(new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ assignedAgentId: agent.id }) }), { params: Promise.resolve({ organizationId: orgId, executionId: execution.id }) });
    await START(new Request("https://platform.example.com/x", { method: "POST" }), { params: Promise.resolve({ organizationId: orgId, executionId: execution.id }) });
    await ADVANCE(authedRequest("https://platform.example.com/x", secret, { method: "POST", body: JSON.stringify({ toStatus: "planning" }) }), { params: Promise.resolve({ organizationId: orgId, executionId: execution.id }) });

    const rows = await db.select().from(auditLogs).where(sql`${auditLogs.organizationId} = ${orgId}`);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const serialized = JSON.stringify(row.metadata ?? {});
      expect(serialized.includes(secret)).toBe(false);
    }
  });
});
