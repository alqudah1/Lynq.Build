import { describe, it, expect, afterEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, organizations, auditLogs } from "@/db/schema";
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
  const [user] = await db.insert(users).values({ email: `org-route-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
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

describe("GET /api/organizations", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("unauthenticated");
  });

  it("returns 200 with every organization the user belongs to", async () => {
    const userId = await makeUser();
    await authenticateAs(userId);

    const createRes = await POST(new Request("https://platform.example.com/api/organizations", {
      method: "POST",
      body: JSON.stringify({ name: "Acme", slug: `acme-${crypto.randomUUID()}` }),
    }));
    const created = await createRes.json();
    createdOrgIds.push(created.data.organization.id);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.some((o: { id: string }) => o.id === created.data.organization.id)).toBe(true);
  });
});

describe("POST /api/organizations", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await POST(new Request("https://platform.example.com/api/organizations", { method: "POST", body: JSON.stringify({ name: "x", slug: "x" }) }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for an invalid slug (uppercase not allowed)", async () => {
    const userId = await makeUser();
    await authenticateAs(userId);

    const res = await POST(new Request("https://platform.example.com/api/organizations", {
      method: "POST",
      body: JSON.stringify({ name: "Acme", slug: "Not_Valid_Slug" }),
    }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_request");
  });

  it("returns 400 for an unexpected extra field (strict body schema)", async () => {
    const userId = await makeUser();
    await authenticateAs(userId);

    const res = await POST(new Request("https://platform.example.com/api/organizations", {
      method: "POST",
      body: JSON.stringify({ name: "Acme", slug: `acme-${crypto.randomUUID()}`, isAdmin: true }),
    }));

    expect(res.status).toBe(400);
  });

  it("returns 201 with the new organization and owner membership, never leaking a stack trace or SQL text", async () => {
    const userId = await makeUser();
    await authenticateAs(userId);
    const slug = `acme-${crypto.randomUUID()}`;

    const res = await POST(new Request("https://platform.example.com/api/organizations", {
      method: "POST",
      body: JSON.stringify({ name: "Acme", slug }),
    }));
    const body = await res.json();
    createdOrgIds.push(body.data.organization.id);

    expect(res.status).toBe(201);
    expect(body.data.organization.slug).toBe(slug);
    expect(body.data.ownerMembership.role).toBe("owner");
    expect(JSON.stringify(body)).not.toMatch(/at Object|node_modules|SELECT |INSERT /i);
  });
});
