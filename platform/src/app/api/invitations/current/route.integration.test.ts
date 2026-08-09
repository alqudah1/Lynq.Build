import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, invitations as invitationsTable, auditLogs, rateLimitCounters } from "@/db/schema";
import { createOrganization } from "@/lib/organizations/organizations";
import { createOrRefreshInvitation } from "@/lib/invitations/invitations";
import { setInvitationContinuationCookie } from "@/lib/invitations/continuation";
import { hashInvitationToken } from "@/lib/invitations/tokens";
import { TEST_AUTH_SECRET as TEST_SECRET } from "../../../../../test/support/invitation-secret";

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
  const [user] = await db.insert(users).values({ email: `current-route-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}
function makeRequest() {
  return new Request("https://platform.example.com/api/invitations/current");
}

beforeEach(() => {
  process.env.AUTH_SECRET = TEST_SECRET;
});

afterEach(async () => {
  cookieStore.clear();
  // Scoped to this route's own key prefix — see the exchange-route test's
  // identical comment for why a blanket `invitation:%` wildcard is unsafe
  // under vitest's parallel file execution.
  await db.delete(rateLimitCounters).where(sql`${rateLimitCounters.key} LIKE 'invitation:current-lookup:%'`);
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

describe("GET /api/invitations/current", () => {
  it("returns a preview when a valid continuation cookie is present", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme Corp", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    const invite = await createOrRefreshInvitation(db, rawSql, { organizationId: created.organization.id, actorUserId: ownerId, email: "current@example.com", role: "member" });
    await setInvitationContinuationCookie(hashInvitationToken(invite.rawToken), TEST_SECRET);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.organizationName).toBe("Acme Corp");
    expect(body.data.email).toBe("current@example.com");
  });

  it("returns 404 no_active_invitation when no continuation cookie is present", async () => {
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("no_active_invitation");
  });

  it("returns 404 invitation_not_available when the cookie's invitation was refreshed away", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    const email = "stale@example.com";
    const first = await createOrRefreshInvitation(db, rawSql, { organizationId: created.organization.id, actorUserId: ownerId, email, role: "member" });
    await setInvitationContinuationCookie(hashInvitationToken(first.rawToken), TEST_SECRET);

    await createOrRefreshInvitation(db, rawSql, { organizationId: created.organization.id, actorUserId: ownerId, email, role: "admin" });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("invitation_not_available");
  });

  it("returns 429 once the per-IP/token rate limit is exceeded", async () => {
    const ownerId = await makeUser();
    const created = await createOrganization(rawSql, { name: "Acme", slug: `acme-${crypto.randomUUID()}`, ownerUserId: ownerId });
    createdOrgIds.push(created.organization.id);
    const invite = await createOrRefreshInvitation(db, rawSql, { organizationId: created.organization.id, actorUserId: ownerId, email: "rl@example.com", role: "member" });
    await setInvitationContinuationCookie(hashInvitationToken(invite.rawToken), TEST_SECRET);

    let sawRateLimited = false;
    for (let i = 0; i < 30; i++) {
      const res = await GET(makeRequest());
      if (res.status === 429) {
        sawRateLimited = true;
        break;
      }
    }
    expect(sawRateLimited).toBe(true);
  }, 30000);
});
