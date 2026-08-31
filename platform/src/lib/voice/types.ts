export type JarvisVoiceNotificationKind = "approval_needed" | "execution_stopped";

export type JarvisVoiceNotification = {
  kind: JarvisVoiceNotificationKind;
  founderName: string;
  projectName: string;
  summary: string;
  actionUrl: string;
};

export type VoiceDeliveryStatus = "sent" | "not_configured" | "failed";

export interface JarvisVoiceTransport {
  notifyFounder(notification: JarvisVoiceNotification): Promise<void>;
}
