import { describe, it, expect, afterEach, vi } from "vitest";
import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, knowledgeItems, auditLogs, brainPermissionGrants } from "@/db/schema";
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

import { POST as CREATE } from "./route";
import { GET as GET_ONE } from "./[relationshipId]/route";
import { POST as ARCHIVE } from "./[relationshipId]/archive/route";
import { GET as LIST_FOR_ITEM } from "../knowledge/[knowledgeItemId]/relationships/route";
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
  const [user] = await db.insert(users).values({ email: `brain-rel-route-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Rel Route Org", slug: `brain-rel-route-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: ownerId, role: "owner" });
  createdOrgIds.push(org.id);
  return org.id;
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

async function grantAllCapabilities(organizationId: string, domain: KnowledgeDomain, workspaceId: string | null, granteeUserId: string): Promise<void> {
  const capabilities: BrainCapability[] = ["read", "draft_write", "edit_own_draft", "edit_any_draft", "archive"];
  for (const capability of capabilities) {
    await grantCapability(organizationId, domain, workspaceId, granteeUserId, capability);
  }
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

describe("POST /api/organizations/{organizationId}/knowledge-relationships", () => {
  it("returns 401 when unauthenticated", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const a = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "A", content: "c", actorUserId: ownerId });
    const b = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "B", content: "c", actorUserId: ownerId });

    const res = await CREATE(
      new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ sourceItemId: a.id, targetItemId: b.id, relationshipType: "supports" }) }),
      { params: Promise.resolve({ organizationId: orgId }) }
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 for an invalid relationship type", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const a = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "A", content: "c", actorUserId: ownerId });
    const b = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "B", content: "c", actorUserId: ownerId });
    await authenticateAs(ownerId);

    const res = await CREATE(
      new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ sourceItemId: a.id, targetItemId: b.id, relationshipType: "not-a-type" }) }),
      { params: Promise.resolve({ organizationId: orgId }) }
    );
    expect(res.status).toBe(400);
  });

  it("returns 201 and creates the relationship for an authorized actor", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const a = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "A", content: "c", actorUserId: ownerId });
    const b = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "B", content: "c", actorUserId: ownerId });
    await authenticateAs(ownerId);

    const res = await CREATE(
      new Request("https://platform.example.com/x", {
        method: "POST",
        body: JSON.stringify({ sourceItemId: a.id, targetItemId: b.id, relationshipType: "supports", explanation: "because" }),
      }),
      { params: Promise.resolve({ organizationId: orgId }) }
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.relationshipType).toBe("supports");
    expect(body.data.explanation).toBe("because");
  });

  it("returns 409 self_relationship for a self-link", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const a = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "A", content: "c", actorUserId: ownerId });
    await authenticateAs(ownerId);

    const res = await CREATE(
      new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ sourceItemId: a.id, targetItemId: a.id, relationshipType: "related_to" }) }),
      { params: Promise.resolve({ organizationId: orgId }) }
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("self_relationship");
  });

  it("returns 409 duplicate_relationship on a repeat create", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const a = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "A", content: "c", actorUserId: ownerId });
    const b = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "B", content: "c", actorUserId: ownerId });
    await authenticateAs(ownerId);

    const body = JSON.stringify({ sourceItemId: a.id, targetItemId: b.id, relationshipType: "supports" });
    await CREATE(new Request("https://platform.example.com/x", { method: "POST", body }), { params: Promise.resolve({ organizationId: orgId }) });
    const secondRes = await CREATE(new Request("https://platform.example.com/x", { method: "POST", body }), { params: Promise.resolve({ organizationId: orgId }) });
    expect(secondRes.status).toBe(409);
    const secondBody = await secondRes.json();
    expect(secondBody.error.code).toBe("duplicate_relationship");
  });
});

describe("GET /api/organizations/{organizationId}/knowledge/{knowledgeItemId}/relationships", () => {
  it("lists relationships for an item and never leaks a stack trace or SQL text", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const a = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "A", content: "c", actorUserId: ownerId });
    const b = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "B", content: "c", actorUserId: ownerId });
    await authenticateAs(ownerId);
    await CREATE(
      new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ sourceItemId: a.id, targetItemId: b.id, relationshipType: "supports" }) }),
      { params: Promise.resolve({ organizationId: orgId }) }
    );

    const res = await LIST_FOR_ITEM(new Request("https://platform.example.com/x"), { params: Promise.resolve({ organizationId: orgId, knowledgeItemId: a.id }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.relationships).toHaveLength(1);
    expect(JSON.stringify(body)).not.toMatch(/at Object|node_modules|SELECT |INSERT /i);
  });
});

describe("GET /api/organizations/{organizationId}/knowledge-relationships/{relationshipId}", () => {
  it("returns 404 for a nonexistent relationship id", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    await authenticateAs(ownerId);

    const res = await GET_ONE(new Request("https://platform.example.com/x"), {
      params: Promise.resolve({ organizationId: orgId, relationshipId: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/organizations/{organizationId}/knowledge-relationships/{relationshipId}/archive", () => {
  it("archives the relationship and returns 200", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const a = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "A", content: "c", actorUserId: ownerId });
    const b = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "B", content: "c", actorUserId: ownerId });
    await authenticateAs(ownerId);
    const createRes = await CREATE(
      new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ sourceItemId: a.id, targetItemId: b.id, relationshipType: "supports" }) }),
      { params: Promise.resolve({ organizationId: orgId }) }
    );
    const created = await createRes.json();

    const res = await ARCHIVE(new Request("https://platform.example.com/x", { method: "POST" }), {
      params: Promise.resolve({ organizationId: orgId, relationshipId: created.data.id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.archivedAt).not.toBeNull();
  });

  it("returns 409 relationship_already_archived on a second archive attempt", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", null, ownerId);
    const a = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "A", content: "c", actorUserId: ownerId });
    const b = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "B", content: "c", actorUserId: ownerId });
    await authenticateAs(ownerId);
    const createRes = await CREATE(
      new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ sourceItemId: a.id, targetItemId: b.id, relationshipType: "supports" }) }),
      { params: Promise.resolve({ organizationId: orgId }) }
    );
    const created = await createRes.json();

    await ARCHIVE(new Request("https://platform.example.com/x", { method: "POST" }), { params: Promise.resolve({ organizationId: orgId, relationshipId: created.data.id }) });
    const secondRes = await ARCHIVE(new Request("https://platform.example.com/x", { method: "POST" }), {
      params: Promise.resolve({ organizationId: orgId, relationshipId: created.data.id }),
    });
    expect(secondRes.status).toBe(409);
    const body = await secondRes.json();
    expect(body.error.code).toBe("relationship_already_archived");
  });
});
