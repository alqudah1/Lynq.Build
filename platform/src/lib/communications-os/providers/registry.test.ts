import { describe, it, expect } from "vitest";
import { ProviderNotImplementedError, isRealDeliveryProvider, resolveDefaultProviderForChannel, resolveProviderAdapter } from "./registry";
import { devWhatsAppProvider } from "./dev-whatsapp";

describe("provider registry", () => {
  it("resolves a real WhatsApp Cloud API adapter", () => {
    const adapter = resolveProviderAdapter("whatsapp_cloud_api");
    expect(adapter.provider).toBe("whatsapp_cloud_api");
    expect(adapter.channel).toBe("whatsapp");
    expect(adapter.capabilities.supportsDeliveryEvents).toBe(true);
    expect(adapter.capabilities.supportsReadReceipts).toBe(true);
  });

  it("still throws clearly for a provider with no adapter", () => {
    expect(() => resolveProviderAdapter("twilio")).toThrow(ProviderNotImplementedError);
  });

  it("uses the real adapter for a configured WhatsApp connection and the dev one otherwise", () => {
    expect(resolveDefaultProviderForChannel("whatsapp", true)).toBe("whatsapp_cloud_api");
    expect(resolveDefaultProviderForChannel("whatsapp", false)).toBe("dev_whatsapp");
  });
});

describe("the development WhatsApp provider is never real delivery", () => {
  it("is not classified as a real delivery provider", () => {
    expect(isRealDeliveryProvider("dev_whatsapp")).toBe(false);
    expect(isRealDeliveryProvider("dev_email")).toBe(false);
    expect(isRealDeliveryProvider("dev_sms")).toBe(false);
    expect(isRealDeliveryProvider("whatsapp_cloud_api")).toBe(true);
  });

  it("marks the id it returns as a development id, so it can never be mistaken for a wamid", async () => {
    const result = await devWhatsAppProvider.sendMessage(
      { secret: "", externalAccountId: null },
      { organizationId: "org", connectionId: "conn", recipientReference: "+962796940024", senderReference: null, subject: null, bodyText: "hi", idempotencyKey: "k" }
    );
    expect(result.providerMessageId).toMatch(/^dev-whatsapp-/);
    expect(result.providerMessageId).not.toMatch(/^wamid\./);
    expect(result.rawStatusText).toBe("dev-provider-accepted");
  });

  it("says plainly that its verification is not a real account", async () => {
    const verification = await devWhatsAppProvider.verifyConnection({ secret: "", externalAccountId: null });
    expect(verification.detail).toMatch(/development/i);
    expect(verification.externalAccountId).toBe("dev-whatsapp-local");
  });

  it("reports no delivery-event or read-receipt capability, so nothing downstream expects real status", () => {
    expect(devWhatsAppProvider.capabilities.supportsDeliveryEvents).toBe(false);
    expect(devWhatsAppProvider.capabilities.supportsReadReceipts).toBe(false);
  });
});
