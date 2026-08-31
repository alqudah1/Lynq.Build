import { describe, expect, it } from "vitest";
import { getJarvisVoiceReadiness } from "./readiness";

describe("getJarvisVoiceReadiness", () => {
  it("reports every missing setup item without exposing values", () => {
    const result = getJarvisVoiceReadiness({});
    expect(result).toMatchObject({ ready: false, callingReady: false, completedChecks: 0, totalChecks: 6 });
    expect(result.missing).toEqual([
      "Voice notifications enabled",
      "Vapi private key",
      "Jarvis voice assistant",
      "Imported Twilio number",
      "Founder phone number",
      "Secure call-status connection",
    ]);
  });

  it("reports ready only when founder calling and activity tracking are both secured", () => {
    const result = getJarvisVoiceReadiness({
      JARVIS_VOICE_NOTIFICATIONS_ENABLED: "true",
      VAPI_API_KEY: "private-key",
      VAPI_ASSISTANT_ID: "assistant-1",
      VAPI_PHONE_NUMBER_ID: "phone-1",
      JARVIS_FOUNDER_PHONE_E164: "+14165551234",
      VAPI_WEBHOOK_SECRET: "webhook-secret",
    });
    expect(result).toMatchObject({ ready: true, callingReady: true, activityTrackingReady: true, completedChecks: 6 });
    expect(result.missing).toEqual([]);
  });

  it("rejects a non-North-American founder destination", () => {
    const result = getJarvisVoiceReadiness({
      JARVIS_VOICE_NOTIFICATIONS_ENABLED: "true",
      VAPI_API_KEY: "private-key",
      VAPI_ASSISTANT_ID: "assistant-1",
      VAPI_PHONE_NUMBER_ID: "phone-1",
      JARVIS_FOUNDER_PHONE_E164: "+962790000000",
      VAPI_WEBHOOK_SECRET: "webhook-secret",
    });
    expect(result.callingReady).toBe(false);
    expect(result.missing).toContain("Founder phone number");
  });
});
