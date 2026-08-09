import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { InvitationRow } from "./InvitationRow";
import type { ActionResult } from "@/lib/dashboard/actions/types";
import type { CreateInvitationActionResult } from "@/lib/dashboard/actions/invitations";

function renderRow(overrides: Partial<Parameters<typeof InvitationRow>[0]> = {}) {
  const resendAction = vi.fn(async () => ({ ok: true, refreshed: true }) as CreateInvitationActionResult);
  const revokeAction = vi.fn(async () => ({ ok: true }) as ActionResult);
  const utils = render(
    <table>
      <tbody>
        <InvitationRow
          email="jane@example.com"
          role="member"
          workspaceId={null}
          workspaceName={null}
          workspaceRole={null}
          status="pending"
          expiresAt="2026-01-01T00:00:00Z"
          invitedByName="Ada Lovelace"
          resendAction={resendAction}
          revokeAction={revokeAction}
          {...overrides}
        />
      </tbody>
    </table>
  );
  return { ...utils, resendAction, revokeAction };
}

describe("InvitationRow", () => {
  it("offers Resend and Revoke for a pending invitation, with no axe violations", async () => {
    const { container } = renderRow();
    expect(screen.getByRole("button", { name: "Resend" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("offers only Resend, never Revoke, for an expired invitation", () => {
    renderRow({ status: "expired", revokeAction: undefined });
    expect(screen.getByRole("button", { name: "Resend" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
  });

  it("offers no actions at all for an accepted invitation", () => {
    renderRow({ status: "accepted", revokeAction: undefined });
    expect(screen.queryByRole("button", { name: "Resend" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
    expect(screen.getByText("No actions")).toBeInTheDocument();
  });

  it("offers no actions at all for a revoked invitation", () => {
    renderRow({ status: "revoked", revokeAction: undefined });
    expect(screen.queryByRole("button", { name: "Resend" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
  });

  it("requires explicit confirmation before revoking, and calls the bound action only on confirm", async () => {
    const { revokeAction } = renderRow();
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    const dialog = screen.getByRole("dialog", { name: "Revoke invitation" });
    expect(dialog).toHaveAccessibleDescription(/revoke the invitation sent to jane@example\.com/i);
    expect(revokeAction).not.toHaveBeenCalled();

    const confirmButton = screen.getAllByRole("button", { name: "Revoke" })[1];
    fireEvent.click(confirmButton);
    await waitFor(() => expect(revokeAction).toHaveBeenCalledTimes(1));
  });

  it("requires explicit confirmation before resending, and calls the bound action only on confirm", async () => {
    const { resendAction } = renderRow();
    fireEvent.click(screen.getByRole("button", { name: "Resend" }));

    expect(screen.getByRole("dialog", { name: "Resend invitation" })).toBeInTheDocument();
    expect(resendAction).not.toHaveBeenCalled();

    const confirmButton = screen.getAllByRole("button", { name: "Resend" })[1];
    fireEvent.click(confirmButton);
    await waitFor(() => expect(resendAction).toHaveBeenCalledTimes(1));
  });

  it("renders status as visible text, not color alone", () => {
    renderRow({ status: "pending" });
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });
});
