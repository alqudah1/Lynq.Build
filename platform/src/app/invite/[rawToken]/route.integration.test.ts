import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, invitations as invitationsTable, auditLogs, rateLimitCounters } from "@/db/schema";
import { createOrganization } from "@/lib/organizations/organizations";
import { createOrRefreshInvitation } from "@/lib/invitations/invitations";
import { INVITATION_CONTINUATION_COOKIE_NAME } from "@/lib/invitations/continuation";
import { TEST_AUTH_SECRET } from "../../../../test/support/invitation-secret";

const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (cookieStore.has(name) ? { name, value: cookieStore.get(name) } : undefined),
      set: (name: string, value: string) => cookieStore.set(name, value),
      delete: (name: string) => cookieStore.delete(name),
    }),
}));

import { GET } from "./route";

const env = loadEnv();
const db = createDbClient(env);
const rawSql = neon(env.DATABASE_URL);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `exchange-route-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}
function params(rawToken: string) {
  return { params: Promise.resolve({ rawToken }) };
}
function makeRequest(path: string) {
  return new Request(`https://platform.example.com${path}`);
}

beforeEach(() => {
  process.env.AUTH_SECRET = TEST_AUTH_SECRET;
});

afterEach(async () => {
  cookieStore.clear();
  // Scoped to this route's own key prefix only — a blanket `invitation:%`
  // wildcard would also delete OTHER concurrently-running integration test
  // files' in-progress rate-limit counters, since vitest runs files in
  // parallel against the same shared database.
  await db.delete(rateLimitCounters).where(sql`${rateLimitCounters.key} LIKE 'invitation:exchange:%'`);
  while (createdOrgIds.length > 0) {
    const id = createdOrgIds.pop()!;
    await db.delete(auditLogs).where(sql`${auditLogs.organizationId} = ${id}`);
    await db.delete(invitationsTable).where(sql`${invitationsTable.organizationId} = ${id}`);
    await db.delete(organizations).where(sql`${organizations.id} = ${id}`);
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await db.delete(users).where(sql`${users.id} = ${id}`);
  }
});

describe("GET /invite/{rawToken}", () => {
  it("exchanges a valid token for a continuation cookie and redirects to the clean /invite URL with the required headers", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    const invite = await createOrRefreshInvitation(db, rawSql, { organizationId: created.organization.id, actorUserId: ownerId, email: "x@example.com", role: "member" });

    const res = await GET(makeRequest(`/invite/${invite.rawToken}`), params(invite.rawToken));

    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("https://platform.example.com/invite");
    expect(res.headers.get("Location")).not.toContain(invite.rawToken);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");

    const cookieValue = cookieStore.get(INVITATION_CONTINUATION_COOKIE_NAME);
    expect(cookieValue).toBeTruthy();
    expect(cookieValue).not.toContain(invite.rawToken);
  });

  it("redirects to the generic unavailable status for an invalid token, with no token anywhere in the response", async () => {
    const res = await GET(makeRequest("/invite/not-a-real-token"), params("not-a-real-token"));

    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("https://platform.example.com/invite?status=unavailable");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(cookieStore.has(INVITATION_CONTINUATION_COOKIE_NAME)).toBe(false);
  });

  it("safely allows a replayed exchange of the same still-valid token", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    const invite = await createOrRefreshInvitation(db, rawSql, { organizationId: created.organization.id, actorUserId: ownerId, email: "replay@example.com", role: "member" });

    const res1 = await GET(makeRequest(`/invite/${invite.rawToken}`), params(invite.rawToken));
    const res2 = await GET(makeRequest(`/invite/${invite.rawToken}`), params(invite.rawToken));

    expect(res1.status).toBe(303);
    expect(res2.status).toBe(303);
    expect(res1.headers.get("Location")).toBe("https://platform.example.com/invite");
    expect(res2.headers.get("Location")).toBe("https://platform.example.com/invite");
    // Still resolves to a live continuation cookie after the replay — never blocked, never corrupted.
    expect(cookieStore.has(INVITATION_CONTINUATION_COOKIE_NAME)).toBe(true);
  });

  it("returns 429 once the per-token/IP exchange rate limit is exceeded", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    const invite = await createOrRefreshInvitation(db, rawSql, { organizationId: created.organization.id, actorUserId: ownerId, email: "rl@example.com", role: "member" });

    let sawRateLimited = false;
    for (let i = 0; i < 30; i++) {
      const res = await GET(makeRequest(`/invite/${invite.rawToken}`), params(invite.rawToken));
      if (res.status === 429) {
        sawRateLimited = true;
        break;
      }
    }
    expect(sawRateLimited).toBe(true);
  }, 30000);
});
