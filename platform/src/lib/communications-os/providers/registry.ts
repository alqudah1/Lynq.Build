import type { IntegrationProvider } from "../validation";
import type { ProviderAdapter } from "./types";
import { devEmailProvider } from "./dev-email";
import { devSmsProvider } from "./dev-sms";
import { devWhatsAppProvider } from "./dev-whatsapp";
import { resendProvider } from "./resend";
import { whatsAppCloudApiProvider } from "./whatsapp-cloud";

/**
 * In-code, typed registry — the identical "no dynamic require/import,
 * no data-driven dispatch" discipline as Module 14's agent task handler
 * registry and Marketing OS's audience filter registry. Adding a real
 * Twilio/WhatsApp Cloud API adapter later is a new file plus one more
 * entry here, never a schema change.
 */
const PROVIDERS: Record<IntegrationProvider, ProviderAdapter> = {
  resend: resendProvider,
  dev_email: devEmailProvider,
  dev_sms: devSmsProvider,
  dev_whatsapp: devWhatsAppProvider,
  whatsapp_cloud_api: whatsAppCloudApiProvider,
  // Twilio SMS remains architected-for but unimplemented (the
  // `integration_provider` enum already has room, `ProviderAdapter` is
  // channel-agnostic). Resolving it throws clearly rather than silently
  // falling back to a dev provider under a real-sounding name.
  twilio: undefined as unknown as ProviderAdapter,
};

export class ProviderNotImplementedError extends Error {
  constructor(provider: IntegrationProvider) {
    super(`Provider "${provider}" has no adapter implementation yet — architecture is ready, credentials/implementation are not.`);
    this.name = "ProviderNotImplementedError";
  }
}

export function resolveProviderAdapter(provider: IntegrationProvider): ProviderAdapter {
  const adapter = PROVIDERS[provider];
  if (!adapter) throw new ProviderNotImplementedError(provider);
  return adapter;
}

/**
 * The provider a fresh connection for a given channel should use — the real
 * adapter when a real credential is configured, the truthful development
 * provider otherwise. Never silently "upgrades" to a provider name that
 * would misrepresent what actually sent the message, and never silently
 * DOWNGRADES a caller who believes they are on the real WhatsApp Cloud API
 * to `dev_whatsapp`.
 */
export function resolveDefaultProviderForChannel(channel: "email" | "sms" | "whatsapp", hasRealCredentialConfigured: boolean): IntegrationProvider {
  if (channel === "email") return hasRealCredentialConfigured ? "resend" : "dev_email";
  if (channel === "sms") return "dev_sms";
  return hasRealCredentialConfigured ? "whatsapp_cloud_api" : "dev_whatsapp";
}

/**
 * True only for providers that can actually deliver to a real recipient.
 * Every surface that reports "sent" to a human reads this, so a
 * development-provider log line can never be presented as delivery.
 */
export function isRealDeliveryProvider(provider: IntegrationProvider): boolean {
  return provider === "resend" || provider === "whatsapp_cloud_api" || provider === "twilio";
}
