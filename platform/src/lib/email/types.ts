/**
 * Provider-neutral transactional email boundary (Step 4C). The invitation
 * domain (`@/lib/invitations`) depends only on `EmailTransport` and
 * `InvitationEmailPayload` from this file — it must never import Resend,
 * Zoho, or any other vendor SDK/client directly. Which concrete transport is
 * actually used is a composition-root decision made by the route handler
 * that calls the invitation domain service, not by the domain service
 * itself.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailTransport {
  send(message: EmailMessage): Promise<void>;
}

export interface InvitationEmailPayload {
  to: string;
  organizationName: string;
  inviterName: string | null;
  role: "owner" | "admin" | "member" | "viewer";
  workspaceName: string | null;
  workspaceRole: "manager" | "member" | "viewer" | null;
  /**
   * Contains the raw invitation token embedded as a URL query/path
   * component. Received by the rendering function ONLY transiently — never
   * persisted, never logged, and never returned from any HTTP response.
   */
  acceptUrl: string;
  expiresAt: Date;
}
