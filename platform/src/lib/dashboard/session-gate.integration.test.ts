import { describe, it, expect, vi, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { loadEnv } from "@/lib/env";
import { createDbClient } from "@/db/client";
import { users } from "@/db/schema";
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

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

import { createSession, revokeSession } from "@/lib/auth/session";
import { requireDashboardUser, buildSignInRequiredUrl } from "./session-gate";

const env = loadEnv();
const db = createDbClient(env);

const createdUserIds: string[] = [];

async function makeUser(name: string | null = "Gate Tester"): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ email: `gate-test-${crypto.randomUUID()}@example.com`, name })
    .returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

afterEach(async () => {
  cookieStore.clear();
  redirectMock.mockClear();
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop()!;
    await db.delete(users).where(sql`${users.id} = ${id}`);
  }
});

describe("requireDashboardUser — real database session (Step 5A)", () => {
  it("returns only the display-safe fields for a genuinely valid session", async () => {
    const userId = await makeUser("Gate Tester");
    const { rawToken } = await createSession(db, { userId });
    cookieStore.set(SESSION_COOKIE_NAME, rawToken);

    const user = await requireDashboardUser(db, "/app/acme");

    expect(user.userId).toBe(userId);
    expect(user.name).toBe("Gate Tester");
    expect(user.email).toContain("gate-test-");
    // Never the session token, its hash, or anything beyond these three fields.
    expect(Object.keys(user).sort()).toEqual(["email", "name", "userId"]);
  });

  it("redirects to sign-in-required when no session cookie is present at all", async () => {
    await expect(requireDashboardUser(db, "/app/acme")).rejects.toThrow();
    expect(redirectMock).toHaveBeenCalledWith("/sign-in-required?returnTo=%2Fapp%2Facme");
  });

  it("redirects — cannot access the dashboard — once the session has been revoked", async () => {
    const userId = await makeUser();
    const { rawToken, session } = await createSession(db, { userId });
    cookieStore.set(SESSION_COOKIE_NAME, rawToken);
    await revokeSession(db, session.id);

    await expect(requireDashboardUser(db, "/app/acme")).rejects.toThrow();
    expect(redirectMock).toHaveBeenCalledWith("/sign-in-required?returnTo=%2Fapp%2Facme");
  });

  it("redirects on a garbage/tampered session token", async () => {
    cookieStore.set(SESSION_COOKIE_NAME, "not-a-real-token");
    await expect(requireDashboardUser(db, "/app/acme")).rejects.toThrow();
    expect(redirectMock).toHaveBeenCalledWith("/sign-in-required?returnTo=%2Fapp%2Facme");
  });

  it("never turns an external return path into an open redirect", async () => {
    await expect(requireDashboardUser(db, "https://evil.example.com")).rejects.toThrow();
    expect(redirectMock).toHaveBeenCalledWith("/sign-in-required?returnTo=%2Fapp");
  });

  it("never turns a protocol-relative return path into an open redirect", async () => {
    await expect(requireDashboardUser(db, "//evil.example.com")).rejects.toThrow();
    expect(redirectMock).toHaveBeenCalledWith("/sign-in-required?returnTo=%2Fapp");
  });
});

describe("buildSignInRequiredUrl", () => {
  it("preserves a safe, internal-relative return path", () => {
    expect(buildSignInRequiredUrl("/app/acme/marketing")).toBe("/sign-in-required?returnTo=%2Fapp%2Facme%2Fmarketing");
  });

  it("falls back to /app for any unsafe value", () => {
    expect(buildSignInRequiredUrl("https://evil.com")).toBe("/sign-in-required?returnTo=%2Fapp");
    expect(buildSignInRequiredUrl("//evil.com")).toBe("/sign-in-required?returnTo=%2Fapp");
    expect(buildSignInRequiredUrl(null)).toBe("/sign-in-required?returnTo=%2Fapp");
    expect(buildSignInRequiredUrl(undefined)).toBe("/sign-in-required?returnTo=%2Fapp");
  });
});
