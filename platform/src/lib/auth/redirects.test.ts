import { describe, it, expect } from "vitest";
import { isSafeRedirectTarget, resolveSafeRedirectTarget } from "./redirects";

describe("isSafeRedirectTarget", () => {
  it("accepts a plain internal relative path", () => {
    expect(isSafeRedirectTarget("/dashboard")).toBe(true);
  });

  it("rejects a protocol-relative (schemeless) external URL", () => {
    expect(isSafeRedirectTarget("//evil.example.com")).toBe(false);
  });

  it("rejects an absolute URL with a scheme", () => {
    expect(isSafeRedirectTarget("https://evil.example.com")).toBe(false);
    expect(isSafeRedirectTarget("javascript://evil")).toBe(false);
  });

  it("rejects a value not starting with a slash", () => {
    expect(isSafeRedirectTarget("dashboard")).toBe(false);
  });

  it("rejects null, undefined, and empty string", () => {
    expect(isSafeRedirectTarget(null)).toBe(false);
    expect(isSafeRedirectTarget(undefined)).toBe(false);
    expect(isSafeRedirectTarget("")).toBe(false);
  });
});

describe("resolveSafeRedirectTarget", () => {
  it("returns the value itself when safe", () => {
    expect(resolveSafeRedirectTarget("/dashboard")).toBe("/dashboard");
  });

  it("falls back to '/' by default when unsafe", () => {
    expect(resolveSafeRedirectTarget("https://evil.example.com")).toBe("/");
  });

  it("falls back to a custom fallback when provided", () => {
    expect(resolveSafeRedirectTarget(null, "/login")).toBe("/login");
  });
});
