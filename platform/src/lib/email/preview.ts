import "server-only";
import { renderInvitationEmail } from "./render";
import type { EmailMessage, InvitationEmailPayload } from "./types";

/**
 * Shown in place of a real accept link everywhere the invitation email is
 * previewed (Step 5C) — deliberately plain, descriptive text, never an
 * anchor tag, so it reads as inert even before a person tries to click it.
 */
export const ACCEPT_LINK_PLACEHOLDER = "[Secure invitation link inserted at send time]";

/** A URL-shaped but non-functional placeholder handed to `renderInvitationEmail` — chosen only so the template's own accept-link markup has something syntactically valid to embed; it is replaced with `ACCEPT_LINK_PLACEHOLDER` immediately below and never reaches a caller. */
const PLACEHOLDER_ACCEPT_URL = "about:blank#preview-only-never-a-real-link";

/**
 * Renders the SAME template real delivery will eventually use
 * (`renderInvitationEmail`, unmodified) — this is the "must use the same
 * rendering function as future real email delivery" requirement — but a
 * raw invitation token is never generated, held, or passed in anywhere in
 * this call path: `acceptUrl` is a fixed non-functional placeholder from
 * the very first call, not a real URL that then gets scrubbed. The
 * template's `<a href="...">Accept invitation</a>` markup is replaced with
 * plain, visibly non-clickable text after rendering, so nothing resembling
 * a usable link ever reaches the caller — the returned `EmailMessage` is
 * safe to render directly and safe to discard; nothing about it is ever
 * persisted by this module.
 */
export function renderInvitationEmailPreview(payload: Omit<InvitationEmailPayload, "acceptUrl">): EmailMessage {
  const rendered = renderInvitationEmail({ ...payload, acceptUrl: PLACEHOLDER_ACCEPT_URL });

  return {
    ...rendered,
    // Matched by tag content, not by the exact placeholder URL string, so
    // this stays correct even if the real template's anchor grows further
    // attributes (styling, tracking-free classes, etc.) — anything from
    // `<a href="...">Accept invitation</a>` becomes inert text.
    html: rendered.html.replace(
      /<a href="[^"]*"[^>]*>Accept invitation<\/a>/,
      `<span style="color:#7a6a52;font-style:italic;">${ACCEPT_LINK_PLACEHOLDER}</span>`
    ),
    text: rendered.text.replace(`Accept: ${PLACEHOLDER_ACCEPT_URL}`, `Accept: ${ACCEPT_LINK_PLACEHOLDER}`),
  };
}

/**
 * Gates the development email-preview surface (Step 5C requirement:
 * "Disable the preview surface in production unless explicitly enabled by
 * a safe environment flag"). Enabled unconditionally outside production;
 * in production, disabled unless `ENABLE_EMAIL_PREVIEW` is the exact
 * string `"true"` — never a value an operator could set accidentally
 * (e.g. a stray non-empty string), and never inferred from the presence
 * of any other configuration.
 */
export function isEmailPreviewEnabled(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.ENABLE_EMAIL_PREVIEW === "true";
}
