import { describe, it, expect, afterEach, vi } from "vitest";
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

import { GET, POST } from "./route";

const env = loadEnv();
const db = createDbClient(env);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `brain-route-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Route Test Org", slug: `brain-route-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
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

function makeRequest(body: unknown): Request {
  return new Request("https://platform.example.com/api/organizations/x/knowledge", { method: "POST", body: JSON.stringify(body) });
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

describe("POST /api/organizations/{organizationId}/knowledge", () => {
  it("returns 401 when unauthenticated", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);

    const res = await POST(makeRequest({ domain: "identity", classification: "fact", title: "t", content: "c" }), {
      params: Promise.resolve({ organizationId: orgId }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 for a cross-tenant organization id (never a raw stack trace or SQL text)", async () => {
    const ownerId = await makeUser();
    await authenticateAs(ownerId);
    const otherOwnerId = await makeUser();
    const otherOrgId = await makeOrgWithOwner(otherOwnerId);

    const res = await POST(makeRequest({ domain: "identity", classification: "fact", title: "t", content: "c" }), {
      params: Promise.resolve({ organizationId: otherOrgId }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/at Object|node_modules|SELECT |INSERT /i);
  });

  it("returns 400 for an invalid domain", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await authenticateAs(ownerId);

    const res = await POST(makeRequest({ domain: "not-a-real-domain", classification: "fact", title: "t", content: "c" }), {
      params: Promise.resolve({ organizationId: orgId }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid classification", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await authenticateAs(ownerId);

    const res = await POST(makeRequest({ domain: "identity", classification: "not-a-real-classification", title: "t", content: "c" }), {
      params: Promise.resolve({ organizationId: orgId }),
    });
    expect(res.status).toBe(400);
  });

  it("ignores (rejects) a client-supplied role field entirely — the strict body schema has no such field, so an org viewer sending one cannot elevate themselves", async () => {
    const ownerId = await makeUser();
    const viewerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await db.insert(organizationMemberships).values({ organizationId: orgId, userId: viewerId, role: "viewer" });
    await authenticateAs(viewerId);

    const res = await POST(
      makeRequest({ domain: "identity", classification: "fact", title: "t", content: "c", role: "owner", actorUserId: ownerId }),
      { params: Promise.resolve({ organizationId: orgId }) }
    );
    // Rejected outright by the strict schema (unknown keys) — never silently
    // stripped and never used to influence authorization, which is derived
    // exclusively from the real session + a fresh database membership
    // lookup, never from anything in the request body.
    expect(res.status).toBe(400);
  });

  it("returns 400 when the title exceeds the length limit", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await authenticateAs(ownerId);

    const res = await POST(makeRequest({ domain: "identity", classification: "fact", title: "x".repeat(201), content: "c" }), {
      params: Promise.resolve({ organizationId: orgId }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when content exceeds the size limit", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await authenticateAs(ownerId);

    const res = await POST(makeRequest({ domain: "identity", classification: "fact", title: "t", content: "x".repeat(20_001) }), {
      params: Promise.resolve({ organizationId: orgId }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 201 and creates a draft item for an authorized member", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantCapability(orgId, "identity", null, ownerId, "draft_write");
    await authenticateAs(ownerId);

    const res = await POST(makeRequest({ domain: "identity", classification: "fact", title: "Real title", content: "Real content" }), {
      params: Promise.resolve({ organizationId: orgId }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.status).toBe("draft");
    expect(body.data.title).toBe("Real title");
  });
});

describe("GET /api/organizations/{organizationId}/knowledge", () => {
  it("returns 401 when unauthenticated", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    const res = await GET(new Request(`https://platform.example.com/api/organizations/${orgId}/knowledge`), { params: Promise.resolve({ organizationId: orgId }) });
    expect(res.status).toBe(401);
  });

  it("lists items with a bounded page and never leaks a stack trace or SQL text", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantCapability(orgId, "identity", null, ownerId, "draft_write");
    await grantCapability(orgId, "identity", null, ownerId, "read");
    await authenticateAs(ownerId);

    const createRes = await POST(makeRequest({ domain: "identity", classification: "fact", title: "a", content: "c" }), { params: Promise.resolve({ organizationId: orgId }) });
    expect(createRes.status).toBe(201);

    const res = await GET(new Request(`https://platform.example.com/api/organizations/${orgId}/knowledge?limit=1`), {
      params: Promise.resolve({ organizationId: orgId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.items.length).toBe(1);
    expect(JSON.stringify(body)).not.toMatch(/at Object|node_modules|SELECT |INSERT /i);
  });
});
