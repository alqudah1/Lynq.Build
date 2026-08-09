import { describe, it, expect, afterEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users, sessions, auditLogs } from "@/db/schema";
import { createSession, validateSessionToken } from "@/lib/auth/session";
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

const env = loadEnv();
const db = createDbClient(env);

const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `logout-integration-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

afterEach(async () => {
  cookieStore.clear();
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await db.delete(auditLogs).where(sql`${auditLogs.actorUserId} = ${id}`);
    await db.delete(sessions).where(sql`${sessions.userId} = ${id}`);
    await db.delete(users).where(sql`${users.id} = ${id}`);
  }
});

describe("POST /api/auth/logout — real database session (Step 5A)", () => {
  it("revokes the real session row immediately — the same raw token no longer validates afterward", async () => {
    const userId = await makeUser();
    const { rawToken } = await createSession(db, { userId });
    cookieStore.set(SESSION_COOKIE_NAME, rawToken);

    const res = await POST(new Request("https://platform.example.com/api/auth/logout", { method: "POST" }));
    expect(res.status).toBe(204);

    const stillValid = await validateSessionToken(db, rawToken);
    expect(stillValid).toBeNull();
  });
});
