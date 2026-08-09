import { describe, it, expect, afterEach, vi } from "vitest";
import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, workspaces, workspaceMemberships, knowledgeItems, auditLogs, brainPermissionGrants } from "@/db/schema";
import type { BrainCapability } from "@/lib/brain/authz";
import type { KnowledgeDomain } from "@/lib/brain/knowledge-items";
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

import { GET, PATCH } from "./route";
import { createKnowledgeItem } from "@/lib/brain/knowledge-items";

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

function create(input: Parameters<typeof createKnowledgeItem>[2]) {
  return createKnowledgeItem(db, rawSql, input);
}

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `brain-detail-route-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Detail Route Org", slug: `brain-detail-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: ownerId, role: "owner" });
  createdOrgIds.push(org.id);
  return org.id;
}

async function addOrgMember(orgId: string, userId: string, role: "member" | "viewer"): Promise<void> {
  await db.insert(organizationMemberships).values({ organizationId: orgId, userId, role });
}

async function makeWorkspace(orgId: string): Promise<string> {
  const [ws] = await db.insert(workspaces).values({ organizationId: orgId, name: "WS", slug: `ws-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: workspaces.id });
  return ws.id;
}

async function addWorkspaceMember(workspaceId: string, userId: string, role: "manager" | "member"): Promise<void> {
  await db.insert(workspaceMemberships).values({ workspaceId, userId, role });
}

async function grantCapability(
  organizationId: string,
  domain: KnowledgeDomain,
  workspaceId: string | null,
  granteeUserId: string,
  capability: BrainCapability
): Promise<void> {
  await db.insert(brainPermissionGrants).values({ organizationId, domain, workspaceId, granteeUserId, capability });
}

async function authenticateAs(userId: string): Promise<void> {
  const { rawToken } = await createSession(db, { userId });
  cookieStore.set(SESSION_COOKIE_NAME, rawToken);
}

afterEach(async () => {
  cookieStore.clear();
  while (createdOrgIds.length > 0) {
    const id = createdOrgIds.pop()!;
    await db.delete(knowledgeItems).where(sql`${knowledgeItems.organizationId} = ${id}`);
    await db.delete(auditLogs).where(sql`${auditLogs.organizationId} = ${id}`);
    await db.delete(organizations).where(sql`${organizations.id} = ${id}`);
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await db.delete(users).where(sql`${users.id} = ${id}`);
  }
});

describe("GET /api/organizations/{organizationId}/knowledge/{knowledgeItemId}", () => {
  it("returns 404 for a workspace-scoped item when the actor lacks explicit workspace membership, even as organization owner", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, memberId, "member");
    const workspaceId = await makeWorkspace(orgId);
    await addWorkspaceMember(workspaceId, memberId, "member");
    await grantCapability(orgId, "execution", workspaceId, memberId, "draft_write");

    const item = await create({ organizationId: orgId, workspaceId, domain: "execution", classification: "note", title: "t", content: "c", actorUserId: memberId });

    await authenticateAs(ownerId);
    const res = await GET(new Request("https://platform.example.com/x"), { params: Promise.resolve({ organizationId: orgId, knowledgeItemId: item.id }) });
    expect(res.status).toBe(404);
  });

  it("returns 200 for the explicit workspace member", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, memberId, "member");
    const workspaceId = await makeWorkspace(orgId);
    await addWorkspaceMember(workspaceId, memberId, "member");
    await grantCapability(orgId, "execution", workspaceId, memberId, "draft_write");
    await grantCapability(orgId, "execution", workspaceId, memberId, "read");

    const item = await create({ organizationId: orgId, workspaceId, domain: "execution", classification: "note", title: "t", content: "c", actorUserId: memberId });

    await authenticateAs(memberId);
    const res = await GET(new Request("https://platform.example.com/x"), { params: Promise.resolve({ organizationId: orgId, knowledgeItemId: item.id }) });
    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/organizations/{organizationId}/knowledge/{knowledgeItemId}", () => {
  it("returns 409 version_conflict on a lost update, never silently overwriting", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantCapability(orgId, "identity", null, ownerId, "draft_write");
    await grantCapability(orgId, "identity", null, ownerId, "edit_own_draft");
    await grantCapability(orgId, "identity", null, ownerId, "read");
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "v1", content: "c", actorUserId: ownerId });
    await authenticateAs(ownerId);

    const firstPatch = new Request("https://platform.example.com/x", { method: "PATCH", body: JSON.stringify({ expectedVersionNumber: 1, title: "v2" }) });
    const firstRes = await PATCH(firstPatch, { params: Promise.resolve({ organizationId: orgId, knowledgeItemId: item.id }) });
    expect(firstRes.status).toBe(200);

    const secondPatch = new Request("https://platform.example.com/x", { method: "PATCH", body: JSON.stringify({ expectedVersionNumber: 1, title: "lost" }) });
    const secondRes = await PATCH(secondPatch, { params: Promise.resolve({ organizationId: orgId, knowledgeItemId: item.id }) });
    expect(secondRes.status).toBe(409);
    const body = await secondRes.json();
    expect(body.error.code).toBe("version_conflict");
  });

  it("returns 403 when a plain member (not the author, not owner/admin) attempts to update", async () => {
    const ownerId = await makeUser();
    const authorId = await makeUser();
    const otherMemberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, authorId, "member");
    await addOrgMember(orgId, otherMemberId, "member");
    await grantCapability(orgId, "identity", null, authorId, "draft_write");
    // otherMemberId can read (proving the 403 is specifically about missing edit authority) but has no edit grant.
    await grantCapability(orgId, "identity", null, otherMemberId, "read");
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: authorId });

    await authenticateAs(otherMemberId);
    const res = await PATCH(new Request("https://platform.example.com/x", { method: "PATCH", body: JSON.stringify({ expectedVersionNumber: 1, title: "hijack" }) }), {
      params: Promise.resolve({ organizationId: orgId, knowledgeItemId: item.id }),
    });
    expect(res.status).toBe(403);
  });
});
