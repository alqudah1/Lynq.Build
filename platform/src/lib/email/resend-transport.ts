import "server-only";
import type { EmailMessage, EmailTransport } from "./types";

/**
 * Production adapter boundary for Resend (Step 4C's documented intended
 * initial provider) — deliberately NOT wired to a real connection yet.
 *
 * Implemented as a direct call to Resend's plain HTTP API (`POST
 * https://api.resend.com/emails`) rather than the `resend` npm package, so
 * no new dependency is added to this project for a provider that isn't
 * configured yet. `RESEND_API_KEY` is read lazily, inside `send()`, never at
 * module load — importing this file (or the whole invitation route module
 * that references it) must never fail or require the credential to exist.
 * Builds and the full test suite never invoke `send()` at all, so neither
 * ever touches this env var or performs a network call.
 *
 * Never logs the message body, recipient, or API response — a failed send
 * is reported to the caller as a thrown error with a generic message only;
 * callers (the invitation route) treat email delivery as best-effort and
 * must never fail invitation creation because of it.
 */
export class ResendEmailTransport implements EmailTransport {
  constructor(private readonly fromAddress: string) {}

  async send(message: EmailMessage): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error("RESEND_API_KEY is not configured — email not sent.");
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.fromAddress,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Resend API request failed with status ${response.status}`);
    }
  }
}

/**
 * Resolves the transport to use, purely from environment configuration —
 * the composition-root decision point (Step 4C: "Do not send real emails
 * yet unless a provider is already safely configured"). Returns `null` when
 * unconfigured; callers treat a `null` transport as "skip sending," never as
 * an error, so invitation creation always succeeds regardless of email
 * delivery state.
 */
export function resolveConfiguredEmailTransport(): EmailTransport | null {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.RESEND_FROM_ADDRESS;
  if (!apiKey || !fromAddress) {
    return null;
  }
  return new ResendEmailTransport(fromAddress);
}
