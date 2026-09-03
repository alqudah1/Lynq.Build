import { describe, expect, it } from "vitest";
import { getJarvisPhoneCommandReadiness, phoneCommandsFlagEnabled, resolveJarvisPhoneCommandConfig } from "./phone-config";

const COMPLETE = {
  JARVIS_PHONE_COMMANDS_ENABLED: "true",
  JARVIS_PHONE_ORGANIZATION_ID: "8f1e0f7a-2c4b-4d3e-9a1b-7c5d6e8f0a12",
  JARVIS_PHONE_FOUNDER_USER_ID: "1b2c3d4e-5f6a-4b8c-9d0e-1f2a3b4c5d6e",
  JARVIS_PHONE_VERIFICATION_SECRET: "a-test-secret-that-is-at-least-32-characters-long",
  JARVIS_FOUNDER_PHONE_E164: "+14165551234",
};

describe("phoneCommandsFlagEnabled", () => {
  it("is off by default and off for anything but an explicit true", () => {
    expect(phoneCommandsFlagEnabled(undefined)).toBe(false);
    expect(phoneCommandsFlagEnabled("")).toBe(false);
    expect(phoneCommandsFlagEnabled("false")).toBe(false);
    expect(phoneCommandsFlagEnabled("1")).toBe(false);
    expect(phoneCommandsFlagEnabled("yes")).toBe(false);
    expect(phoneCommandsFlagEnabled("TRUE")).toBe(true);
  });
});

describe("resolveJarvisPhoneCommandConfig", () => {
  it("refuses when the flag is off, even with every other value present", () => {
    const result = resolveJarvisPhoneCommandConfig({ ...COMPLETE, JARVIS_PHONE_COMMANDS_ENABLED: "false" });
    expect(result).toEqual({ ok: false, reason: "disabled", missing: [] });
  });

  it("refuses when the flag is absent entirely — the default", () => {
    const withoutFlag = { ...COMPLETE, JARVIS_PHONE_COMMANDS_ENABLED: undefined };
    expect(resolveJarvisPhoneCommandConfig(withoutFlag).ok).toBe(false);
  });

  it("names the missing variables without revealing any value", () => {
    const result = resolveJarvisPhoneCommandConfig({ JARVIS_PHONE_COMMANDS_ENABLED: "true" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("incomplete_configuration");
    expect(result.missing).toContain("JARVIS_PHONE_ORGANIZATION_ID");
    expect(result.missing).toContain("JARVIS_PHONE_VERIFICATION_SECRET");
  });

  it("refuses a verification secret that is too short to be safe", () => {
    const result = resolveJarvisPhoneCommandConfig({ ...COMPLETE, JARVIS_PHONE_VERIFICATION_SECRET: "short" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.missing).toContain("JARVIS_PHONE_VERIFICATION_SECRET");
  });

  it("refuses a founder number the existing voice policy would reject", () => {
    // Non-North-American, which phase-one policy does not allow.
    const result = resolveJarvisPhoneCommandConfig({ ...COMPLETE, JARVIS_FOUNDER_PHONE_E164: "+442071838750" });
    expect(result).toEqual({ ok: false, reason: "invalid_founder_number", missing: ["JARVIS_FOUNDER_PHONE_E164"] });
  });

  it("resolves a complete, valid configuration", () => {
    const result = resolveJarvisPhoneCommandConfig(COMPLETE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.config.organizationId).toBe(COMPLETE.JARVIS_PHONE_ORGANIZATION_ID);
    expect(result.config.founderPhoneNumber).toBe("+14165551234");
  });

  it("never throws on a broken environment", () => {
    expect(() => resolveJarvisPhoneCommandConfig({ JARVIS_PHONE_COMMANDS_ENABLED: "true", JARVIS_FOUNDER_PHONE_E164: "nonsense" })).not.toThrow();
  });
});

describe("getJarvisPhoneCommandReadiness", () => {
  it("reports every check complete for a valid configuration", () => {
    const readiness = getJarvisPhoneCommandReadiness(null, COMPLETE);
    expect(readiness).toMatchObject({ enabled: true, ready: true, completedChecks: 5, totalChecks: 5, missing: [] });
  });

  it("reports what is missing in founder-readable language, never a value", () => {
    const readiness = getJarvisPhoneCommandReadiness(null, {});
    expect(readiness.ready).toBe(false);
    expect(readiness.enabled).toBe(false);
    expect(readiness.missing).toContain("Phone commands enabled");
    expect(readiness.missing).toContain("Founder verification secret");
    expect(readiness.missing.join(" ")).not.toMatch(/JARVIS_|SECRET=/);
  });
});
