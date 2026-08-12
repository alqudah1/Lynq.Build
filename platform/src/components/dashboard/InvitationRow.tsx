"use client";

import { useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import type { CreateInvitationActionResult } from "@/lib/dashboard/actions/invitations";
import { InvitationLink } from "./InvitationLink";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  accepted: "Accepted",
  revoked: "Revoked",
  expired: "Expired",
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * One invitation row (Step 5C). Never receives the invitation's internal
 * ID as a prop — `revokeAction` (when present) arrives already bound to
 * this row's ID by the page, server-side, exactly like Step 5B's member
 * rows; `resendAction` needs no ID at all, since resending is just
 * resubmitting this row's own already-displayed email/role/workspace
 * through the identical create-or-refresh action (`createOrRefreshInvitation`
 * itself decides whether that refreshes this row or starts a new one).
 *
 * Actions are entirely presentational gating: `resendAction` is offered
 * for "pending" and "expired" rows, `revokeAction` only for "pending" —
 * accepted/revoked rows show status only, no controls. The real rules
 * (owner/admin only, "must currently be pending" for revoke) are enforced
 * by `createOrRefreshInvitation`/`revokeInvitation` themselves regardless.
 */
export function InvitationRow({
  email,
  role,
  workspaceId,
  workspaceName,
  workspaceRole,
  status,
  expiresAt,
  invitedByName,
  resendAction,
  revokeAction,
}: {
  email: string;
  role: string;
  workspaceId: string | null;
  workspaceName: string | null;
  workspaceRole: string | null;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  invitedByName: string | null;
  resendAction: (formData: FormData) => Promise<CreateInvitationActionResult>;
  revokeAction?: (formData: FormData) => Promise<ActionResult>;
}) {
  const [invitationPath, setInvitationPath] = useState<string | null>(null);
  const canResend = status === "pending" || status === "expired";
  const canRevoke = status === "pending" && revokeAction;

  return (
    <tr className="border-b border-border align-top">
      <td className="py-3 pr-4 text-sm text-foreground">{email}</td>
      <td className="py-3 pr-4 text-sm capitalize text-foreground">{role}</td>
      <td className="py-3 pr-4 text-sm text-foreground">
        {workspaceName ? (
          <span>
            {workspaceName} <span className="text-subtle">({workspaceRole})</span>
          </span>
        ) : (
          <span className="text-subtle">—</span>
        )}
      </td>
      <td className="py-3 pr-4 text-sm text-foreground">
        <span className="border border-border px-2 py-0.5 text-xs uppercase tracking-[0.08em]">{STATUS_LABEL[status]}</span>
      </td>
      <td className="py-3 pr-4 text-sm text-muted">{formatDate(expiresAt)}</td>
      <td className="py-3 pr-4 text-sm text-muted">{invitedByName ?? "—"}</td>
      <td className="py-3">
        {canResend || canRevoke ? (
          <div className="flex flex-wrap gap-2">
            {canResend ? (
              <ConfirmDialog
                triggerLabel="Resend"
                title="Generate a fresh invitation link"
                description={`Generate a fresh secure link for ${email} with the same role? The previous link will stop working.`}
                confirmLabel="Generate link"
                formAction={resendAction}
                onSuccess={(result) => {
                  if (result.invitationPath) setInvitationPath(result.invitationPath);
                }}
                hiddenFields={{
                  email,
                  role,
                  ...(workspaceId && workspaceRole ? { workspaceId, workspaceRole } : {}),
                }}
              />
            ) : null}
            {canRevoke && revokeAction ? (
              <ConfirmDialog
                triggerLabel="Revoke"
                triggerVariant="danger"
                variant="danger"
                title="Revoke invitation"
                description={`Revoke the invitation sent to ${email}? They will no longer be able to accept it.`}
                confirmLabel="Revoke"
                formAction={revokeAction}
              />
            ) : null}
          </div>
        ) : (
          <span className="text-xs text-subtle">No actions</span>
        )}
        {invitationPath ? <InvitationLink invitationPath={invitationPath} /> : null}
      </td>
    </tr>
  );
}
