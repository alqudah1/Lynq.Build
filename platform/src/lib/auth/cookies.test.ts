import { describe, it, expect, vi, beforeEach } from "vitest";

const store = {
  set: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
};

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve(store),
}));

import { setSessionCookie, getSessionCookie, clearSessionCookie, SESSION_COOKIE_NAME } from "./cookies";

describe("session cookie helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the __Host- prefixed cookie name", () => {
    expect(SESSION_COOKIE_NAME).toBe("__Host-lynq_session");
  });

  it("sets the session cookie with every required security attribute and no domain", async () => {
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);

    await setSessionCookie("raw-token-value", expiresAt);

    expect(store.set).toHaveBeenCalledWith(
      "__Host-lynq_session",
      "raw-token-value",
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        expires: expiresAt,
      })
    );
    const options = store.set.mock.calls[0][2];
    expect(options.domain).toBeUndefined(); // __Host- requires no Domain attribute at all
  });

  it("reads the raw token back from the cookie store", async () => {
    store.get.mockReturnValue({ name: SESSION_COOKIE_NAME, value: "raw-token-value" });

    const result = await getSessionCookie();

    expect(store.get).toHaveBeenCalledWith("__Host-lynq_session");
    expect(result).toBe("raw-token-value");
  });

  it("returns null when no session cookie is present", async () => {
    store.get.mockReturnValue(undefined);

    const result = await getSessionCookie();

    expect(result).toBeNull();
  });

  it("clears the session cookie", async () => {
    await clearSessionCookie();

    expect(store.delete).toHaveBeenCalledWith("__Host-lynq_session");
  });
});
