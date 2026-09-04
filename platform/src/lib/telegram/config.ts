import { z } from "zod";

/**
 * Configuration for the Telegram control lane.
 *
 * Opt-in twice over, exactly as the phone lane is: the flag must be
 * explicitly `true` AND every value must be present and valid, or the
 * webhook accepts nothing at all. A preview deployment or a half-finished
 * setup therefore refuses every update rather than accepting one into the
 * wrong tenant.
 *
 * The tenant and the founder identity are configuration, not something
 * inferred from who happens to message the bot. Anyone can message a bot;
 * that is the whole point of a bot. Fixing the tenant at deploy time means
 * an unknown sender can at worst fail to link against a tenant that was
 * already decided, never choose one.
 *
 * This module reads the environment and nothing else — no network, no
 * database — so it is unit-tested directly.
 */

/**
 * Telegram's own minimum for the secret-token header is one character,
 * which is not a security control. This is the length that makes checking
 * the header worth anything.
 */
export const MIN_WEBHOOK_SECRET_LENGTH = 24;

const configSchema = z.object({
  botToken: z.string().min(20),
  webhookSecret: z.string().min(MIN_WEBHOOK_SECRET_LENGTH),
  organizationId: z.string().uuid(),
  founderUserId: z.string().uuid(),
  linkSecret: z.string().min(32),
});

export type JarvisTelegramConfig = z.infer<typeof configSchema>;

export type TelegramEnvironment = {
  JARVIS_TELEGRAM_ENABLED?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  JARVIS_TELEGRAM_ORGANIZATION_ID?: string;
  JARVIS_TELEGRAM_FOUNDER_USER_ID?: string;
  JARVIS_TELEGRAM_LINK_SECRET?: string;
  /** The phone lane's identity, reused when the Telegram-specific values are absent. */
  JARVIS_PHONE_ORGANIZATION_ID?: string;
  JARVIS_PHONE_FOUNDER_USER_ID?: string;
  JARVIS_PHONE_VERIFICATION_SECRET?: string;
};

export type TelegramConfigResolution =
  | { ok: true; config: JarvisTelegramConfig }
  | { ok: false; reason: "disabled" | "incomplete_configuration"; missing: string[] };

export function telegramControlEnabled(value: string | undefined = process.env.JARVIS_TELEGRAM_ENABLED): boolean {
  return value?.trim().toLowerCase() === "true";
}

/**
 * Never throws. A misconfiguration is a state the webhook reports honestly
 * rather than an exception that becomes an opaque 500 to Telegram and a
 * silent dead end for the founder.
 */
export function resolveTelegramConfig(environment: TelegramEnvironment = process.env as TelegramEnvironment): TelegramConfigResolution {
  if (!telegramControlEnabled(environment.JARVIS_TELEGRAM_ENABLED)) {
    return { ok: false, reason: "disabled", missing: [] };
  }

  // The founder identity is the same person on both channels, so the phone
  // lane's values are accepted as a fallback. Naming them explicitly still
  // wins, because a workspace may want Telegram pointed somewhere else.
  const candidate = {
    botToken: environment.TELEGRAM_BOT_TOKEN?.trim(),
    webhookSecret: environment.TELEGRAM_WEBHOOK_SECRET?.trim(),
    organizationId: (environment.JARVIS_TELEGRAM_ORGANIZATION_ID ?? environment.JARVIS_PHONE_ORGANIZATION_ID)?.trim(),
    founderUserId: (environment.JARVIS_TELEGRAM_FOUNDER_USER_ID ?? environment.JARVIS_PHONE_FOUNDER_USER_ID)?.trim(),
    linkSecret: (environment.JARVIS_TELEGRAM_LINK_SECRET ?? environment.JARVIS_PHONE_VERIFICATION_SECRET)?.trim(),
  };

  const parsed = configSchema.safeParse(candidate);
  if (parsed.success) return { ok: true, config: parsed.data };

  const fieldToEnv: Record<string, string> = {
    botToken: "TELEGRAM_BOT_TOKEN",
    webhookSecret: "TELEGRAM_WEBHOOK_SECRET",
    organizationId: "JARVIS_TELEGRAM_ORGANIZATION_ID",
    founderUserId: "JARVIS_TELEGRAM_FOUNDER_USER_ID",
    linkSecret: "JARVIS_TELEGRAM_LINK_SECRET",
  };
  return {
    ok: false,
    reason: "incomplete_configuration",
    missing: Object.keys(parsed.error.flatten().fieldErrors).map((field) => fieldToEnv[field] ?? field),
  };
}

/**
 * The HMAC scope for a Telegram pairing code.
 *
 * Deliberately different from the phone lane's, so a passcode read aloud on
 * a call can never be replayed to link a Telegram account, and vice versa.
 */
export const TELEGRAM_LINK_SCOPE = "jarvis-telegram-link";

/** How many failed pairing attempts one chat may make in an hour before it is refused outright. */
export const MAX_LINK_ATTEMPTS_PER_HOUR = 5;
