import { describe, expect, it } from "vitest";
import { MIN_WEBHOOK_SECRET_LENGTH, resolveTelegramConfig, telegramControlEnabled, type TelegramEnvironment } from "./config";

/**
 * The lane is off unless every part of it is present and valid. A
 * half-configured deployment must accept nothing rather than accept an
 * update into a guessed tenant.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const FOUNDER = "22222222-2222-4222-8222-222222222222";
const SECRET = "s".repeat(32);
const WEBHOOK = "w".repeat(MIN_WEBHOOK_SECRET_LENGTH);
const TOKEN = "1234567890:AAaaBBbbCCccDDddEEeeFFff";

const complete: TelegramEnvironment = {
  JARVIS_TELEGRAM_ENABLED: "true",
  TELEGRAM_BOT_TOKEN: TOKEN,
  TELEGRAM_WEBHOOK_SECRET: WEBHOOK,
  JARVIS_TELEGRAM_ORGANIZATION_ID: ORG,
  JARVIS_TELEGRAM_FOUNDER_USER_ID: FOUNDER,
  JARVIS_TELEGRAM_LINK_SECRET: SECRET,
};

describe("the Telegram lane switch", () => {
  it("is off unless the flag says exactly true", () => {
    expect(telegramControlEnabled("true")).toBe(true);
    expect(telegramControlEnabled(" TRUE ")).toBe(true);
    expect(telegramControlEnabled("1")).toBe(false);
    expect(telegramControlEnabled("yes")).toBe(false);
    expect(telegramControlEnabled(undefined)).toBe(false);
  });

  it("refuses everything when the flag is off, even with a complete configuration", () => {
    expect(resolveTelegramConfig({ ...complete, JARVIS_TELEGRAM_ENABLED: "false" })).toEqual({ ok: false, reason: "disabled", missing: [] });
  });

  it("resolves a complete configuration", () => {
    const resolution = resolveTelegramConfig(complete);
    expect(resolution.ok).toBe(true);
    if (resolution.ok) expect(resolution.config).toEqual({ botToken: TOKEN, webhookSecret: WEBHOOK, organizationId: ORG, founderUserId: FOUNDER, linkSecret: SECRET });
  });

  it("names exactly what is missing, and never what a secret looks like", () => {
    const resolution = resolveTelegramConfig({ JARVIS_TELEGRAM_ENABLED: "true" });
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.reason).toBe("incomplete_configuration");
      expect(resolution.missing).toEqual(expect.arrayContaining(["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "JARVIS_TELEGRAM_ORGANIZATION_ID"]));
    }
  });

  it("refuses a webhook secret short enough to guess", () => {
    const resolution = resolveTelegramConfig({ ...complete, TELEGRAM_WEBHOOK_SECRET: "short" });
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) expect(resolution.missing).toContain("TELEGRAM_WEBHOOK_SECRET");
  });

  it("refuses an organization id that is not a real id", () => {
    const resolution = resolveTelegramConfig({ ...complete, JARVIS_TELEGRAM_ORGANIZATION_ID: "my-workspace" });
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) expect(resolution.missing).toContain("JARVIS_TELEGRAM_ORGANIZATION_ID");
  });

  it("falls back to the phone lane's identity, because it is the same founder", () => {
    const resolution = resolveTelegramConfig({
      JARVIS_TELEGRAM_ENABLED: "true",
      TELEGRAM_BOT_TOKEN: TOKEN,
      TELEGRAM_WEBHOOK_SECRET: WEBHOOK,
      JARVIS_PHONE_ORGANIZATION_ID: ORG,
      JARVIS_PHONE_FOUNDER_USER_ID: FOUNDER,
      JARVIS_PHONE_VERIFICATION_SECRET: SECRET,
    });
    expect(resolution.ok).toBe(true);
    if (resolution.ok) expect(resolution.config.organizationId).toBe(ORG);
  });

  it("prefers an explicitly named Telegram identity over the phone one", () => {
    const other = "33333333-3333-4333-8333-333333333333";
    const resolution = resolveTelegramConfig({ ...complete, JARVIS_PHONE_ORGANIZATION_ID: other });
    expect(resolution.ok).toBe(true);
    if (resolution.ok) expect(resolution.config.organizationId).toBe(ORG);
  });
});
