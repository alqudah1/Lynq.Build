import "server-only";

import { eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { organizations, users } from "@/db/schema";
import { resolveConfiguredEmailTransport } from "./resend-transport";
import type { EmailTransport } from "./types";

type Db = NeonHttpDatabase<Record<string, unknown>>;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

/** Best-effort founder notification. The approval remains authoritative in Agent Runtime/My Work. */
export async function notifyJarvisApprovalNeeded(
  db: Db,
  input: { organizationId: string; ownerUserId: string; projectName: string; summary: string },
  transport: EmailTransport | null = resolveConfiguredEmailTransport(),
): Promise<"sent" | "not_configured" | "failed"> {
  if (!transport) return "not_configured";

  try {
    const [[owner], [organization]] = await Promise.all([
      db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, input.ownerUserId)),
      db.select({ slug: organizations.slug }).from(organizations).where(eq(organizations.id, input.organizationId)),
    ]);
    if (!owner?.email || !organization?.slug) return "failed";

    const base = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
    const approvalUrl = `${base}/app/${encodeURIComponent(organization.slug)}/my-work`;
    const name = owner.name?.trim() || "Mustafa";
    const text = `Hi ${name},\n\nJarvis has paused ${input.projectName} because your approval is required.\n\n${input.summary}\n\nReview and decide in LYNQ Office: ${approvalUrl}\n\nNo action will be taken until you approve it.`;

    await transport.send({
      to: owner.email,
      subject: `Jarvis needs your approval: ${input.projectName}`,
      text,
      html: `<!doctype html><html><body style="margin:0;padding:32px;background:#f5f5f2;font-family:Arial,sans-serif;color:#111"><div style="max-width:580px;margin:auto;background:#fff;padding:32px;border:1px solid #ddd"><p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#666">LYNQ Office · Jarvis</p><h1 style="font-size:25px;margin:12px 0">Your approval is needed</h1><p>Hi ${escapeHtml(name)},</p><p>Jarvis has paused <strong>${escapeHtml(input.projectName)}</strong> because your decision is required.</p><div style="margin:22px 0;padding:16px;border-left:3px solid #111;background:#f5f5f2;white-space:pre-wrap">${escapeHtml(input.summary)}</div><p><a href="${approvalUrl}" style="display:inline-block;padding:13px 18px;background:#111;color:#fff;text-decoration:none">Review in LYNQ Office</a></p><p style="font-size:13px;color:#666">Nothing will continue until you approve it.</p></div></body></html>`,
    });
    return "sent";
  } catch (error) {
    console.error("[jarvis] approval notification failed:", error instanceof Error ? error.message : "unknown error");
    return "failed";
  }
}
