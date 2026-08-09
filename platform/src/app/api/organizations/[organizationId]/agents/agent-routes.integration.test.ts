import { describe, it, expect, afterEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, agents, agentVersions, agentCredentials } from "@/db/schema";
import { createSession } from "@/lib/auth/session";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";

const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (cookieStore.has(name) ? { name, value: cookieStore.get(name) } : undefined),
      set: (name: string, value: string) => cookieStore.set(name, value),
      delete: (name: string) => cookieStore.delete(name),
    }),
}));

import { GET as LIST_AGENTS, POST as REGISTER_AGENT } from "./route";
import { GET as GET_AGENT, PATCH as UPDATE_AGENT } from "./[agentId]/route";
import { POST as ADVANCE } from "./[agentId]/advance/route";
import { POST as RETIRE } from "./[agentId]/retire/route";
import { POST as CHANGE_PERMISSION_LEVEL } from "./[agentId]/permission-level/route";
import { POST as ISSUE_CREDENTIAL, GET as LIST_CREDENTIALS } from "./[agentId]/credentials/route";
import { POST as REVOKE_CREDENTIAL } from "./[agentId]/credentials/[credentialId]/revoke/route";

const env = loadEnv();
const db = createDbClient(env);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `agent-registry-route-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Agent Registry Route Org", slug: `agent-registry-route-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: ownerId, role: "owner" });
  createdOrgIds.push(org.id);
  return org.id;
}

async function authenticateAs(userId: string): Promise<void> {
  const { rawToken } = await createSession(db, { userId });
  cookieStore.set(SESSION_COOKIE_NAME, rawToken);
}

const anatomyBody = {
  name: "Compliance Line-Checker",
  department: "legal_and_compliance",
  purpose: "Flag regulated-content claims before publication",
  responsibilities: "Scans marketing copy for unverified regulatory claims",
  goals: "Zero regulatory claims that Legal would reject",
  inputs: "Draft marketing copy, Brain Identity + Governance domains",
  outputs: "An approve/flag verdict with the specific claim highlighted",
  successCriteria: "No flagged-safe claim is later rejected by Legal",
  failureCriteria: "A real compliance risk is missed",
  retirementCriteria: "Legal adopts a different review process",
  humanOwnerUserId: "",
  permissionLevel: "assistant",
};

afterEach(async () => {
  cookieStore.clear();
  while (createdOrgIds.length > 0) {
    const id = createdOrgIds.pop()!;
    await db.delete(agentCredentials).where(sql`${agentCredentials.agentId} IN (SELECT id FROM agents WHERE organization_id = ${id})`);
    await db.delete(agentVersions).where(sql`${agentVersions.agentId} IN (SELECT id FROM agents WHERE organization_id = ${id})`);
    await db.delete(agents).where(sql`${agents.organizationId} = ${id}`);
    await db.delete(organizations).where(sql`${organizations.id} = ${id}`);
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await db.delete(users).where(sql`${users.id} = ${id}`);
  }
});

describe("agent registry routes", () => {
  it("registers, lists, gets, and updates an agent through the routes", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await authenticateAs(ownerId);

    const registerRes = await REGISTER_AGENT(
      new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ ...anatomyBody, humanOwnerUserId: ownerId }) }),
      { params: Promise.resolve({ organizationId: orgId }) }
    );
    expect(registerRes.status).toBe(201);
    const agent = (await registerRes.json()).data;
    expect(agent.lifecycleStage).toBe("idea");

    const listRes = await LIST_AGENTS(new Request("https://platform.example.com/x"), { params: Promise.resolve({ organizationId: orgId }) });
    expect(listRes.status).toBe(200);
    expect((await listRes.json()).data.agents).toHaveLength(1);

    const getRes = await GET_AGENT(new Request("https://platform.example.com/x"), { params: Promise.resolve({ organizationId: orgId, agentId: agent.id }) });
    expect(getRes.status).toBe(200);

    const updateRes = await UPDATE_AGENT(
      new Request("https://platform.example.com/x", { method: "PATCH", body: JSON.stringify({ expectedVersionNumber: 1, updates: { goals: "Sharper goal statement" } }) }),
      { params: Promise.resolve({ organizationId: orgId, agentId: agent.id }) }
    );
    expect(updateRes.status).toBe(200);
    const updated = (await updateRes.json()).data;
    expect(updated.currentVersionNumber).toBe(2);
    expect(updated.goals).toBe("Sharper goal statement");
  });

  it("walks the full lifecycle through the routes: idea -> approval forces observer -> deployment -> permission bump -> retire", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await authenticateAs(ownerId);

    const registerRes = await REGISTER_AGENT(
      new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ ...anatomyBody, humanOwnerUserId: ownerId, permissionLevel: "manager" }) }),
      { params: Promise.resolve({ organizationId: orgId }) }
    );
    const agent = (await registerRes.json()).data;
    const paramsFor = () => Promise.resolve({ organizationId: orgId, agentId: agent.id });

    for (const toStage of ["specification", "development", "testing"]) {
      const res = await ADVANCE(new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ toStage }) }), { params: paramsFor() });
      expect(res.status).toBe(200);
    }

    const approveRes = await ADVANCE(new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ toStage: "approval" }) }), { params: paramsFor() });
    expect(approveRes.status).toBe(200);
    const approved = (await approveRes.json()).data;
    expect(approved.permissionLevel).toBe("observer");

    const deployRes = await ADVANCE(new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ toStage: "deployment" }) }), { params: paramsFor() });
    expect(deployRes.status).toBe(200);

    const permissionRes = await CHANGE_PERMISSION_LEVEL(
      new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ newPermissionLevel: "operator", reason: "clean track record" }) }),
      { params: paramsFor() }
    );
    expect(permissionRes.status).toBe(200);
    expect((await permissionRes.json()).data.permissionLevel).toBe("operator");

    const retireRes = await RETIRE(new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ reason: "test complete" }) }), { params: paramsFor() });
    expect(retireRes.status).toBe(200);
    expect((await retireRes.json()).data.lifecycleStage).toBe("retired");

    const skipRes = await ADVANCE(new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ toStage: "monitoring" }) }), { params: paramsFor() });
    expect(skipRes.status).toBe(409);
  });

  it("issues, lists, and revokes a credential through the routes; unauthenticated requests are 401", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await authenticateAs(ownerId);

    const registerRes = await REGISTER_AGENT(
      new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ ...anatomyBody, humanOwnerUserId: ownerId }) }),
      { params: Promise.resolve({ organizationId: orgId }) }
    );
    const agent = (await registerRes.json()).data;
    const paramsFor = () => Promise.resolve({ organizationId: orgId, agentId: agent.id });

    const issueRes = await ISSUE_CREDENTIAL(new Request("https://platform.example.com/x", { method: "POST" }), { params: paramsFor() });
    expect(issueRes.status).toBe(201);
    const { credential, plaintextSecret } = (await issueRes.json()).data;
    expect(typeof plaintextSecret).toBe("string");
    expect(credential.keyPrefix).toBeDefined();

    const listRes = await LIST_CREDENTIALS(new Request("https://platform.example.com/x"), { params: paramsFor() });
    expect(listRes.status).toBe(200);
    expect((await listRes.json()).data.credentials).toHaveLength(1);

    const revokeRes = await REVOKE_CREDENTIAL(new Request("https://platform.example.com/x", { method: "POST" }), {
      params: Promise.resolve({ organizationId: orgId, agentId: agent.id, credentialId: credential.id }),
    });
    expect(revokeRes.status).toBe(200);

    cookieStore.clear();
    const unauthRes = await LIST_CREDENTIALS(new Request("https://platform.example.com/x"), { params: paramsFor() });
    expect(unauthRes.status).toBe(401);
  });

  it("rejects agent registration from a non-owner/admin member with 403", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await db.insert(organizationMemberships).values({ organizationId: orgId, userId: memberId, role: "member" });
    await authenticateAs(memberId);

    const registerRes = await REGISTER_AGENT(
      new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ ...anatomyBody, humanOwnerUserId: ownerId }) }),
      { params: Promise.resolve({ organizationId: orgId }) }
    );
    expect(registerRes.status).toBe(403);
  });
});
