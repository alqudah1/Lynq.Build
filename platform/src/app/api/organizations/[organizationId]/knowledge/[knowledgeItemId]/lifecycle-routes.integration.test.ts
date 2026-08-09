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

import { POST as SUBMIT_FOR_REVIEW } from "./submit-for-review/route";
import { POST as SEND_BACK_TO_DRAFT } from "./send-back-to-draft/route";
import { POST as APPROVE } from "./approve/route";
import { POST as PUBLISH } from "./publish/route";
import { POST as RESTORE } from "./restore/route";
import { POST as RETIRE } from "./retire/route";
import { POST as ARCHIVE } from "./archive/route";
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
  const [user] = await db.insert(users).values({ email: `brain-lifecycle-route-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Lifecycle Route Org", slug: `brain-lifecycle-route-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: ownerId, role: "owner" });
  createdOrgIds.push(org.id);
  return org.id;
}

async function grantAllCapabilities(organizationId: string, domain: KnowledgeDomain, granteeUserId: string): Promise<void> {
  for (const capability of ["read", "draft_write", "edit_own_draft", "edit_any_draft", "approve", "archive"] as const satisfies readonly BrainCapability[]) {
    await db.insert(brainPermissionGrants).values({ organizationId, domain, workspaceId: null, granteeUserId, capability });
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

describe("lifecycle routes", () => {
  it("walks the full happy path through every route: submit-for-review -> approve -> publish -> archive -> restore -> retire", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    await authenticateAs(ownerId);
    const paramsFor = (extra: Record<string, string> = {}) => Promise.resolve({ organizationId: orgId, knowledgeItemId: item.id, ...extra });

    const reviewRes = await SUBMIT_FOR_REVIEW(new Request("https://platform.example.com/x", { method: "POST" }), { params: paramsFor() });
    expect(reviewRes.status).toBe(200);
    expect((await reviewRes.json()).data.status).toBe("review");

    const approveRes = await APPROVE(new Request("https://platform.example.com/x", { method: "POST" }), { params: paramsFor() });
    expect(approveRes.status).toBe(200);
    expect((await approveRes.json()).data.status).toBe("approved");

    const publishRes = await PUBLISH(new Request("https://platform.example.com/x", { method: "POST" }), { params: paramsFor() });
    expect(publishRes.status).toBe(200);
    expect((await publishRes.json()).data.status).toBe("published");

    const archiveRes = await ARCHIVE(new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ expectedVersionNumber: 1 }) }), { params: paramsFor() });
    expect(archiveRes.status).toBe(200);
    expect((await archiveRes.json()).data.status).toBe("archived");

    const restoreRes = await RESTORE(new Request("https://platform.example.com/x", { method: "POST" }), { params: paramsFor() });
    expect(restoreRes.status).toBe(200);
    expect((await restoreRes.json()).data.status).toBe("approved");

    const retireRes = await RETIRE(new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ reason: "no longer needed" }) }), { params: paramsFor() });
    expect(retireRes.status).toBe(200);
    const retireBody = await retireRes.json();
    expect(retireBody.data.status).toBe("retired");
    expect(retireBody.data.retiredReason).toBe("no longer needed");
  });

  it("send-back-to-draft returns a draft item, and a direct draft->approve attempt is rejected with 409", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    await authenticateAs(ownerId);
    const paramsFor = () => Promise.resolve({ organizationId: orgId, knowledgeItemId: item.id });

    const badApprove = await APPROVE(new Request("https://platform.example.com/x", { method: "POST" }), { params: paramsFor() });
    expect(badApprove.status).toBe(409);
    const badBody = await badApprove.json();
    expect(badBody.error.code).toBe("invalid_lifecycle_transition");

    await SUBMIT_FOR_REVIEW(new Request("https://platform.example.com/x", { method: "POST" }), { params: paramsFor() });
    const backRes = await SEND_BACK_TO_DRAFT(new Request("https://platform.example.com/x", { method: "POST" }), { params: paramsFor() });
    expect(backRes.status).toBe(200);
    expect((await backRes.json()).data.status).toBe("draft");
  });

  it("retire requires a non-empty reason (400) and approve/publish/restore return 401 when unauthenticated", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await grantAllCapabilities(orgId, "identity", ownerId);
    const item = await create({ organizationId: orgId, domain: "identity", classification: "fact", title: "t", content: "c", actorUserId: ownerId });
    const paramsFor = () => Promise.resolve({ organizationId: orgId, knowledgeItemId: item.id });

    const unauth = await APPROVE(new Request("https://platform.example.com/x", { method: "POST" }), { params: paramsFor() });
    expect(unauth.status).toBe(401);

    await authenticateAs(ownerId);
    const badRetire = await RETIRE(new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ reason: "" }) }), { params: paramsFor() });
    expect(badRetire.status).toBe(400);
  });
});
