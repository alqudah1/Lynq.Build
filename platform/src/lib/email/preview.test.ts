import { describe, it, expect, afterEach, vi } from "vitest";
import { renderInvitationEmailPreview, isEmailPreviewEnabled, ACCEPT_LINK_PLACEHOLDER } from "./preview";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("renderInvitationEmailPreview", () => {
  const basePayload = {
    to: "invitee@example.com",
    organizationName: "Acme",
    inviterName: "Ada Lovelace",
    role: "member" as const,
    workspaceName: null,
    workspaceRole: null,
    expiresAt: new Date("2026-01-01T00:00:00Z"),
  };

  it("never contains a usable http(s) URL anywhere in the html or text body", () => {
    const message = renderInvitationEmailPreview(basePayload);
    expect(message.html).not.toMatch(/https?:\/\//i);
    expect(message.text).not.toMatch(/https?:\/\//i);
  });

  it("never contains an anchor tag around the accept link", () => {
    const message = renderInvitationEmailPreview(basePayload);
    expect(message.html).not.toMatch(/<a\s/i);
  });

  it("shows the visible non-clickable placeholder in both html and text", () => {
    const message = renderInvitationEmailPreview(basePayload);
    expect(message.html).toContain(ACCEPT_LINK_PLACEHOLDER);
    expect(message.text).toContain(ACCEPT_LINK_PLACEHOLDER);
  });

  it("uses the real organization name, inviter name, and role in the rendered content", () => {
    const message = renderInvitationEmailPreview(basePayload);
    expect(message.html).toContain("Acme");
    expect(message.html).toContain("Ada Lovelace");
    expect(message.html).toContain("member");
  });

  it("includes the workspace name and role when a workspace is supplied", () => {
    const message = renderInvitationEmailPreview({ ...basePayload, workspaceName: "Marketing", workspaceRole: "manager" });
    expect(message.text).toContain("Marketing");
    expect(message.text).toContain("manager");
  });
});

describe("isEmailPreviewEnabled", () => {
  it("is enabled outside production regardless of the flag", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ENABLE_EMAIL_PREVIEW", "");
    expect(isEmailPreviewEnabled()).toBe(true);

    vi.stubEnv("NODE_ENV", "test");
    expect(isEmailPreviewEnabled()).toBe(true);
  });

  it("is disabled in production without the explicit flag", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_EMAIL_PREVIEW", "");
    expect(isEmailPreviewEnabled()).toBe(false);
  });

  it("stays disabled in production for any non-exact flag value", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_EMAIL_PREVIEW", "1");
    expect(isEmailPreviewEnabled()).toBe(false);

    vi.stubEnv("ENABLE_EMAIL_PREVIEW", "TRUE");
    expect(isEmailPreviewEnabled()).toBe(false);
  });

  it("is enabled in production only when the flag is the exact string 'true'", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_EMAIL_PREVIEW", "true");
    expect(isEmailPreviewEnabled()).toBe(true);
  });
});
