import "server-only";

// Outbound notification for a new contact enquiry.
//
// THE RULE THIS FOLLOWS: the database is the source of record. Email is a
// convenience on top of it. A notification failure must never turn a saved
// enquiry into an error for the customer.
//
// No mail provider existed in this repository and none has been invented. This
// talks to Resend's HTTP API with `fetch`, so there is no new dependency and
// no SDK to keep current. Two environment variables switch it on:
//
//   RESEND_API_KEY          the provider credential  (NOT set anywhere yet)
//   ARCUBED_CONTACT_EMAIL   where Rand wants enquiries  (NOT set anywhere yet)
//
// Optional:
//   ARCUBED_CONTACT_FROM    verified sender, defaults to onboarding@resend.dev
//
// Until BOTH required values exist, notifyStatus() reports `unconfigured` and
// nothing is sent. Nothing here guesses an address: sending customer messages
// to an invented inbox would be worse than not sending them.

import { logOrderError } from "@/lib/logger";

export type NotifyOutcome = "sent" | "unconfigured" | "failed";

export interface InquiryNotification {
  name: string;
  email: string;
  topic: string;
  message: string;
}

/** What the deployment is currently able to do, for diagnostics. */
export function notifyStatus(): {
  configured: boolean;
  missing: string[];
  provider: "resend" | null;
} {
  const missing: string[] = [];
  if (!process.env.RESEND_API_KEY) missing.push("RESEND_API_KEY");
  if (!process.env.ARCUBED_CONTACT_EMAIL) missing.push("ARCUBED_CONTACT_EMAIL");
  return {
    configured: missing.length === 0,
    missing,
    provider: process.env.RESEND_API_KEY ? "resend" : null,
  };
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function notifyInquiry(inquiry: InquiryNotification): Promise<NotifyOutcome> {
  const to = process.env.ARCUBED_CONTACT_EMAIL;
  const key = process.env.RESEND_API_KEY;
  if (!to || !key) return "unconfigured";

  const from = process.env.ARCUBED_CONTACT_FROM || "Arcubed <onboarding@resend.dev>";
  const when = new Date().toISOString();
  const lines = [
    ["Name", inquiry.name],
    ["Email", inquiry.email],
    ["Topic", inquiry.topic],
    ["Received", when],
  ];

  const text =
    `New Arcubed enquiry\n\n` +
    lines.map(([k, v]) => `${k}: ${v}`).join("\n") +
    `\n\nMessage:\n${inquiry.message}\n`;

  const html =
    `<h2 style="font-family:Georgia,serif;color:#143562;margin:0 0 16px">New Arcubed enquiry</h2>` +
    `<table style="font-family:system-ui,sans-serif;font-size:14px;color:#143562;border-collapse:collapse">` +
    lines
      .map(
        ([k, v]) =>
          `<tr><td style="padding:4px 16px 4px 0;opacity:.6">${escapeHtml(k)}</td>` +
          `<td style="padding:4px 0">${escapeHtml(v)}</td></tr>`
      )
      .join("") +
    `</table>` +
    `<p style="font-family:system-ui,sans-serif;font-size:14px;color:#143562;white-space:pre-wrap;` +
    `margin:20px 0 0;padding-top:16px;border-top:1px solid #dfe3ea">${escapeHtml(inquiry.message)}</p>`;

  try {
    // Reply-To is the customer's address so Rand can answer straight from the
    // notification. It is only set when it passes the same shape check the
    // server action already applied, so a malformed value cannot land in a
    // header.
    const replyTo = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inquiry.email) ? inquiry.email : undefined;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `New Arcubed enquiry — ${inquiry.topic}`,
        text,
        html,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });

    if (!res.ok) {
      // The provider's body can echo request content; log the status only.
      logOrderError(`resend responded ${res.status}`, { operation: "notify_contact_inquiry" });
      return "failed";
    }
    return "sent";
  } catch (e) {
    logOrderError(e instanceof Error ? e.message : "notification failed", {
      operation: "notify_contact_inquiry",
    });
    return "failed";
  }
}
