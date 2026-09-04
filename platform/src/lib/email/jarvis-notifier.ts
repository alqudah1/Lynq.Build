import "server-only";

import { eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { organizations, projectExecutionLinks, projects, users } from "@/db/schema";
import { notifyFounderByVoice } from "@/lib/voice/notifier";
import type { VoiceDeliveryStatus } from "@/lib/voice/types";
import { resolveConfiguredEmailTransport } from "./resend-transport";
import type { EmailTransport } from "./types";

type Db = NeonHttpDatabase<Record<string, unknown>>;
type NotificationStatus = "sent" | "not_configured" | "failed";
type JarvisNotificationOutcome = { email: NotificationStatus; voice: VoiceDeliveryStatus };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

/** Best-effort founder notification. The approval remains authoritative in Agent Runtime/My Work. */
export async function notifyJarvisApprovalNeeded(
  db: Db,
  input: { organizationId: string; ownerUserId: string; projectId: string; projectName: string; summary: string },
  transport: EmailTransport | null = resolveConfiguredEmailTransport(),
): Promise<JarvisNotificationOutcome> {
  try {
    const [[owner], [organization]] = await Promise.all([
      db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, input.ownerUserId)),
      db.select({ slug: organizations.slug }).from(organizations).where(eq(organizations.id, input.organizationId)),
    ]);
    if (!owner?.email || !organization?.slug) return { email: "failed", voice: "failed" };

    const base = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
    const approvalUrl = `${base}/app/${encodeURIComponent(organization.slug)}/my-work`;
    const name = owner.name?.trim() || "Mustafa";
    const text = `Hi ${name},\n\nJarvis has paused ${input.projectName} because your approval is required.\n\n${input.summary}\n\nReview and decide in LYNQ Office: ${approvalUrl}\n\nNo action will be taken until you approve it.`;
    const voicePromise = notifyFounderByVoice({
      kind: "approval_needed",
      founderName: name,
      projectName: input.projectName,
      summary: input.summary,
      actionUrl: approvalUrl,
      context: { organizationId: input.organizationId, ownerUserId: input.ownerUserId, projectId: input.projectId },
    });

    let email: NotificationStatus = "not_configured";
    if (transport) {
      try {
        await transport.send({
          to: owner.email,
          subject: `Jarvis needs your approval: ${input.projectName}`,
          text,
          html: `<!doctype html><html><body style="margin:0;padding:32px;background:#f5f5f2;font-family:Arial,sans-serif;color:#111"><div style="max-width:580px;margin:auto;background:#fff;padding:32px;border:1px solid #ddd"><p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#666">LYNQ Office · Jarvis</p><h1 style="font-size:25px;margin:12px 0">Your approval is needed</h1><p>Hi ${escapeHtml(name)},</p><p>Jarvis has paused <strong>${escapeHtml(input.projectName)}</strong> because your decision is required.</p><div style="margin:22px 0;padding:16px;border-left:3px solid #111;background:#f5f5f2;white-space:pre-wrap">${escapeHtml(input.summary)}</div><p><a href="${approvalUrl}" style="display:inline-block;padding:13px 18px;background:#111;color:#fff;text-decoration:none">Review in LYNQ Office</a></p><p style="font-size:13px;color:#666">Nothing will continue until you approve it.</p></div></body></html>`,
        });
        email = "sent";
      } catch (error) {
        console.error("[jarvis] approval email notification failed:", error instanceof Error ? error.message : "unknown error");
        email = "failed";
      }
    }
    return { email, voice: await voicePromise };
  } catch (error) {
    console.error("[jarvis] approval notification failed:", error instanceof Error ? error.message : "unknown error");
    return { email: "failed", voice: "failed" };
  }
}

/** Sends only after the runtime retry policy declares the Jarvis job terminal. */
export async function notifyJarvisExecutionStopped(
  db: Db,
  input: { organizationId: string; executionId: string; reason: string; requiresHumanReview: boolean },
  transport: EmailTransport | null = resolveConfiguredEmailTransport(),
): Promise<JarvisNotificationOutcome> {
  try {
    const [context] = await db
      .select({ projectId: projects.id, projectName: projects.name, ownerUserId: projects.ownerUserId, organizationSlug: organizations.slug })
      .from(projectExecutionLinks)
      .innerJoin(projects, eq(projects.id, projectExecutionLinks.projectId))
      .innerJoin(organizations, eq(organizations.id, projects.organizationId))
      .where(eq(projectExecutionLinks.executionId, input.executionId));
    if (!context) return { email: "failed", voice: "failed" };
    const [owner] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, context.ownerUserId));
    if (!owner?.email) return { email: "failed", voice: "failed" };

    const base = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
    const projectUrl = `${base}/app/${encodeURIComponent(context.organizationSlug)}/projects/${encodeURIComponent(context.projectId)}`;
    const name = owner.name?.trim() || "Mustafa";
    const action = input.requiresHumanReview ? "Jarvis needs you to review it before work can continue." : "The step stopped after the runtime retry policy completed.";
    const text = `Hi ${name},\n\nJarvis stopped a step in ${context.projectName}.\n\nReason: ${input.reason}\n\n${action}\n\nOpen the project: ${projectUrl}`;
    const voicePromise = notifyFounderByVoice({
      kind: "execution_stopped",
      founderName: name,
      projectName: context.projectName,
      summary: `${input.reason}. ${action}`.slice(0, 1000),
      actionUrl: projectUrl,
      context: { organizationId: input.organizationId, ownerUserId: context.ownerUserId, projectId: context.projectId },
    });

    let email: NotificationStatus = "not_configured";
    if (transport) {
      try {
        await transport.send({
          to: owner.email,
          subject: `Jarvis needs attention: ${context.projectName}`,
          text,
          html: `<!doctype html><html><body style="margin:0;padding:32px;background:#f5f5f2;font-family:Arial,sans-serif;color:#111"><div style="max-width:580px;margin:auto;background:#fff;padding:32px;border:1px solid #ddd"><p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#666">LYNQ Office · Jarvis</p><h1 style="font-size:25px;margin:12px 0">A project step stopped</h1><p>Hi ${escapeHtml(name)},</p><p>Jarvis stopped a step in <strong>${escapeHtml(context.projectName)}</strong>.</p><div style="margin:22px 0;padding:16px;border-left:3px solid #111;background:#f5f5f2"><strong>Reason</strong><br>${escapeHtml(input.reason)}</div><p>${escapeHtml(action)}</p><p><a href="${projectUrl}" style="display:inline-block;padding:13px 18px;background:#111;color:#fff;text-decoration:none">Open the project</a></p></div></body></html>`,
        });
        email = "sent";
      } catch (error) {
        console.error("[jarvis] failure email notification failed:", error instanceof Error ? error.message : "unknown error");
        email = "failed";
      }
    }
    return { email, voice: await voicePromise };
  } catch (error) {
    console.error("[jarvis] failure notification failed:", error instanceof Error ? error.message : "unknown error");
    return { email: "failed", voice: "failed" };
  }
}

/**
 * The single follow-up at the end of an autonomous run.
 *
 * A founder who handed the directive over gets one message when it is
 * done, not a notification per gate — and it says plainly whether anything
 * still needs him, because "finished" and "finished, but I could not send
 * the email" are different outcomes.
 */
export async function notifyJarvisRunFinished(
  db: Db,
  input: { organizationId: string; ownerUserId: string; projectId: string; projectName: string; headline: string; needsFounder: string[] },
  transport: EmailTransport | null = resolveConfiguredEmailTransport(),
): Promise<JarvisNotificationOutcome> {
  try {
    const [[owner], [organization]] = await Promise.all([
      db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, input.ownerUserId)),
      db.select({ slug: organizations.slug }).from(organizations).where(eq(organizations.id, input.organizationId)),
    ]);
    if (!owner?.email || !organization?.slug) return { email: "failed", voice: "failed" };

    const base = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
    const projectUrl = `${base}/app/${encodeURIComponent(organization.slug)}/jarvis/${encodeURIComponent(input.projectId)}`;
    const name = owner.name?.trim() || "Mustafa";
    const outstanding = input.needsFounder.length > 0
      ? `Still needs you:\n${input.needsFounder.map((item) => `- ${item}`).join("\n")}`
      : "Nothing is waiting on you.";
    const text = `Hi ${name},\n\nJarvis finished ${input.projectName}.\n\n${input.headline}\n\n${outstanding}\n\nRead the full report: ${projectUrl}`;
    const voicePromise = notifyFounderByVoice({
      kind: "approval_needed",
      founderName: name,
      projectName: input.projectName,
      summary: `${input.headline}. ${input.needsFounder.length > 0 ? `${input.needsFounder.length} thing${input.needsFounder.length === 1 ? "" : "s"} still needs you.` : "Nothing is waiting on you."}`.slice(0, 1000),
      actionUrl: projectUrl,
      context: { organizationId: input.organizationId, ownerUserId: input.ownerUserId, projectId: input.projectId },
    });

    let email: NotificationStatus = "not_configured";
    if (transport) {
      try {
        await transport.send({
          to: owner.email,
          subject: `Jarvis finished: ${input.projectName}`,
          text,
          html: `<!doctype html><html><body style="margin:0;padding:32px;background:#f5f5f2;font-family:Arial,sans-serif;color:#111"><div style="max-width:580px;margin:auto;background:#fff;padding:32px;border:1px solid #ddd"><p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#666">LYNQ Office · Jarvis</p><h1 style="font-size:25px;margin:12px 0">${escapeHtml(input.projectName)} is done</h1><p>Hi ${escapeHtml(name)},</p><div style="margin:22px 0;padding:16px;border-left:3px solid #111;background:#f5f5f2">${escapeHtml(input.headline)}</div>${input.needsFounder.length > 0 ? `<p><strong>Still needs you</strong></p><ul>${input.needsFounder.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : `<p style="color:#555">Nothing is waiting on you.</p>`}<p><a href="${projectUrl}" style="display:inline-block;padding:13px 18px;background:#111;color:#fff;text-decoration:none">Read the full report</a></p></div></body></html>`,
        });
        email = "sent";
      } catch (error) {
        console.error("[jarvis] run report email failed:", error instanceof Error ? error.message : "unknown error");
        email = "failed";
      }
    }
    return { email, voice: await voicePromise };
  } catch (error) {
    console.error("[jarvis] run report notification failed:", error instanceof Error ? error.message : "unknown error");
    return { email: "failed", voice: "failed" };
  }
}
