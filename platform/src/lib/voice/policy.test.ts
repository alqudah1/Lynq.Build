import { describe, expect, it } from "vitest";
import { founderVoiceNotificationsEnabled, validateFounderVoiceDestination, VoicePolicyError } from "./policy";

describe("Jarvis founder voice policy", () => {
  it("accepts a North American founder number in E.164 format", () => {
    expect(validateFounderVoiceDestination("+14165551234")).toBe("+14165551234");
  });

  it("rejects malformed, international and emergency destinations", () => {
    expect(() => validateFounderVoiceDestination("4165551234")).toThrow(VoicePolicyError);
    expect(() => validateFounderVoiceDestination("+442071838750")).toThrow(VoicePolicyError);
    expect(() => validateFounderVoiceDestination("+1911")).toThrow(VoicePolicyError);
  });

  it("requires an explicit true opt-in", () => {
    expect(founderVoiceNotificationsEnabled(undefined)).toBe(false);
    expect(founderVoiceNotificationsEnabled("false")).toBe(false);
    expect(founderVoiceNotificationsEnabled("TRUE")).toBe(true);
  });
});
