import { describe, it, expect, afterEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, organizationMemberships, brainPermissionGrants, auditLogs } from "@/db/schema";
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
import { GET as GET_EFFECTIVE } from "./effective/route";
import { POST as BOOTSTRAP } from "./bootstrap/route";
import { PATCH } from "./[grantId]/route";
import { POST as REVOKE } from "./[grantId]/revoke/route";

const env = loadEnv();
const db = createDbClient(env);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `brain-perm-route-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeOrgWithOwner(ownerId: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name: "Perm Route Org", slug: `brain-perm-route-org-${crypto.randomUUID().slice(0, 8)}` }).returning({ id: organizations.id });
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: ownerId, role: "owner" });
  createdOrgIds.push(org.id);
  return org.id;
}

async function addOrgMember(orgId: string, userId: string, role: "admin" | "member" | "viewer"): Promise<void> {
  await db.insert(organizationMemberships).values({ organizationId: orgId, userId, role });
}

async function authenticateAs(userId: string): Promise<void> {
  const { rawToken } = await createSession(db, { userId });
  cookieStore.set(SESSION_COOKIE_NAME, rawToken);
}

afterEach(async () => {
  cookieStore.clear();
  while (createdOrgIds.length > 0) {
    const id = createdOrgIds.pop()!;
    await db.delete(auditLogs).where(sql`${auditLogs.organizationId} = ${id}`);
    await db.delete(organizations).where(sql`${organizations.id} = ${id}`);
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await db.delete(users).where(sql`${users.id} = ${id}`);
  }
});

describe("POST /api/organizations/{organizationId}/brain-permissions/bootstrap", () => {
  it("returns 401 when unauthenticated", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);

    const res = await BOOTSTRAP(new Request("https://platform.example.com/x", { method: "POST" }), { params: Promise.resolve({ organizationId: orgId }) });
    expect(res.status).toBe(401);
  });

  it("returns 201 and creates 64 grants for the owner, then 409 on a second attempt", async () => {
    const ownerId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await authenticateAs(ownerId);

    const res = await BOOTSTRAP(new Request("https://platform.example.com/x", { method: "POST" }), { params: Promise.resolve({ organizationId: orgId }) });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toHaveLength(64);

    const secondRes = await BOOTSTRAP(new Request("https://platform.example.com/x", { method: "POST" }), { params: Promise.resolve({ organizationId: orgId }) });
    expect(secondRes.status).toBe(409);
    const secondBody = await secondRes.json();
    expect(secondBody.error.code).toBe("bootstrap_already_completed");
  });

  it("returns 403 for a non-owner admin", async () => {
    const ownerId = await makeUser();
    const adminId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, adminId, "admin");
    await authenticateAs(adminId);

    const res = await BOOTSTRAP(new Request("https://platform.example.com/x", { method: "POST" }), { params: Promise.resolve({ organizationId: orgId }) });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/organizations/{organizationId}/brain-permissions", () => {
  it("returns 401 when unauthenticated", async () => {
    const ownerId = await makeUser();
    const granteeId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, granteeId, "member");

    const res = await POST(
      new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ domain: "identity", granteeUserId: granteeId, capability: "read" }) }),
      { params: Promise.resolve({ organizationId: orgId }) }
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 for an invalid capability", async () => {
    const ownerId = await makeUser();
    const granteeId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, granteeId, "member");
    await authenticateAs(ownerId);

    const res = await POST(
      new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ domain: "identity", granteeUserId: granteeId, capability: "not-a-capability" }) }),
      { params: Promise.resolve({ organizationId: orgId }) }
    );
    expect(res.status).toBe(400);
  });

  it("returns 201 and creates the grant for an owner who already holds the capability", async () => {
    const ownerId = await makeUser();
    const granteeId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, granteeId, "member");
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: ownerId, capability: "read" });
    await authenticateAs(ownerId);

    const res = await POST(
      new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ domain: "identity", granteeUserId: granteeId, capability: "read", reason: "onboarding" }) }),
      { params: Promise.resolve({ organizationId: orgId }) }
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.granteeUserId).toBe(granteeId);
    expect(body.data.capability).toBe("read");
  });

  it("returns 409 cannot_grant_unauthorized_capability when the owner doesn't hold the capability themselves", async () => {
    const ownerId = await makeUser();
    const granteeId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, granteeId, "member");
    await authenticateAs(ownerId);

    const res = await POST(
      new Request("https://platform.example.com/x", { method: "POST", body: JSON.stringify({ domain: "identity", granteeUserId: granteeId, capability: "approve" }) }),
      { params: Promise.resolve({ organizationId: orgId }) }
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("cannot_grant_unauthorized_capability");
  });
});

describe("GET /api/organizations/{organizationId}/brain-permissions", () => {
  it("returns 403 for a plain member", async () => {
    const ownerId = await makeUser();
    const memberId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, memberId, "member");
    await authenticateAs(memberId);

    const res = await GET(new Request(`https://platform.example.com/api/organizations/${orgId}/brain-permissions`), { params: Promise.resolve({ organizationId: orgId }) });
    expect(res.status).toBe(403);
  });

  it("returns 200 with the list of grants for an owner", async () => {
    const ownerId = await makeUser();
    const granteeId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, granteeId, "member");
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: granteeId, capability: "read" });
    await authenticateAs(ownerId);

    const res = await GET(new Request(`https://platform.example.com/api/organizations/${orgId}/brain-permissions`), { params: Promise.resolve({ organizationId: orgId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].granteeUserId).toBe(granteeId);
  });
});

describe("GET /api/organizations/{organizationId}/brain-permissions/effective", () => {
  it("returns 200 with the caller's own effective scopes", async () => {
    const ownerId = await makeUser();
    const granteeId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, granteeId, "member");
    await db.insert(brainPermissionGrants).values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: granteeId, capability: "read" });
    await authenticateAs(granteeId);

    const res = await GET_EFFECTIVE(new Request(`https://platform.example.com/api/organizations/${orgId}/brain-permissions/effective`), {
      params: Promise.resolve({ organizationId: orgId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.scopes).toHaveLength(1);
    expect(body.data.scopes[0].capabilities).toEqual(["read"]);
  });
});

describe("PATCH /api/organizations/{organizationId}/brain-permissions/{grantId} and revoke", () => {
  it("updates the reason, then revokes, then returns 409 on a second revoke", async () => {
    const ownerId = await makeUser();
    const granteeId = await makeUser();
    const orgId = await makeOrgWithOwner(ownerId);
    await addOrgMember(orgId, granteeId, "member");
    const [grant] = await db
      .insert(brainPermissionGrants)
      .values({ organizationId: orgId, domain: "identity", workspaceId: null, granteeUserId: granteeId, capability: "read" })
      .returning();
    await authenticateAs(ownerId);

    const patchRes = await PATCH(
      new Request("https://platform.example.com/x", { method: "PATCH", body: JSON.stringify({ expectedRevision: 1, reason: "updated" }) }),
      { params: Promise.resolve({ organizationId: orgId, grantId: grant.id }) }
    );
    expect(patchRes.status).toBe(200);
    const patchBody = await patchRes.json();
    expect(patchBody.data.reason).toBe("updated");

    const revokeRes = await REVOKE(new Request("https://platform.example.com/x", { method: "POST" }), {
      params: Promise.resolve({ organizationId: orgId, grantId: grant.id }),
    });
    expect(revokeRes.status).toBe(200);
    const revokeBody = await revokeRes.json();
    expect(revokeBody.data.revokedAt).not.toBeNull();

    const secondRevokeRes = await REVOKE(new Request("https://platform.example.com/x", { method: "POST" }), {
      params: Promise.resolve({ organizationId: orgId, grantId: grant.id }),
    });
    expect(secondRevokeRes.status).toBe(409);
    const secondRevokeBody = await secondRevokeRes.json();
    expect(secondRevokeBody.error.code).toBe("grant_already_revoked");
  });
});
