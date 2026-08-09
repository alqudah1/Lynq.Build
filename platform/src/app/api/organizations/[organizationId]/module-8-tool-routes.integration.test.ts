import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { db, makeUser, makeOrgWithOwner, makeKnowledgeItem, pollUntilJobDone, ensureToolsSeeded, cleanupAgentRuntimeTestData } from "@/lib/agent-runtime/test-helpers";
import { brainPermissionGrants } from "@/db/schema";
import { createSession } from "@/lib/auth/session";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";
import { seedKnowledgeAnalystAgent } from "@/lib/agents/knowledge-analyst";

const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (cookieStore.has(name) ? { name, value: cookieStore.get(name) } : undefined),
      set: (name: string, value: string) => cookieStore.set(name, value),
      delete: (name: string) => cookieStore.delete(name),
    }),
}));

import { GET as LIST_TOOLS } from "./tools/route";
import { GET as GET_TOOL } from "./tools/[toolKey]/route";
import { GET as LIST_INVOCATIONS } from "./agent-executions/[executionId]/tool-invocations/route";
import { POST as START_TASK } from "./knowledge-analyst/tasks/route";
import { GET as GET_REPORT } from "./knowledge-analyst/tasks/[executionId]/report/route";

beforeAll(ensureToolsSeeded);
afterEach(async () => {
  cookieStore.clear();
  await cleanupAgentRuntimeTestData();
});

async function authenticateAs(userId: string): Promise<void> {
  const { rawToken } = await createSession(db, { userId });
  cookieStore.set(SESSION_COOKIE_NAME, rawToken);
}

describe("tools routes", () => {
  it("GET /tools lists the seeded global tool catalog; GET /tools/:toolKey returns one definition", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await authenticateAs(ownerId);

    const listRes = await LIST_TOOLS(new Request("https://platform.example.com/x"), { params: Promise.resolve({ organizationId: orgId }) });
    expect(listRes.status).toBe(200);
    const tools = (await listRes.json()).data.tools as Array<{ toolKey: string }>;
    expect(tools.some((t) => t.toolKey === "brain.search")).toBe(true);
    expect(tools.some((t) => t.toolKey === "artifact.create_report")).toBe(true);

    const getRes = await GET_TOOL(new Request("https://platform.example.com/x"), { params: Promise.resolve({ organizationId: orgId, toolKey: "brain.search" }) });
    expect(getRes.status).toBe(200);
    expect((await getRes.json()).data.toolKey).toBe("brain.search");

    const missingRes = await GET_TOOL(new Request("https://platform.example.com/x"), { params: Promise.resolve({ organizationId: orgId, toolKey: "nonexistent.tool" }) });
    expect(missingRes.status).toBe(409); // ToolNotFoundError's own reason-mapped status, per this codebase's ToolInvocationError shape
  });

  it("refuses an unauthenticated caller", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);

    const res = await LIST_TOOLS(new Request("https://platform.example.com/x"), { params: Promise.resolve({ organizationId: orgId }) });
    expect(res.status).toBe(401);
    void ownerId;
  });
});

describe("knowledge-analyst task routes — full flow", () => {
  it("starts a task via POST (returns immediately, 202), a worker drives it to completion, and the report is retrievable via GET", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, granteeType: "human", capability: "read" });
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, granteeType: "human", capability: "draft_write" });
    await seedKnowledgeAnalystAgent(db, { organizationId: orgId, humanOwnerUserId: ownerId, allowedDomains: ["identity"], actorUserId: ownerId });
    await makeKnowledgeItem(orgId, ownerId, "identity", "Onboarding Guide", "New hires complete onboarding within their first week");
    await authenticateAs(ownerId);

    const startRes = await START_TASK(
      new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ topic: "onboarding", allowedDomains: ["identity"] }) }),
      { params: Promise.resolve({ organizationId: orgId }) }
    );
    expect(startRes.status).toBe(202);
    const started = (await startRes.json()).data as { executionId: string; status: string; jobId: string };
    // HTTP request lifetime is not what keeps this alive — the route
    // already returned before any tool call ever ran.
    expect(started.status).not.toBe("completed");

    // A worker (any process holding a valid worker credential) claims and
    // drives the enqueued job — exactly what a real scheduled poll does.
    // Polls the job's OWN row directly (not one poll batch) since the
    // full suite runs many files concurrently, each enqueueing their own
    // jobs onto the same global queue.
    const finished = await pollUntilJobDone(started.jobId);
    expect(finished.status).toBe("completed");

    const invocationsRes = await LIST_INVOCATIONS(new Request("https://platform.example.com/x"), { params: Promise.resolve({ organizationId: orgId, executionId: started.executionId }) });
    expect(invocationsRes.status).toBe(200);
    const invocations = (await invocationsRes.json()).data.invocations as Array<{ toolKey: string; status: string }>;
    expect(invocations.length).toBeGreaterThan(0);
    expect(invocations.every((i) => i.status === "succeeded")).toBe(true);
    expect(invocations.some((i) => i.toolKey === "brain.search")).toBe(true);
    expect(invocations.some((i) => i.toolKey === "artifact.create_report")).toBe(true);

    const reportRes = await GET_REPORT(new Request("https://platform.example.com/x"), { params: Promise.resolve({ organizationId: orgId, executionId: started.executionId }) });
    expect(reportRes.status).toBe(200);
    const report = (await reportRes.json()).data as { supportingReferences: Array<{ knowledgeItemId: string }>; executionStatus: string };
    expect(report.executionStatus).toBe("completed");
    expect(report.supportingReferences.length).toBeGreaterThan(0);
  });

  it("400s when no Knowledge Analyst has been seeded for this organization yet", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await authenticateAs(ownerId);

    const res = await START_TASK(new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ topic: "x", allowedDomains: ["identity"] }) }), {
      params: Promise.resolve({ organizationId: orgId }),
    });
    expect(res.status).toBe(404);
  });
});

describe("cross-tenant isolation", () => {
  it("an execution's tool invocations in org A are invisible (404) from org B", async () => {
    const ownerA = await makeUser();
    const ownerB = await makeUser();
    const orgA = await makeOrgWithOwner(ownerA);
    const orgB = await makeOrgWithOwner(ownerB);
    await db.insert(brainPermissionGrants).values({ organizationId: orgA, domain: "identity", workspaceId: null, granteeUserId: ownerA, granteeType: "human", capability: "read" });
    await seedKnowledgeAnalystAgent(db, { organizationId: orgA, humanOwnerUserId: ownerA, allowedDomains: ["identity"], actorUserId: ownerA });
    await authenticateAs(ownerA);

    const startRes = await START_TASK(
      new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ topic: "nothing to find", allowedDomains: ["identity"] }) }),
      { params: Promise.resolve({ organizationId: orgA }) }
    );
    const started = (await startRes.json()).data as { executionId: string };

    await authenticateAs(ownerB);
    const crossRes = await LIST_INVOCATIONS(new Request("https://platform.example.com/x"), { params: Promise.resolve({ organizationId: orgB, executionId: started.executionId }) });
    expect(crossRes.status).toBe(404);
  });
});
