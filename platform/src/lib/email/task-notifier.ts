import "server-only";
import { eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { projects, users } from "@/db/schema";
import type { ProjectTask } from "@/lib/projects/tasks";
import { resolveConfiguredEmailTransport } from "./resend-transport";
import type { EmailTransport } from "./types";

type Db = NeonHttpDatabase<Record<string, unknown>>;

function officeUrl(organizationSlug: string, projectId: string): string {
  const base = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}/app/${encodeURIComponent(organizationSlug)}/projects/${encodeURIComponent(projectId)}`;
}

/**
 * Sends a best-effort notification after a human task assignment. Assignment
 * is always recorded even when notifications have not been configured yet;
 * that keeps work management reliable while the email provider is optional.
 */
export async function notifyTaskAssigned(
  db: Db,
  input: { organizationSlug: string; task: ProjectTask; assigneeUserId: string; assignerUserId: string },
  transport: EmailTransport | null = resolveConfiguredEmailTransport()
): Promise<"sent" | "not_configured" | "failed"> {
  if (!transport) return "not_configured";

  try {
    const [[assignee], [assigner], [project]] = await Promise.all([
      db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, input.assigneeUserId)),
      db.select({ name: users.name }).from(users).where(eq(users.id, input.assignerUserId)),
      db.select({ name: projects.name }).from(projects).where(eq(projects.id, input.task.projectId)),
    ]);
    if (!assignee?.email) return "failed";

    const assigneeName = assignee.name?.trim() || "there";
    const assignerName = assigner?.name?.trim() || "A LYNQ teammate";
    const projectName = project?.name?.trim() || "a LYNQ project";
    const url = officeUrl(input.organizationSlug, input.task.projectId);
    const due = input.task.dueDate ? `\nDue: ${input.task.dueDate.toLocaleDateString()}` : "";
    const description = input.task.description ? `\n\nDetails:\n${input.task.description}` : "";
    const text = `Hi ${assigneeName},\n\n${assignerName} assigned you a task in ${projectName}.\n\nTask: ${input.task.title}${due}${description}\n\nOpen it in LYNQ Office: ${url}`;

    await transport.send({
      to: assignee.email,
      subject: `New task: ${input.task.title}`,
      text,
      html: `<!doctype html><html><body style="margin:0;padding:32px;background:#f6f6f3;font-family:Arial,sans-serif;color:#171717"><div style="max-width:560px;margin:auto;background:#fff;padding:32px;border:1px solid #e5e5e1"><p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#666">LYNQ Office</p><h1 style="font-size:24px;font-weight:600">You have a new task</h1><p>Hi ${escapeHtml(assigneeName)},</p><p>${escapeHtml(assignerName)} assigned you a task in <strong>${escapeHtml(projectName)}</strong>.</p><p style="padding:16px;border-left:3px solid #171717;background:#f6f6f3"><strong>${escapeHtml(input.task.title)}</strong>${input.task.dueDate ? `<br><span style="color:#555">Due ${escapeHtml(input.task.dueDate.toLocaleDateString())}</span>` : ""}</p>${input.task.description ? `<p style="white-space:pre-wrap">${escapeHtml(input.task.description)}</p>` : ""}<p><a href="${url}" style="display:inline-block;padding:12px 18px;background:#171717;color:#fff;text-decoration:none">Open task in LYNQ Office</a></p></div></body></html>`,
    });
    return "sent";
  } catch (error) {
    console.error("[tasks] assignment notification failed:", error instanceof Error ? error.message : "unknown error");
    return "failed";
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}
