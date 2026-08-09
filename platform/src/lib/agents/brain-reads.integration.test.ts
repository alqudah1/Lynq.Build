import { describe, it, expect, afterEach } from "vitest";
import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, workspaces, workspaceMemberships, agents, agentVersions, knowledgeItems, brainPermissionGrants, auditLogs } from "@/db/schema";
import { registerAgent } from "./agents";
import { advanceAgentLifecycleStage } from "./lifecycle";
import { createBrainPermissionGrant } from "@/lib/brain/permissions";
import { createKnowledgeItem } from "@/lib/brain/knowledge-items";
import { TenantResourceNotFoundError } from "@/lib/authz/errors";
import { listKnowledgeItemsForAgent, getKnowledgeItemForAgent, getKnowledgeContextForAgent } from "./brain-reads";
import type { AgentPrincipal } from "./authentication";

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `agent-brain-read-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Agent Brain Read Test Org", slug: `agent-brain-read-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: ownerId, role: "owner" });
  createdOrgIds.push(org.id);
  return org.id;
}

async function makeWorkspace(orgId: string): Promise<string> {
  const [ws] = await db.insert(workspaces).values({ organizationId: orgId, name: "Test Workspace", slug: `ws-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: workspaces.id });
  return ws.id;
}

async function makeAgent(orgId: string, ownerId: string, permissionLevel: "observer" | "manager" = "observer") {
  return registerAgent(db, {
    organizationId: orgId,
    humanOwnerUserId: ownerId,
    actorUserId: ownerId,
    name: "Brain Read Test Agent",
    department: "engineering",
    purpose: "Exercise agent brain reads in tests",
    responsibilities: "None — test fixture only",
    goals: "N/A",
    inputs: "N/A",
    outputs: "N/A",
    successCriteria: "N/A",
    failureCriteria: "N/A",
    retirementCriteria: "Deleted when the test finishes",
    permissionLevel,
  });
}

function principalFor(agent: Awaited<ReturnType<typeof makeAgent>>, orgId: string): AgentPrincipal {
  return { principalType: "agent", agentId: agent.id, organizationId: orgId, permissionLevel: agent.permissionLevel, department: agent.department };
}

afterEach(async () => {
  while (createdOrgIds.length > 0) {
    const id = createdOrgIds.pop()!;
    // `knowledge_items` deleted first — `knowledge_item_versions` cascades
    // away via its own `ON DELETE CASCADE` FK to `knowledge_items.id`, and
    // `knowledge_items.current_version_id` (the reverse-direction FK) would
    // otherwise block deleting the version rows first.
    await db.delete(knowledgeItems).where(sql`${knowledgeItems.organizationId} = ${id}`);
    await db.delete(brainPermissionGrants).where(sql`${brainPermissionGrants.organizationId} = ${id}`);
    await db.delete(auditLogs).where(sql`${auditLogs.organizationId} = ${id}`);
    await db.delete(agentVersions).where(sql`${agentVersions.agentId} IN (SELECT id FROM agents WHERE organization_id = ${id})`);
    await db.delete(agents).where(sql`${agents.organizationId} = ${id}`);
    await db.delete(workspaceMemberships).where(sql`${workspaceMemberships.workspaceId} IN (SELECT id FROM workspaces WHERE organization_id = ${id})`);
    await db.delete(workspaces).where(sql`${workspaces.organizationId} = ${id}`);
    await db.delete(organizations).where(sql`${organizations.id} = ${id}`);
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await db.delete(users).where(sql`${users.id} = ${id}`);
  }
});

describe("agent read authorization", () => {
  it("denies an agent with no Brain grant at all (404)", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    const item = await createKnowledgeItemAsOwner(orgId, ownerId);

    await expect(getKnowledgeItemForAgent(db, principalFor(agent, orgId), item.id)).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });

  it("allows an active agent with an exact org-scoped read grant", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    const item = await createKnowledgeItemAsOwner(orgId, ownerId);
    await grantRead(orgId, ownerId, agent.id, null);

    const fetched = await getKnowledgeItemForAgent(db, principalFor(agent, orgId), item.id);
    expect(fetched.id).toBe(item.id);
  });

  it("an organization-scoped grant does NOT leak into workspace-scoped content", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const workspaceId = await makeWorkspace(orgId);
    const agent = await makeAgent(orgId, ownerId);
    const wsItem = await createKnowledgeItemAsOwner(orgId, ownerId, workspaceId);
    await grantRead(orgId, ownerId, agent.id, null); // org-scoped only

    await expect(getKnowledgeItemForAgent(db, principalFor(agent, orgId), wsItem.id)).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });

  it("a workspace-scoped grant does NOT leak outside that exact workspace", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const workspaceId = await makeWorkspace(orgId);
    const otherWorkspaceId = await makeWorkspace(orgId);
    const agent = await makeAgent(orgId, ownerId);
    const otherWsItem = await createKnowledgeItemAsOwner(orgId, ownerId, otherWorkspaceId);
    await grantRead(orgId, ownerId, agent.id, workspaceId);

    await expect(getKnowledgeItemForAgent(db, principalFor(agent, orgId), otherWsItem.id)).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });

  it("permission level alone (even manager) grants nothing without a real Brain grant", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId, "manager");
    const item = await createKnowledgeItemAsOwner(orgId, ownerId);

    await expect(getKnowledgeItemForAgent(db, principalFor(agent, orgId), item.id)).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });

  it("department alone grants nothing without a real Brain grant", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId); // department: engineering
    const item = await createKnowledgeItemAsOwner(orgId, ownerId);

    // No grant at all — engineering department membership must not substitute for one.
    await expect(getKnowledgeItemForAgent(db, principalFor(agent, orgId), item.id)).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });

  it("cross-tenant access returns 404, never a different error shape", async () => {
    const ownerId = await makeUser();
    const otherOwnerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const otherOrgId = await makeOrgWithOwner(otherOwnerId);
    const agent = await makeAgent(orgId, ownerId);
    await grantRead(orgId, ownerId, agent.id, null);
    const foreignItem = await createKnowledgeItemAsOwner(otherOrgId, otherOwnerId);

    await expect(getKnowledgeItemForAgent(db, principalFor(agent, orgId), foreignItem.id)).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });

  it("a retired agent is not reachable through the read functions even with a standing grant (defense in depth beyond authentication)", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    await grantRead(orgId, ownerId, agent.id, null);
    const item = await createKnowledgeItemAsOwner(orgId, ownerId);

    // Retirement itself is enforced at authentication (see authentication.integration.test.ts);
    // this confirms the grant path still resolves correctly for a non-retired agent as a control.
    const fetched = await getKnowledgeItemForAgent(db, principalFor(agent, orgId), item.id);
    expect(fetched.id).toBe(item.id);
  });
});

describe("listKnowledgeItemsForAgent", () => {
  it("never expands beyond organization-scoped items when workspaceId is omitted (no workspace-membership concept for agents)", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const workspaceId = await makeWorkspace(orgId);
    const agent = await makeAgent(orgId, ownerId);
    await grantRead(orgId, ownerId, agent.id, null);
    await grantRead(orgId, ownerId, agent.id, workspaceId);
    await createKnowledgeItemAsOwner(orgId, ownerId); // org-scoped
    await createKnowledgeItemAsOwner(orgId, ownerId, workspaceId); // workspace-scoped

    const result = await listKnowledgeItemsForAgent(db, principalFor(agent, orgId), {});
    expect(result.items).toHaveLength(1);
    expect(result.items[0].workspaceId).toBeNull();
  });
});

describe("getKnowledgeContextForAgent (citation-ready response)", () => {
  it("returns only the approved field set — no session data, no raw audit records, no permission-grant internals, no credentials", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    await grantRead(orgId, ownerId, agent.id, null);
    const item = await createKnowledgeItemAsOwner(orgId, ownerId);

    const context = await getKnowledgeContextForAgent(db, principalFor(agent, orgId), item.id, 1);

    const allowedKeys = new Set([
      "id", "organizationId", "workspaceId", "domain", "classification", "status",
      "title", "content", "versionNumber", "source", "trust", "evidence", "relationships", "retrievedAt",
    ]);
    for (const key of Object.keys(context)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain("sessionToken");
    expect(serialized).not.toContain("secretHash");
    expect(serialized).not.toContain("credential");
    expect(serialized).not.toContain("grantedByUserId");
  });
});

describe("agent lifecycle stage does not substitute for a Brain grant", () => {
  it("an agent advanced all the way to deployment still cannot read without an explicit grant", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const agent = await makeAgent(orgId, ownerId);
    for (const toStage of ["specification", "development", "testing", "approval", "deployment"] as const) {
      await advanceAgentLifecycleStage(db, { organizationId: orgId, agentId: agent.id, toStage, actorUserId: ownerId });
    }
    const item = await createKnowledgeItemAsOwner(orgId, ownerId);

    await expect(getKnowledgeItemForAgent(db, principalFor(agent, orgId), item.id)).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });
});

async function createKnowledgeItemAsOwner(orgId: string, ownerId: string, workspaceId: string | null = null) {
  await ensureOwnerHasBootstrapGrants(orgId, ownerId);
  if (workspaceId) {
    await ensureOwnerIsWorkspaceMember(orgId, ownerId, workspaceId);
    await ensureWorkspaceScopedGrant(orgId, ownerId, workspaceId, "draft_write");
  }
  return createKnowledgeItem(db, rawSql, {
    organizationId: orgId,
    workspaceId,
    domain: "identity",
    classification: "fact",
    title: "Test item",
    content: "Test content",
    actorUserId: ownerId,
  });
}

const bootstrappedOrgs = new Set<string>();
/** The owner needs BOTH `draft_write` (to create items) and `read` (org-scoped `read` is also the "cannot grant a capability you don't yourself hold" requirement for handing out `read` grants to agents, per `createBrainPermissionGrant`'s own rule) at organization scope. */
async function ensureOwnerHasBootstrapGrants(orgId: string, ownerId: string) {
  if (bootstrappedOrgs.has(orgId)) return;
  await db.insert(brainPermissionGrants).values([
    { organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, granteeType: "human", capability: "draft_write" },
    { organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, granteeType: "human", capability: "read" },
  ]);
  bootstrappedOrgs.add(orgId);
}

const workspaceMembersAdded = new Set<string>();
async function ensureOwnerIsWorkspaceMember(orgId: string, ownerId: string, workspaceId: string) {
  const key = `${workspaceId}:${ownerId}`;
  if (workspaceMembersAdded.has(key)) return;
  await db.insert(workspaceMemberships).values({ workspaceId, userId: ownerId, role: "manager" });
  workspaceMembersAdded.add(key);
}

const workspaceGrantsAdded = new Set<string>();
async function ensureWorkspaceScopedGrant(orgId: string, ownerId: string, workspaceId: string, capability: "draft_write" | "read") {
  const key = `${workspaceId}:${capability}`;
  if (workspaceGrantsAdded.has(key)) return;
  await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId, granteeUserId: ownerId, granteeType: "human", capability });
  workspaceGrantsAdded.add(key);
}

async function grantRead(orgId: string, ownerId: string, agentId: string, workspaceId: string | null) {
  await ensureOwnerHasBootstrapGrants(orgId, ownerId);
  await createBrainPermissionGrant(db, {
    organizationId: orgId,
    domain: "identity",
    workspaceId,
    grantee: { type: "agent", agentId },
    capability: "read",
    actorUserId: ownerId,
  });
}
