import { describe, it, expect, afterEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users } from "@/db/schema";
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

import { GET as LIST } from "./route";
import { GET as GET_ONE } from "./[domain]/route";

const env = loadEnv();
const db = createDbClient(env);

const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `brain-domains-route-test-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function authenticateAs(userId: string): Promise<void> {
  const { rawToken } = await createSession(db, { userId });
  cookieStore.set(SESSION_COOKIE_NAME, rawToken);
}

afterEach(async () => {
  cookieStore.clear();
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await db.delete(users).where(sql`${users.id} = ${id}`);
  }
});

describe("GET /api/brain/domains", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await LIST();
    expect(res.status).toBe(401);
  });

  it("returns 200 with all eight domains for an authenticated user, regardless of organization", async () => {
    const userId = await makeUser();
    await authenticateAs(userId);

    const res = await LIST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(8);
    expect(body.data[0].domain).toBe("identity");
  });
});

describe("GET /api/brain/domains/{domain}", () => {
  it("returns 400 for an invalid domain", async () => {
    const userId = await makeUser();
    await authenticateAs(userId);

    const res = await GET_ONE(new Request("https://platform.example.com/x"), { params: Promise.resolve({ domain: "not-a-real-domain" }) });
    expect(res.status).toBe(400);
  });

  it("returns 200 with the correct metadata", async () => {
    const userId = await makeUser();
    await authenticateAs(userId);

    const res = await GET_ONE(new Request("https://platform.example.com/x"), { params: Promise.resolve({ domain: "capability" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.domain).toBe("capability");
    expect(body.data.sortOrder).toBe(7);
  });
});
