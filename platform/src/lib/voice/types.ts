/**
 * What the call is about. Vapi is told this, and the assistant's script
 * turns on it, so a finished run must not arrive labelled as an approval —
 * the founder would be told his decision is required when it is not.
 */
export type JarvisVoiceNotificationKind = "approval_needed" | "execution_stopped" | "run_finished";

export type JarvisVoiceNotification = {
  kind: JarvisVoiceNotificationKind;
  founderName: string;
  projectName: string;
  summary: string;
  actionUrl: string;
  context?: {
    organizationId: string;
    ownerUserId: string;
    projectId: string;
  };
};

/**
 * `not_needed` is not a failure: the run finished with nothing outstanding,
 * so there was nothing worth ringing a phone about.
 */
export type VoiceDeliveryStatus = "sent" | "not_configured" | "not_needed" | "failed";

export interface JarvisVoiceTransport {
  notifyFounder(notification: JarvisVoiceNotification): Promise<void>;
}
