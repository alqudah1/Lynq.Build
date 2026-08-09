import { describe, it, expect, vi, beforeEach } from "vitest";

const store = {
  set: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
};

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve(store),
}));

import {
  setPreAuthCookie,
  readAndClearPreAuthCookie,
  verifyPreAuthPayload,
  PRE_AUTH_COOKIE_NAME,
} from "./state";
import { PreAuthCookieInvalidError } from "./errors";

const SECRET = "test-auth-secret-value";

describe("setPreAuthCookie", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes a signed, HttpOnly, Secure, SameSite=Lax cookie scoped to /api/auth with no domain", async () => {
    await setPreAuthCookie(
      { provider: "google", state: "s", codeVerifier: "v", nonce: "n", intent: "login", redirectTo: "/" },
      SECRET
    );

    expect(store.set).toHaveBeenCalledTimes(1);
    const [name, value, options] = store.set.mock.calls[0];
    expect(name).toBe(PRE_AUTH_COOKIE_NAME);
    expect(options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/auth",
      maxAge: 600,
    });
    expect(options.domain).toBeUndefined();

    // The written value is verifiable with the same secret.
    const verified = verifyPreAuthPayload(value, SECRET);
    expect(verified).toMatchObject({ provider: "google", state: "s", codeVerifier: "v" });
  });
});

describe("readAndClearPreAuthCookie", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clears the cookie immediately even when it's missing", async () => {
    store.get.mockReturnValue(undefined);

    await expect(readAndClearPreAuthCookie(SECRET)).rejects.toThrow(PreAuthCookieInvalidError);
    expect(store.delete).toHaveBeenCalledWith(PRE_AUTH_COOKIE_NAME);
  });

  it("clears the cookie immediately even when verification ultimately fails", async () => {
    store.get.mockReturnValue({ name: PRE_AUTH_COOKIE_NAME, value: "garbage-value" });

    await expect(readAndClearPreAuthCookie(SECRET)).rejects.toThrow(PreAuthCookieInvalidError);
    expect(store.delete).toHaveBeenCalledWith(PRE_AUTH_COOKIE_NAME);
  });

  it("returns the verified payload and still clears the cookie on success", async () => {
    await setPreAuthCookie(
      { provider: "microsoft", state: "s2", codeVerifier: "v2", nonce: "n2", intent: "link", linkUserId: "u1", redirectTo: "/dashboard" },
      SECRET
    );
    const writtenValue = store.set.mock.calls[0][1];
    store.get.mockReturnValue({ name: PRE_AUTH_COOKIE_NAME, value: writtenValue });

    const result = await readAndClearPreAuthCookie(SECRET);

    expect(result).toMatchObject({ provider: "microsoft", intent: "link", linkUserId: "u1" });
    expect(store.delete).toHaveBeenCalledWith(PRE_AUTH_COOKIE_NAME);
  });
});
