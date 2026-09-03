import "server-only";

import { founderVoiceNotificationsEnabled, validateFounderVoiceDestination } from "./policy";

export type JarvisVoiceReadiness = {
  ready: boolean;
  callingReady: boolean;
  activityTrackingReady: boolean;
  enabled: boolean;
  completedChecks: number;
  totalChecks: number;
  missing: string[];
};

type VoiceEnvironment = Partial<Record<
  | "JARVIS_VOICE_NOTIFICATIONS_ENABLED"
  | "VAPI_API_KEY"
  | "VAPI_ASSISTANT_ID"
  | "VAPI_PHONE_NUMBER_ID"
  | "JARVIS_FOUNDER_PHONE_E164"
  | "VAPI_WEBHOOK_SECRET",
  string
>>;

export function getJarvisVoiceReadiness(environment: VoiceEnvironment = process.env as VoiceEnvironment): JarvisVoiceReadiness {
  const checks = [
    { label: "Voice notifications enabled", complete: founderVoiceNotificationsEnabled(environment.JARVIS_VOICE_NOTIFICATIONS_ENABLED) },
    { label: "Vapi private key", complete: Boolean(environment.VAPI_API_KEY?.trim()) },
    { label: "Jarvis voice assistant", complete: Boolean(environment.VAPI_ASSISTANT_ID?.trim()) },
    { label: "Imported Twilio number", complete: Boolean(environment.VAPI_PHONE_NUMBER_ID?.trim()) },
    {
      label: "Founder phone number",
      complete: (() => {
        try {
          if (!environment.JARVIS_FOUNDER_PHONE_E164) return false;
          validateFounderVoiceDestination(environment.JARVIS_FOUNDER_PHONE_E164);
          return true;
        } catch {
          return false;
        }
      })(),
    },
    // Length, not just presence: the webhook route refuses a secret shorter
    // than this, so reporting "ready" for one would be a lie.
    { label: "Secure call-status connection", complete: (environment.VAPI_WEBHOOK_SECRET?.trim().length ?? 0) >= 32 },
  ];
  const completedChecks = checks.filter((check) => check.complete).length;
  const callingReady = checks.slice(0, 5).every((check) => check.complete);
  const activityTrackingReady = checks[5].complete;

  return {
    ready: callingReady && activityTrackingReady,
    callingReady,
    activityTrackingReady,
    enabled: checks[0].complete,
    completedChecks,
    totalChecks: checks.length,
    missing: checks.filter((check) => !check.complete).map((check) => check.label),
  };
}
