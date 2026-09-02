import "server-only";

import { founderVoiceNotificationsEnabled, validateFounderVoiceDestination } from "./policy";
import type { JarvisVoiceNotification, JarvisVoiceTransport } from "./types";

const VAPI_CALLS_URL = "https://api.vapi.ai/call";

type FetchLike = typeof fetch;

export class VapiJarvisVoiceTransport implements JarvisVoiceTransport {
  constructor(
    private readonly config: {
      apiKey: string;
      assistantId: string;
      phoneNumberId: string;
      founderPhoneNumber: string;
    },
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async notifyFounder(notification: JarvisVoiceNotification): Promise<void> {
    const destination = validateFounderVoiceDestination(this.config.founderPhoneNumber);
    console.info("[jarvis-voice]", JSON.stringify({ event: "call-requested", provider: "vapi", notificationType: notification.kind }));
    const response = await this.fetchImpl(VAPI_CALLS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assistantId: this.config.assistantId,
        phoneNumberId: this.config.phoneNumberId,
        customer: { number: destination },
        metadata: notification.context
          ? {
              source: "lynq-office",
              schemaVersion: 1,
              organizationId: notification.context.organizationId,
              ownerUserId: notification.context.ownerUserId,
              projectId: notification.context.projectId,
            }
          : { source: "lynq-office", schemaVersion: 1 },
        assistantOverrides: {
          variableValues: {
            founder_name: notification.founderName,
            notification_type: notification.kind,
            project_name: notification.projectName,
            notification_summary: notification.summary,
            action_url: notification.actionUrl,
          },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`Vapi call request failed with status ${response.status}`);
    }

    const payload = (await response.json().catch(() => null)) as { id?: string; status?: string } | null;
    console.info("[jarvis-voice]", JSON.stringify({
      event: "call-accepted",
      provider: "vapi",
      notificationType: notification.kind,
      providerCallId: payload?.id ?? null,
      status: payload?.status ?? "queued",
    }));
  }
}

/**
 * Voice is opt-in even when credentials exist. This prevents a preview,
 * test, copied environment, or partial configuration from placing a call.
 */
export function resolveConfiguredJarvisVoiceTransport(): JarvisVoiceTransport | null {
  if (!founderVoiceNotificationsEnabled(process.env.JARVIS_VOICE_NOTIFICATIONS_ENABLED)) return null;

  const apiKey = process.env.VAPI_API_KEY;
  const assistantId = process.env.VAPI_ASSISTANT_ID;
  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
  const founderPhoneNumber = process.env.JARVIS_FOUNDER_PHONE_E164;
  if (!apiKey || !assistantId || !phoneNumberId || !founderPhoneNumber) return null;

  validateFounderVoiceDestination(founderPhoneNumber);
  return new VapiJarvisVoiceTransport({ apiKey, assistantId, phoneNumberId, founderPhoneNumber });
}
