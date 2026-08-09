import "server-only";
import type { EmailMessage, InvitationEmailPayload } from "./types";

/**
 * Builds the invitation email's subject/html/text. `payload.acceptUrl`
 * carries the raw token transiently, purely as a URL string — this function
 * must never log its input or output, and no caller may persist the return
 * value anywhere other than handing it straight to an `EmailTransport.send`
 * call.
 *
 * Styling (Step 5C): inline CSS only — email clients strip `<style>` blocks
 * and external stylesheets unpredictably — using the same warm, editorial
 * palette as the rest of the LYNQ platform's design language (warm
 * stone/off-white background, charcoal text, a restrained amber accent for
 * the single call-to-action, no gradients, sharp corners). A table-based
 * layout (rather than flexbox/grid) since that remains the most reliably
 * rendered structure across email clients.
 */
export function renderInvitationEmail(payload: InvitationEmailPayload): EmailMessage {
  const workspaceLine = payload.workspaceName
    ? ` and workspace "${payload.workspaceName}" (as ${payload.workspaceRole})`
    : "";
  const inviterLine = payload.inviterName ? `${payload.inviterName} has` : "You have been";
  const expiryLine = `This invitation expires on ${payload.expiresAt.toUTCString()}.`;

  const text = `${inviterLine} invited you to join "${payload.organizationName}" as ${payload.role}${workspaceLine}.\n\nAccept: ${payload.acceptUrl}\n\n${expiryLine}`;

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#f4efe6;font-family:Georgia,'Times New Roman',serif;color:#2b2926;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4efe6;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background-color:#faf7f0;border:1px solid #ddd3bd;">
            <tr>
              <td style="padding:32px 40px 0 40px;">
                <p style="margin:0;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#8a7c5f;">LYNQ</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 40px 0 40px;">
                <p style="margin:0;font-size:22px;font-style:italic;font-weight:400;color:#2b2926;">You're invited</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 40px 0 40px;">
                <p style="margin:0;font-size:15px;line-height:1.6;color:#2b2926;">
                  ${inviterLine} invited you to join <strong>${escapeHtml(payload.organizationName)}</strong> as <strong>${payload.role}</strong>${workspaceLine ? escapeHtml(workspaceLine) : ""}.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 40px 0 40px;">
                <a href="${payload.acceptUrl}" style="display:inline-block;padding:14px 28px;background-color:#c9a668;color:#2b2926;text-decoration:none;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Accept invitation</a>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 40px 32px 40px;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#8a7c5f;">${expiryLine}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return {
    to: payload.to,
    subject: `You're invited to join ${payload.organizationName} on LYNQ`,
    html,
    text,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
