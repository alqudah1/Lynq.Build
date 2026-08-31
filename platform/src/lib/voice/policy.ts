const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

export class VoicePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoicePolicyError";
  }
}

/**
 * Phase one is deliberately founder-only and North America-only. Customer,
 * prospect, restaurant, emergency-service and international calling are not
 * reachable through this adapter. Those require a separate approval policy,
 * consent evidence, calling hours, suppression rules and spend controls.
 */
export function validateFounderVoiceDestination(value: string): string {
  const number = value.trim();
  if (!E164_PATTERN.test(number)) {
    throw new VoicePolicyError("Founder phone number must use E.164 format.");
  }
  if (!number.startsWith("+1")) {
    throw new VoicePolicyError("Jarvis founder notifications are restricted to Canada and the United States.");
  }
  if (number === "+1911") {
    throw new VoicePolicyError("Emergency destinations are never allowed.");
  }
  return number;
}

export function founderVoiceNotificationsEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}
