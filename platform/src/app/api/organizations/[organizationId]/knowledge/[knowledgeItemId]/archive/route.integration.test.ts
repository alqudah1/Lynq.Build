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

import { POST } from "./route";
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
  const [user] = await db.insert(users).values({ email: `brain-archive-route-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Archive Route Org", slug: `brain-archive-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
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

describe("POST /api/organizations/{organizationId}/knowledge/{knowledgeItemId}/archive", () => {
  it("archives the item and returns it with status archived", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantCapability(orgId, "identity", null, ownerId, "draft_write");
    await grantCapability(orgId, "identity", null, ownerId, "read");
    await grantCapability(orgId, "identity", null, ownerId, "archive");
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    await authenticateAs(ownerId);

    const res = await POST(new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ expectedVersionNumber: 1 }) }), {
      params: Promise.resolve({ organizationId: orgId, knowledgeItemId: item.id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("archived");
  });

  it("returns 409 already_archived on a second archive attempt", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantCapability(orgId, "identity", null, ownerId, "draft_write");
    await grantCapability(orgId, "identity", null, ownerId, "read");
    await grantCapability(orgId, "identity", null, ownerId, "archive");
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    await authenticateAs(ownerId);

    await POST(new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ expectedVersionNumber: 1 }) }), {
      params: Promise.resolve({ organizationId: orgId, knowledgeItemId: item.id }),
    });
    const secondRes = await POST(new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ expectedVersionNumber: 1 }) }), {
      params: Promise.resolve({ organizationId: orgId, knowledgeItemId: item.id }),
    });
    expect(secondRes.status).toBe(409);
    const body = await secondRes.json();
    expect(body.error.code).toBe("already_archived");
  });

  it("returns 401 when unauthenticated", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantCapability(orgId, "identity", null, ownerId, "draft_write");
    await grantCapability(orgId, "identity", null, ownerId, "read");
    await grantCapability(orgId, "identity", null, ownerId, "archive");
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    const res = await POST(new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ expectedVersionNumber: 1 }) }), {
      params: Promise.resolve({ organizationId: orgId, knowledgeItemId: item.id }),
    });
    expect(res.status).toBe(401);
  });
});
