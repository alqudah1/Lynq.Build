import "server-only";

import { z } from "zod";
import { validateFounderVoiceDestination } from "./policy";

/**
 * Configuration for the inbound phone-control lane.
 *
 * Opt-in twice over, matching the precedent `resolveConfiguredJarvisVoiceTransport`
 * already set for outbound calls: the feature flag must be explicitly `true`
 * AND every value must be present and valid. A preview deployment, a copied
 * environment, or a half-finished setup therefore accepts no phone commands
 * at all rather than accepting them into the wrong tenant.
 *
 * `JARVIS_PHONE_COMMANDS_ENABLED` defaults to false. Nothing in this lane
 * writes a row, opens a project, or answers a tool call while it is false.
 *
 * The tenant and founder identity are explicit configuration rather than
 * inferred from the caller's number. Inferring them would mean a spoofed
 * caller ID could select which organization a command lands in; requiring
 * them to be named means a spoofed number can, at worst, fail verification
 * against a tenant that was already fixed at deploy time. Both ids are
 * re-checked against real membership on every call — see
 * `resolvePhoneCommandActor`.
 */

const configSchema = z.object({
  organizationId: z.string().uuid(),
  founderUserId: z.string().uuid(),
  founderPhoneNumber: z.string().min(8),
  verificationSecret: z.string().min(32),
});

export type JarvisPhoneCommandConfig = z.infer<typeof configSchema>;

export function phoneCommandsFlagEnabled(value: string | undefined = process.env.JARVIS_PHONE_COMMANDS_ENABLED): boolean {
  return value?.trim().toLowerCase() === "true";
}

export type PhoneConfigResolution =
  | { ok: true; config: JarvisPhoneCommandConfig }
  | { ok: false; reason: "disabled" | "incomplete_configuration" | "invalid_founder_number"; missing: string[] };

type PhoneEnvironment = Partial<
  Record<
    | "JARVIS_PHONE_COMMANDS_ENABLED"
    | "JARVIS_PHONE_ORGANIZATION_ID"
    | "JARVIS_PHONE_FOUNDER_USER_ID"
    | "JARVIS_PHONE_VERIFICATION_SECRET"
    | "JARVIS_FOUNDER_PHONE_E164",
    string
  >
>;

/**
 * Never throws — a misconfiguration is a state the webhook must report
 * honestly ("phone commands are not configured"), not an exception that turns
 * into an opaque 500 for the provider and a silent dead end for the founder.
 */
export function resolveJarvisPhoneCommandConfig(
  environment: PhoneEnvironment = process.env as PhoneEnvironment
): PhoneConfigResolution {
  if (!phoneCommandsFlagEnabled(environment.JARVIS_PHONE_COMMANDS_ENABLED)) {
    return { ok: false, reason: "disabled", missing: [] };
  }

  const candidate = {
    organizationId: environment.JARVIS_PHONE_ORGANIZATION_ID?.trim(),
    founderUserId: environment.JARVIS_PHONE_FOUNDER_USER_ID?.trim(),
    founderPhoneNumber: environment.JARVIS_FOUNDER_PHONE_E164?.trim(),
    verificationSecret: environment.JARVIS_PHONE_VERIFICATION_SECRET?.trim(),
  };

  const parsed = configSchema.safeParse(candidate);
  if (!parsed.success) {
    const fieldToEnv: Record<string, string> = {
      organizationId: "JARVIS_PHONE_ORGANIZATION_ID",
      founderUserId: "JARVIS_PHONE_FOUNDER_USER_ID",
      founderPhoneNumber: "JARVIS_FOUNDER_PHONE_E164",
      verificationSecret: "JARVIS_PHONE_VERIFICATION_SECRET",
    };
    const missing = Object.keys(parsed.error.flatten().fieldErrors).map((field) => fieldToEnv[field] ?? field);
    return { ok: false, reason: "incomplete_configuration", missing };
  }

  try {
    // Reuses the existing founder-destination policy unchanged: E.164, +1
    // only, never an emergency destination.
    validateFounderVoiceDestination(parsed.data.founderPhoneNumber);
  } catch {
    return { ok: false, reason: "invalid_founder_number", missing: ["JARVIS_FOUNDER_PHONE_E164"] };
  }

  return { ok: true, config: parsed.data };
}

/**
 * Readiness for the Jarvis Command Center, in the same shape
 * `getJarvisVoiceReadiness` already returns for the outbound lane, so the UI
 * can render both with one component and never claim a capability that is not
 * actually configured.
 */
export interface JarvisPhoneCommandReadiness {
  enabled: boolean;
  ready: boolean;
  completedChecks: number;
  totalChecks: number;
  missing: string[];
}

export function getJarvisPhoneCommandReadiness(
  environment: PhoneEnvironment = process.env as PhoneEnvironment
): JarvisPhoneCommandReadiness {
  const checks = [
    { label: "Phone commands enabled", complete: phoneCommandsFlagEnabled(environment.JARVIS_PHONE_COMMANDS_ENABLED) },
    { label: "Command organization", complete: z.string().uuid().safeParse(environment.JARVIS_PHONE_ORGANIZATION_ID?.trim()).success },
    { label: "Founder account", complete: z.string().uuid().safeParse(environment.JARVIS_PHONE_FOUNDER_USER_ID?.trim()).success },
    { label: "Founder verification secret", complete: (environment.JARVIS_PHONE_VERIFICATION_SECRET?.trim().length ?? 0) >= 32 },
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
  ];

  const completedChecks = checks.filter((check) => check.complete).length;
  return {
    enabled: checks[0].complete,
    ready: completedChecks === checks.length,
    completedChecks,
    totalChecks: checks.length,
    missing: checks.filter((check) => !check.complete).map((check) => check.label),
  };
}
