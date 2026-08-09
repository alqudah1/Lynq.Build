import "server-only";
import { eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { organizations, workspaces, users } from "@/db/schema";
import type { CreateOrRefreshInvitationResult } from "@/lib/invitations/invitations";
import { renderInvitationEmail } from "./render";
import { resolveConfiguredEmailTransport } from "./resend-transport";
import type { EmailTransport } from "./types";

type Db = NeonHttpDatabase<Record<string, unknown>>;

/**
 * Deliberately lives in `@/lib/email`, not `@/lib/invitations` — this is the
 * composition point that bridges an invitation-domain result to the email
 * system, so the invitation domain itself (`@/lib/invitations/*`) never
 * imports Resend or any transport directly. Only a type-only import runs
 * the other direction (this file needs to know the shape of what it's
 * rendering), which carries no runtime coupling.
 */
/**
 * Points at the single raw-token exchange endpoint (Step 4C.1 hardening
 * pass) — `GET /invite/{rawToken}` — never at a URL the invited person
 * would need to revisit or share; the exchange immediately trades this for
 * a signed continuation cookie and redirects to the clean, token-free
 * `/invite` landing.
 */
function buildInvitationAcceptUrl(rawToken: string): string {
  const base = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}/invite/${encodeURIComponent(rawToken)}`;
}

/**
 * Best-effort invitation-email delivery — the caller (the invitation route)
 * always treats invitation creation/refresh as successful regardless of
 * what happens here. Resolves the transport from environment configuration
 * unless one is explicitly passed (tests inject an `InMemoryEmailTransport`
 * here instead of relying on `RESEND_API_KEY` — Step 4C: "Do not require
 * Resend credentials for local tests or builds"). A `null` transport (the
 * default when unconfigured) means "skip sending" — never an error.
 */
export async function notifyInvitationCreated(
  db: Db,
  result: CreateOrRefreshInvitationResult,
  inviterUserId: string,
  transport: EmailTransport | null = resolveConfiguredEmailTransport()
): Promise<void> {
  if (!transport) return;

  try {
    const [org] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, result.invitation.organizationId));
    const [inviter] = await db.select({ name: users.name }).from(users).where(eq(users.id, inviterUserId));

    let workspaceName: string | null = null;
    if (result.invitation.workspaceId) {
      const [ws] = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, result.invitation.workspaceId));
      workspaceName = ws?.name ?? null;
    }

    const message = renderInvitationEmail({
      to: result.invitation.email,
      organizationName: org?.name ?? "your organization",
      inviterName: inviter?.name ?? null,
      role: result.invitation.role,
      workspaceName,
      workspaceRole: result.invitation.workspaceRole,
      acceptUrl: buildInvitationAcceptUrl(result.rawToken),
      expiresAt: result.invitation.expiresAt,
    });

    await transport.send(message);
  } catch (err) {
    // Never fails invitation creation, and never logs the message itself
    // (it contains the accept URL / raw token) — only the fact of failure.
    console.error("[invitations] invitation email delivery failed:", err instanceof Error ? err.message : "unknown error");
  }
}
