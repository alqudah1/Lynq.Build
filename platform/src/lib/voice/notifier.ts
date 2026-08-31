import "server-only";

import { resolveConfiguredJarvisVoiceTransport } from "./vapi";
import type { JarvisVoiceNotification, JarvisVoiceTransport, VoiceDeliveryStatus } from "./types";

/** Best-effort by design: a voice-provider outage must never undo Office work. */
export async function notifyFounderByVoice(
  notification: JarvisVoiceNotification,
  transport: JarvisVoiceTransport | null = resolveConfiguredJarvisVoiceTransport(),
): Promise<VoiceDeliveryStatus> {
  if (!transport) return "not_configured";
  try {
    await transport.notifyFounder(notification);
    return "sent";
  } catch (error) {
    console.error("[jarvis] voice notification failed:", error instanceof Error ? error.message : "unknown error");
    return "failed";
  }
}
