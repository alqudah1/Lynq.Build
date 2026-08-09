import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { PendingApprovalCard, type PendingApprovalView } from "./PendingApprovalCard";
import type { ActionResult } from "@/lib/dashboard/actions/types";

const APPROVAL: PendingApprovalView = {
  id: "approval-1",
  requestedAction: "publish_knowledge_report",
  summary: "Publish the generated knowledge report",
  riskLevel: "low",
  expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
};

describe("PendingApprovalCard", () => {
  it("renders labeled approve/reject controls with no axe violations", async () => {
    const approveAction = vi.fn(async () => ({ ok: true }) as ActionResult);
    const rejectAction = vi.fn(async () => ({ ok: true }) as ActionResult);
    const { container } = render(
      <ul>
        <PendingApprovalCard approval={APPROVAL} approveAction={approveAction} rejectAction={rejectAction} />
      </ul>
    );

    expect(screen.getByRole("button", { name: /^approve$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/rejection note/i)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("calls the bound approve action when Approve is clicked", async () => {
    const approveAction = vi.fn(async () => ({ ok: true }) as ActionResult);
    render(
      <ul>
        <PendingApprovalCard approval={APPROVAL} approveAction={approveAction} rejectAction={vi.fn()} />
      </ul>
    );

    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    await waitFor(() => expect(approveAction).toHaveBeenCalledTimes(1));
  });

  it("submits an optional rejection note with the reject action", async () => {
    const rejectAction = vi.fn<(formData: FormData) => Promise<ActionResult>>(async () => ({ ok: true }));
    render(
      <ul>
        <PendingApprovalCard approval={APPROVAL} approveAction={vi.fn()} rejectAction={rejectAction} />
      </ul>
    );

    fireEvent.change(screen.getByLabelText(/rejection note/i), { target: { value: "Missing citations" } });
    fireEvent.click(screen.getByRole("button", { name: /^reject$/i }));
    await waitFor(() => expect(rejectAction).toHaveBeenCalledTimes(1));
    expect(rejectAction.mock.calls[0][0].get("decisionNote")).toBe("Missing citations");
  });
});
