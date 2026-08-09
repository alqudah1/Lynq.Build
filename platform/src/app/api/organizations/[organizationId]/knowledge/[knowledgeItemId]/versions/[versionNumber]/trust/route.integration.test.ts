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

import { GET, POST } from "./route";
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
  const [user] = await db.insert(users).values({ email: `brain-trust-route-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Trust Route Org", slug: `brain-trust-route-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: ownerId, role: "owner" });
  createdOrgIds.push(org.id);
  return org.id;
}

async function addOrgMember(orgId: string, userId: string, role: "member" | "viewer"): Promise<void> {
  await db.insert(organizationMemberships).values({ organizationId: orgId, userId, role });
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

describe("GET .../versions/{versionNumber}/trust", () => {
  it("returns 401 when unauthenticated", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantCapability(orgId, "identity", null, ownerId, "draft_write");
    await grantCapability(orgId, "identity", null, ownerId, "read");
    await grantCapability(orgId, "identity", null, ownerId, "approve");
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });

    const res = await GET(new Request("https://platform.example.com/x"), { params: Promise.resolve({ organizationId: orgId, knowledgeItemId: item.id, versionNumber: "1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 200 with an unknown/unassessed view when nothing has been recorded", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantCapability(orgId, "identity", null, ownerId, "draft_write");
    await grantCapability(orgId, "identity", null, ownerId, "read");
    await grantCapability(orgId, "identity", null, ownerId, "approve");
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    await authenticateAs(ownerId);

    const res = await GET(new Request("https://platform.example.com/x"), { params: Promise.resolve({ organizationId: orgId, knowledgeItemId: item.id, versionNumber: "1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.trust.trustTier).toBe("unknown");
    expect(body.data.source).toBeNull();
  });
});

describe("POST .../versions/{versionNumber}/trust", () => {
  it("returns 403 for a plain member (approve authority required)", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, memberId, "member");
    await grantCapability(orgId, "identity", null, memberId, "draft_write");
    await grantCapability(orgId, "identity", null, memberId, "read");
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: memberId });
    await authenticateAs(memberId);

    const res = await POST(
      new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ trustTier: "approved", expectedRevision: 0, sourceType: "internal_documentation" }) }),
      { params: Promise.resolve({ organizationId: orgId, knowledgeItemId: item.id, versionNumber: "1" }) }
    );
    expect(res.status).toBe(403);
  });

  it("returns 200 and attaches trust metadata for an organization owner", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantCapability(orgId, "identity", null, ownerId, "draft_write");
    await grantCapability(orgId, "identity", null, ownerId, "read");
    await grantCapability(orgId, "identity", null, ownerId, "approve");
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    await authenticateAs(ownerId);

    const res = await POST(
      new Request("https://platform.example.com/x", {
        method: "POST",
        body: JSON.stringify({ trustTier: "approved", expectedRevision: 0, sourceType: "founder_decision", sourceDetail: "Q1 planning" }),
      }),
      { params: Promise.resolve({ organizationId: orgId, knowledgeItemId: item.id, versionNumber: "1" }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.trust.trustTier).toBe("approved");
    expect(body.data.trust.revision).toBe(1);
    expect(body.data.source.sourceType).toBe("founder_decision");
  });

  it("returns 409 trust_conflict on a stale expectedRevision", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantCapability(orgId, "identity", null, ownerId, "draft_write");
    await grantCapability(orgId, "identity", null, ownerId, "read");
    await grantCapability(orgId, "identity", null, ownerId, "approve");
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    await authenticateAs(ownerId);

    const body = JSON.stringify({ trustTier: "approved", expectedRevision: 0, sourceType: "founder_decision" });
    await POST(new Request("https://platform.example.com/x", { method: "POST", body }), { params: Promise.resolve({ organizationId: orgId, knowledgeItemId: item.id, versionNumber: "1" }) });

    const secondRes = await POST(new Request("https://platform.example.com/x", { method: "POST", body }), {
      params: Promise.resolve({ organizationId: orgId, knowledgeItemId: item.id, versionNumber: "1" }),
    });
    expect(secondRes.status).toBe(409);
    const secondBody = await secondRes.json();
    expect(secondBody.error.code).toBe("trust_conflict");
  });

  it("returns 409 source_immutable when sourceType changes on a later call", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantCapability(orgId, "identity", null, ownerId, "draft_write");
    await grantCapability(orgId, "identity", null, ownerId, "read");
    await grantCapability(orgId, "identity", null, ownerId, "approve");
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    await authenticateAs(ownerId);

    await POST(
      new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ trustTier: "hypothesis", expectedRevision: 0, sourceType: "meeting_notes" }) }),
      { params: Promise.resolve({ organizationId: orgId, knowledgeItemId: item.id, versionNumber: "1" }) }
    );
    const res = await POST(
      new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ trustTier: "approved", expectedRevision: 1, sourceType: "founder_decision" }) }),
      { params: Promise.resolve({ organizationId: orgId, knowledgeItemId: item.id, versionNumber: "1" }) }
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("source_immutable");
  });

  it("returns 400 for an invalid trustTier", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantCapability(orgId, "identity", null, ownerId, "draft_write");
    await grantCapability(orgId, "identity", null, ownerId, "read");
    await grantCapability(orgId, "identity", null, ownerId, "approve");
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    await authenticateAs(ownerId);

    const res = await POST(
      new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ trustTier: "not-a-tier", expectedRevision: 0, sourceType: "founder_decision" }) }),
      { params: Promise.resolve({ organizationId: orgId, knowledgeItemId: item.id, versionNumber: "1" }) }
    );
    expect(res.status).toBe(400);
  });
});
